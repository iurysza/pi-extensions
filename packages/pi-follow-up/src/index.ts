import type { AssistantMessage, Message, ThinkingLevel, UserMessage } from "@earendil-works/pi-ai";
import { complete } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
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

function renderWidget(
  ctx: ExtensionContext,
  suggestions: readonly string[] | undefined,
  selectedIndex: number | undefined,
): void {
  if (!suggestions?.length) {
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
    render: (width: number) => {
      if (selectedIndex === undefined) {
        return [
          truncateToWidth(
            theme.fg("dim", `Follow-up: "${suggestions[0].replace(/\s+/g, " ")}" +${suggestions.length - 1} more · shift+↑ open`),
            width,
          ),
        ];
      }

      const lines = [
        theme.bold("Follow-up"),
        theme.fg("dim", "↑↓ / jk move · ⏎ send · ⇧⏎ insert · ⎋ close"),
        "",
      ];
      suggestions.forEach((text, i) => {
        const prefix = i === selectedIndex ? "→ " : "  ";
        const wrapped = wrapTextWithAnsi(text, Math.max(1, width - prefix.length));
        wrapped.forEach((raw, j) => {
          const line = j === 0 ? `${prefix}${raw}` : `  ${raw}`;
          lines.push(
            i === selectedIndex && j === 0
              ? theme.fg("accent", line)
              : j === 0
                ? line
                : theme.fg("dim", line),
          );
        });
      });
      lines.push("", theme.fg("dim", `${selectedIndex + 1}/${suggestions.length}`));
      return lines;
    },
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
  let selectedIndex: number | undefined;
  let generation = 0;
  let activeController: AbortController | undefined;
  let unsubscribeInput: (() => void) | undefined;

  function clear(ctx: ExtensionContext): void {
    generation += 1;
    activeController?.abort();
    activeController = undefined;
    suggestions = undefined;
    selectedIndex = undefined;
    renderWidget(ctx, suggestions, selectedIndex);
  }

  function openPicker(ctx: ExtensionContext): void {
    if (!suggestions?.length) return;
    selectedIndex = 0;
    renderWidget(ctx, suggestions, selectedIndex);
  }

  function closePicker(ctx: ExtensionContext): void {
    selectedIndex = undefined;
    renderWidget(ctx, suggestions, selectedIndex);
  }

  function movePicker(ctx: ExtensionContext, offset: number): void {
    if (!suggestions?.length || selectedIndex === undefined) return;
    selectedIndex = (selectedIndex + offset + suggestions.length) % suggestions.length;
    renderWidget(ctx, suggestions, selectedIndex);
  }

  function useSelectedSuggestion(ctx: ExtensionContext, action: "send" | "insert"): void {
    if (!suggestions?.length || selectedIndex === undefined) return;
    const text = suggestions[selectedIndex];
    if (action === "send") {
      clear(ctx);
      try {
        pi.sendUserMessage(text);
      } catch {
        // A late lifecycle change must not interrupt the session.
      }
    } else {
      closePicker(ctx);
      ctx.ui.pasteToEditor(text);
    }
  }

  function handleTerminalInput(ctx: ExtensionContext, data: string): { consume: true } | undefined {
    if (!suggestions) return undefined;
    if (selectedIndex === undefined) {
      if (!matchesKey(data, "shift+up")) return undefined;
      openPicker(ctx);
      return { consume: true };
    }

    if (matchesKey(data, "up") || matchesKey(data, "k")) {
      movePicker(ctx, -1);
    } else if (matchesKey(data, "down") || matchesKey(data, "j")) {
      movePicker(ctx, 1);
    } else if (matchesKey(data, "shift+enter")) {
      useSelectedSuggestion(ctx, "insert");
    } else if (matchesKey(data, "enter")) {
      useSelectedSuggestion(ctx, "send");
    } else if (matchesKey(data, "escape")) {
      closePicker(ctx);
    } else {
      return undefined;
    }
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
        renderWidget(ctx, suggestions, selectedIndex);
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
