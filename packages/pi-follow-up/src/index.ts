import type { AssistantMessage, Message, ThinkingLevel, UserMessage } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
  KeybindingsManager,
  SessionEntry,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  followUpConfigPath,
  loadOrCreateFollowUpConfig,
  type FollowUpConfig,
} from "./config.js";
import {
  parseSuggestions,
  recentConversation,
  textFromContent,
  visibleUnicodeCharacterCount,
  type ConversationMessage,
} from "./core.js";

const WIDGET_KEY = "pi-follow-up";
const TOOL_NAME = "follow_up_suggestions";

function suggestionTool(count: number) {
  return {
    name: TOOL_NAME,
    description: "Return only likely next user messages.",
    parameters: Type.Object(
      { suggestions: Type.Array(Type.String(), { minItems: count, maxItems: count }) },
      { additionalProperties: false },
    ),
    constrainedSampling: { type: "json_schema" as const, strict: "require" as const },
  };
}

type SuggestionContext = {
  readonly triggerText: string;
  readonly messages: readonly ConversationMessage[];
};

function isMessageEntry(entry: SessionEntry): entry is Extract<SessionEntry, { type: "message" }> {
  return entry.type === "message";
}

function asConversationMessage(message: { role?: unknown; content?: unknown }): ConversationMessage | undefined {
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  const text = textFromContent(message.content);
  return text.length > 0 ? { role: message.role, text } : undefined;
}

function contextMessages(messages: readonly ConversationMessage[]): Message[] {
  return messages.map((message) => {
    if (message.role === "user") {
      return { role: "user", content: [{ type: "text", text: message.text }], timestamp: Date.now() } satisfies UserMessage;
    }
    return {
      role: "assistant",
      content: [{ type: "text", text: message.text }],
      api: "openai-codex-responses",
      provider: "openai-codex",
      model: "context-only",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    } satisfies AssistantMessage;
  });
}

export function suggestionContext(
  entries: readonly SessionEntry[],
  recentCount: number,
): SuggestionContext | undefined {
  const messages = entries
    .filter(isMessageEntry)
    .map((entry) => asConversationMessage(entry.message))
    .filter((message): message is ConversationMessage => message !== undefined);
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return undefined;

  return { triggerText: last.text, messages: recentConversation(messages, recentCount) };
}

export function suggestionToolArguments(response: AssistantMessage): unknown {
  return response.content.find(
    (item): item is Extract<AssistantMessage["content"][number], { type: "toolCall" }> =>
      item.type === "toolCall" && item.name === TOOL_NAME,
  )?.arguments;
}

type OverlayResult = { action: "send" | "insert"; text: string } | null;

class FollowUpPicker implements Component {
  private selectedIndex = 0;

  constructor(
    private readonly suggestions: readonly string[],
    private readonly theme: Theme,
    private readonly keybindings: KeybindingsManager,
    private readonly finish: (result: OverlayResult) => void,
  ) {}

  render(width: number): string[] {
    const lines = [
      this.theme.bold("  Follow-up"),
      this.theme.fg("dim", "  ↑↓ move · ⏎ send · ⇧⏎ insert · ⎋ close"),
      "",
    ];
    this.suggestions.forEach((text, i) => {
      const prefix = i === this.selectedIndex ? "→ " : "  ";
      const wrapped = wrapTextWithAnsi(text, Math.max(20, width - 4));
      wrapped.forEach((raw, j) => {
        const line = j === 0 ? `${prefix}${raw}` : `  ${raw}`;
        lines.push(
          i === this.selectedIndex && j === 0
            ? this.theme.fg("accent", line)
            : j === 0
              ? line
              : this.theme.fg("dim", line),
        );
      });
    });
    lines.push("", this.theme.fg("dim", `  ${this.selectedIndex + 1}/${this.suggestions.length}`));
    return lines;
  }

  handleInput(data: string): void {
    const n = this.suggestions.length;
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.selectedIndex = (this.selectedIndex + n - 1) % n;
    } else if (this.keybindings.matches(data, "tui.select.down")) {
      this.selectedIndex = (this.selectedIndex + 1) % n;
    } else if (matchesKey(data, "shift+enter")) {
      this.finish({ action: "insert", text: this.suggestions[this.selectedIndex] });
    } else if (this.keybindings.matches(data, "tui.select.confirm")) {
      this.finish({ action: "send", text: this.suggestions[this.selectedIndex] });
    } else if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.finish(null);
    }
  }

  invalidate(): void {}
}

function renderWidget(ctx: ExtensionContext, suggestions: readonly string[] | undefined): void {
  if (!suggestions?.length) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
    render: (width: number) => [
      truncateToWidth(
        theme.fg("dim", `Follow-up: "${suggestions[0].replace(/\s+/g, " ")}" +${suggestions.length - 1} more · shift+↑ open`),
        width,
      ),
    ],
    invalidate() {},
  }), { placement: "aboveEditor" });
}

export async function generateSuggestions(
  ctx: ExtensionContext,
  config: FollowUpConfig,
  conversation: readonly ConversationMessage[],
  signal: AbortSignal,
  completeRequest: typeof complete = complete,
): Promise<readonly string[] | undefined> {
  const model = ctx.modelRegistry.find(config.provider, config.model);
  if (!model) return undefined;

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) return undefined;
  const response = await completeRequest(
    model,
    {
      systemPrompt: config.prompt,
      messages: contextMessages(conversation),
      tools: [suggestionTool(config.count)],
    },
    {
      apiKey: auth.apiKey,
      headers: auth.headers,
      signal,
      reasoningEffort: config.thinking as ThinkingLevel,
      toolChoice: "required",
    },
  );
  if (response.stopReason === "aborted") return undefined;
  return parseSuggestions(suggestionToolArguments(response), config.count);
}

export type SuggestionGenerator = (
  ctx: ExtensionContext,
  config: FollowUpConfig,
  conversation: readonly ConversationMessage[],
  signal: AbortSignal,
) => Promise<readonly string[] | undefined>;

export function registerFollowUp(
  pi: ExtensionAPI,
  config: FollowUpConfig,
  configPath: string,
  generate: SuggestionGenerator = generateSuggestions,
): void {
  let suggestions: readonly string[] | undefined;
  let generation = 0;
  let activeController: AbortController | undefined;
  let unsubscribeInput: (() => void) | undefined;

  function clear(ctx: ExtensionContext): void {
    generation += 1;
    activeController?.abort();
    activeController = undefined;
    suggestions = undefined;
    renderWidget(ctx, suggestions);
  }

  async function openOverlay(ctx: ExtensionContext): Promise<void> {
    const snapshot = suggestions;
    if (!snapshot?.length) return;
    const generationAtOpen = generation;
    const result = await ctx.ui.custom<OverlayResult>(
      (_tui, theme, keybindings, done) =>
        new FollowUpPicker(snapshot, theme, keybindings, (r) => done(generation === generationAtOpen ? r : null)),
      { overlay: true, overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "85%" } },
    );
    if (result?.action === "send") {
      clear(ctx);
      try {
        pi.sendUserMessage(result.text);
      } catch {
        // A late lifecycle change must not interrupt the session.
      }
    } else if (result?.action === "insert") {
      ctx.ui.pasteToEditor(result.text);
    }
  }

  function handleTerminalInput(ctx: ExtensionContext, data: string): { consume: true } | undefined {
    if (!suggestions || !matchesKey(data, "shift+up")) return undefined;
    void openOverlay(ctx);
    return { consume: true };
  }

  pi.registerCommand("follow-up", {
    description: "Show the active follow-up configuration.",
    handler: async (_args, ctx) => {
      ctx.ui.notify(
        `pi-follow-up: ${config.threshold} chars, ${config.recentMessages} messages, ${config.count} suggestions, ${config.provider}/${config.model}/${config.thinking}; config: ${configPath}`,
        "info",
      );
    },
  });

  pi.on("session_start", (_event, ctx) => {
    clear(ctx);
    unsubscribeInput?.();
    if (ctx.mode === "tui") {
      unsubscribeInput = ctx.ui.onTerminalInput((data) => handleTerminalInput(ctx, data));
    }
  });

  pi.on("input", (_event, ctx) => {
    clear(ctx);
  });

  pi.on("agent_settled", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const conversation = suggestionContext(ctx.sessionManager.getBranch(), config.recentMessages);
    if (!conversation || visibleUnicodeCharacterCount(conversation.triggerText) <= config.threshold) return;

    clear(ctx);
    const generationAtStart = generation;
    const leafAtStart = ctx.sessionManager.getLeafId();
    const controller = new AbortController();
    activeController = controller;
    void generate(ctx, config, conversation.messages, controller.signal)
      .then((generated) => {
        if (
          controller.signal.aborted ||
          generation !== generationAtStart ||
          ctx.sessionManager.getLeafId() !== leafAtStart
        ) return;
        if (!generated) {
          if (activeController === controller) activeController = undefined;
          return;
        }
        suggestions = generated;
        activeController = undefined;
        renderWidget(ctx, suggestions);
      })
      .catch(() => {
        if (generation === generationAtStart && activeController === controller) {
          activeController = undefined;
        }
        // Suggestions are optional. Failures stay silent.
      });
  });

  pi.on("session_shutdown", (_event, ctx) => {
    clear(ctx);
    unsubscribeInput?.();
    unsubscribeInput = undefined;
  });
}

export default async function followUp(pi: ExtensionAPI): Promise<void> {
  const configPath = followUpConfigPath();
  const config = await loadOrCreateFollowUpConfig(configPath);
  registerFollowUp(pi, config, configPath);
}
