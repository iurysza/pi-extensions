import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { timeDivider, type ToolTimeline } from "./tidy/timeline.js";
import { formatElapsed } from "./tidy/vendor/pi-tidy-core/index.js";

export const CONVERSATION_TIMELINE_ENTRY = "pi-conversation-timeline";

type Outcome = "completed" | "stopped" | "failed";
export type TimelineEntry =
  | { kind: "minute"; at: number }
  | { kind: "run-end"; at: number; startedAt: number; elapsedMs: number; outcome: Outcome };

function timestamp(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && Number.isFinite(new Date(value).getTime());
}

export function readTimelineEntry(value: unknown): TimelineEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (!timestamp(data.at)) return undefined;
  if (data.kind === "minute") return { kind: "minute", at: data.at };
  if (data.kind === "run-end" && timestamp(data.startedAt)
    && typeof data.elapsedMs === "number" && Number.isFinite(data.elapsedMs) && data.elapsedMs >= 0
    && (data.outcome === "completed" || data.outcome === "stopped" || data.outcome === "failed")) {
    return { kind: "run-end", at: data.at, startedAt: data.startedAt, elapsedMs: data.elapsedMs, outcome: data.outcome };
  }
  return undefined;
}

export function renderTimelineEntry(data: TimelineEntry, width: number, theme?: Pick<Theme, "fg">): string {
  if (data.kind === "minute") return timeDivider(data.at, width, theme);
  const label = data.outcome === "completed" ? "Completed in" : data.outcome === "stopped" ? "Stopped after" : "Failed after";
  const line = truncateToWidth(`${label} ${formatElapsed(data.elapsedMs)}`, Math.max(1, width));
  return theme ? theme.fg("dim", line) : line;
}

function hasVisibleContent(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return message.content.some((part) => part.type === "toolCall"
    || (part.type === "text" && part.text.trim().length > 0)
    || (part.type === "thinking" && part.thinking.trim().length > 0));
}

/** Registers after tidy so its session restore runs after the tool clock restore. */
export function registerConversationTimeline(pi: ExtensionAPI, clock: ToolTimeline): void {
  let pendingAssistant = false;
  let run: { startedAt: number; outcome: Outcome } | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let workingUi: ExtensionContext["ui"] | undefined;

  const stopTimer = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    workingUi?.setWorkingMessage();
    workingUi = undefined;
  };
  const markMinute = () => {
    const at = Date.now();
    if (clock.observe(at)) pi.appendEntry<TimelineEntry>(CONVERSATION_TIMELINE_ENTRY, { kind: "minute", at });
  };
  const markAssistant = (message: AgentMessage) => {
    if (!pendingAssistant || !hasVisibleContent(message)) return;
    pendingAssistant = false;
    markMinute();
  };

  pi.registerEntryRenderer(CONVERSATION_TIMELINE_ENTRY, (entry, _options, theme) => {
    const data = readTimelineEntry(entry.data);
    if (!data) return undefined;
    return {
      invalidate() {},
      render: (width) => [renderTimelineEntry(data, width, theme)],
    };
  });

  const restore = (_event: unknown, ctx: ExtensionContext) => {
    stopTimer();
    run = undefined;
    pendingAssistant = false;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== CONVERSATION_TIMELINE_ENTRY) continue;
      const data = readTimelineEntry(entry.data);
      if (data?.kind === "minute") clock.restoreClock(data.at);
    }
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);

  pi.on("message_start", ({ message }) => {
    if (message.role === "user") markMinute();
    if (message.role === "assistant") {
      // An empty streaming message is not yet visible. Record first content, not request creation.
      pendingAssistant = true;
      markAssistant(message);
    }
  });
  pi.on("message_update", ({ message }) => markAssistant(message));
  pi.on("message_end", ({ message }) => {
    if (message.role !== "assistant") return;
    markAssistant(message);
    if (pendingAssistant && (message.stopReason === "error" || message.stopReason === "aborted")) markMinute();
    pendingAssistant = false;
  });

  pi.on("agent_start", (_event, ctx) => {
    // Retries and queued continuations may start another loop before agent_settled.
    if (!run) run = { startedAt: Date.now(), outcome: "completed" };
    if (ctx.mode !== "tui" || timer !== undefined) return;
    workingUi = ctx.ui;
    const update = () => {
      if (run) workingUi?.setWorkingMessage(`Working · ${formatElapsed(Math.max(0, Date.now() - run.startedAt))}`);
    };
    update();
    timer = setInterval(update, 1_000);
    timer.unref?.();
  });
  pi.on("agent_end", ({ messages }) => {
    if (!run) return;
    const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
    run.outcome = lastAssistant?.stopReason === "error" ? "failed"
      : lastAssistant?.stopReason === "aborted" || lastAssistant?.stopReason === "length" ? "stopped" : "completed";
  });
  pi.on("agent_settled", () => {
    stopTimer();
    if (!run) return;
    const finished = run;
    run = undefined;
    pendingAssistant = false;
    const at = Date.now();
    pi.appendEntry<TimelineEntry>(CONVERSATION_TIMELINE_ENTRY, {
      kind: "run-end", at, startedAt: finished.startedAt,
      elapsedMs: Math.max(0, at - finished.startedAt), outcome: finished.outcome,
    });
  });
  pi.on("session_shutdown", () => {
    stopTimer();
    run = undefined;
    pendingAssistant = false;
  });
}
