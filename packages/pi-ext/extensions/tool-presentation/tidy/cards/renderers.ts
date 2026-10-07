import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import { Box, Container } from "@earendil-works/pi-tui";
import { loadTidyIcons, loadTidyMode, type TidyMode } from "../config.js";
import { readToolTiming, ToolTimeline } from "../timeline.js";
import { renderCard, TimelineTool, WidthAwareLines } from "./card.js";
import { rawExpanded, type CardSpec } from "./spec.js";

interface CardReplayContext {
  sessionManager: { getBranch(): { type: string; message?: unknown }[] };
}
/** Structural boundary shared by the workspace's different Pi patch versions. */
export interface CardAPI {
  events?: object;
  on(event: "tool_call", handler: (event: { toolCallId: string; parentToolCallId?: string }) => void): void;
  on(event: "tool_result", handler: (event: { toolCallId: string }) => void): void;
  on(event: "session_start", handler: (event: unknown, ctx: CardReplayContext) => void): void;
  on(event: "session_tree", handler: (event: unknown, ctx: CardReplayContext) => void): void;
  on(event: "turn_end", handler: () => void): void;
  on(event: "session_shutdown", handler: () => void): void;
}
type CardRuntime = { timeline: ToolTimeline; timers: Map<string, ReturnType<typeof setInterval>>; isReplayCall?: (id: string) => boolean };
const runtimes = new WeakMap<object, CardRuntime>();
/** One clock per event bus; no execute wrappers or tool_result transformations. */
export function cardRuntime(pi: CardAPI, timeline = new ToolTimeline(), isReplayCall?: (id: string) => boolean) {
  const key = pi.events ?? pi;
  const existing = runtimes.get(key);
  if (existing) {
    if (isReplayCall) existing.isReplayCall = isReplayCall;
    return existing;
  }
  const runtime: CardRuntime = { timeline, timers: new Map<string, ReturnType<typeof setInterval>>(), isReplayCall };
  runtimes.set(key, runtime);
  const stop = (id: string) => { const timer = runtime.timers.get(id); if (timer) clearInterval(timer); runtime.timers.delete(id); };
  const clear = () => { for (const id of runtime.timers.keys()) stop(id); };
  pi.on("tool_call", (e) => { if (!e.parentToolCallId && !runtime.isReplayCall?.(e.toolCallId)) timeline.start(e.toolCallId, Date.now()); });
  pi.on("tool_result", (e) => { timeline.finish(e.toolCallId, Date.now()); stop(e.toolCallId); });
  const restore = (_e: unknown, ctx: CardReplayContext) => {
    clear();
    timeline.restore(ctx.sessionManager.getBranch().flatMap((entry) => {
      const message = entry.message as { role?: unknown; toolCallId?: unknown; details?: unknown } | undefined;
      return entry.type === "message" && message?.role === "toolResult" && typeof message.toolCallId === "string"
        ? [{ toolCallId: message.toolCallId, details: message.details }] : [];
    }));
  };
  pi.on("session_start", restore);
  pi.on("session_tree", restore);
  pi.on("turn_end", clear);
  pi.on("session_shutdown", clear);
  return runtime;
}
export function cardRenderers(spec: CardSpec, runtime?: ReturnType<typeof cardRuntime>, original?: ToolRenderers,
  settings: { mode: TidyMode; icons: boolean } = { mode: loadTidyMode(), icons: loadTidyIcons() }) {
  const { mode, icons } = settings;
  return {
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: any) {
      if (!context?.isPartial) return new Container();
      const id = context.toolCallId;
      if (runtime && !runtime.timers.has(id)) {
        const timer = setInterval(() => context.invalidate?.(), 1000); timer.unref?.(); runtime.timers.set(id, timer);
      }
      const content = new WidthAwareLines(() => {
        const timing = runtime?.timeline.get(id);
        return renderCard({ spec, args: args ?? {}, result: {} }, { mode, icons, isPartial: true, elapsedMs: timing?.startedAt === undefined ? undefined : Date.now() - timing.startedAt });
      }, (text) => theme.bg("toolPendingBg", text));
      const block = new TimelineTool(content, () => runtime?.timeline.get(id), theme);
      // Pi composes call and result components together, even for partial results.
      return { invalidate() {}, render(width: number) { return context.state?.cardHasResult ? [] : block.render(width); } };
    },
    renderResult(result: any, options: any, theme: any, context: any) {
      const id = context?.toolCallId ?? "";
      if (context?.state) context.state.cardHasResult = true;
      const timing = () => readToolTiming(result?.details) ?? runtime?.timeline.get(id);
      const partial = options?.isPartial ?? false;
      const timer = runtime?.timers.get(id);
      if (!partial && timer) { clearInterval(timer); runtime?.timers.delete(id); }
      const failed = context?.isError || result?.isError || spec.failed?.(result);
      const hasImages = result.content?.some((block: { type: string }) => block.type === "image");
      const useOriginal = options?.expanded && original && (!spec.expanded || hasImages);
      const bg = (text: string) => theme.bg(partial ? "toolPendingBg" : failed ? "toolErrorBg" : "toolSuccessBg", text);
      const content = new WidthAwareLines(() => renderCard({ spec: spec.expanded ? spec : { ...spec, expanded: rawExpanded }, args: context?.args ?? {}, result }, {
        mode, icons, isPartial: partial, expanded: options?.expanded && !useOriginal, isError: context?.isError,
        elapsedMs: timing()?.elapsedMs ?? (timing()?.startedAt === undefined ? undefined : Math.max(0, Date.now() - timing()!.startedAt!)),
      }), bg);
      if (!useOriginal) return new TimelineTool(content, timing, theme);

      // Keep native renderer state and lastComponent separate from the card wrapper.
      const state = context?.state ?? {};
      const nativeState = state.tidyOriginalState ??= {};
      const nativeContext = { ...context, state: nativeState };
      const body = original.renderShell === "self" ? new Container() : new Box(1, 1, bg);
      if (original.renderCall) {
        state.tidyOriginalCall = original.renderCall(context?.args ?? {}, theme, { ...nativeContext, lastComponent: state.tidyOriginalCall });
        body.addChild(state.tidyOriginalCall);
      }
      if (original.renderResult) {
        state.tidyOriginalResult = original.renderResult(result, options, theme, { ...nativeContext, lastComponent: state.tidyOriginalResult });
        body.addChild(state.tidyOriginalResult);
      } else {
        body.addChild(new WidthAwareLines(rawExpanded(result), bg));
      }
      const expanded = new Container();
      expanded.addChild(content);
      expanded.addChild(body);
      return new TimelineTool(expanded, timing, theme);
    },
  };
}
