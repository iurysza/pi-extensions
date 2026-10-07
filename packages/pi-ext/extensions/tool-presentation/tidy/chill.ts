import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatElapsed, WidthAwareLines } from "./cards/card.js";
import { specForTool } from "./cards/index.js";
import { DIM, RED, RESET } from "./render.js";
import { readToolTiming, type ToolTimeline } from "./timeline.js";

const builtins = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const hasCard = (name: string) => builtins.has(name) || !!specForTool({ name });
type Group = { calls: Call[] };
type Call = { id: string; group: Group; done: boolean; failed: boolean; elapsedMs?: number };

/** Presentation state only. Text closes a group; reasoning does not. */
export class ChillState {
  private calls = new Map<string, Call>();
  private current: Group | undefined;
  private invalidators = new Map<string, () => void>();

  constructor(public enabled: boolean, private readonly timeline: ToolTimeline) {}

  boundary(): void { this.current = undefined; }
  watch(id: string, invalidate: () => void): void { this.invalidators.set(id, invalidate); }
  refresh(): void { for (const invalidate of [...this.invalidators.values()]) invalidate(); }
  toggle(): boolean { this.enabled = !this.enabled; this.refresh(); return this.enabled; }

  start(id: string, name: string): void {
    if (!hasCard(name) || this.calls.has(id)) return;
    const group = this.current ??= { calls: [] };
    const call: Call = { id, group, done: false, failed: false };
    group.calls.push(call);
    this.calls.set(id, call);
    this.refresh();
  }

  finish(id: string, name: string, result: any, isError = false): void {
    this.start(id, name);
    const call = this.calls.get(id);
    if (!call) return;
    call.done = true;
    call.failed = isError || result?.isError === true || specForTool({ name })?.failed?.(result) === true;
    call.elapsedMs = readToolTiming(result?.details)?.elapsedMs ?? this.timeline.get(id)?.elapsedMs;
    this.refresh();
  }

  /** undefined keeps the normal card; [] hides it; one line owns the group summary. */
  folded(id: string, kind: "call" | "result"): string[] | undefined {
    const call = this.calls.get(id);
    if (!this.enabled || !call?.done) return undefined;
    const finished = call.group.calls.filter((item) => item.done);
    if (kind === "call" || finished.at(-1) !== call) return [];
    const running = call.group.calls.some((item) => !item.done);
    const failures = finished.filter((item) => item.failed).length;
    const duration = finished.every((item) => item.elapsedMs !== undefined)
      ? ` · ${formatElapsed(finished.reduce((total, item) => total + item.elapsedMs!, 0))}` : "";
    const tools = `${finished.length} ${finished.length === 1 ? "tool" : "tools"}`;
    return [`${DIM}${running ? "Working" : "Worked"} · ${tools}${duration}${RESET}${failures ? ` ${RED}· ${failures} failed${RESET}` : ""}`];
  }

  restore(entries: readonly { type: string; message?: any }[]): void {
    this.calls.clear();
    this.invalidators.clear();
    this.current = undefined;
    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message?.role === "user") this.boundary();
      if (message?.role === "assistant") {
        if (hasText(message)) this.boundary();
        for (const block of message.content ?? []) {
          if (block.type === "toolCall") this.start(block.id, block.name);
        }
      }
      if (message?.role === "toolResult") this.finish(message.toolCallId, message.toolName, message, message.isError);
    }
  }

  clear(): void { this.calls.clear(); this.invalidators.clear(); this.current = undefined; }
}

export function hasText(message: any): boolean {
  return Array.isArray(message?.content) && message.content.some((block: any) => block.type === "text" && block.text?.trim());
}

/** The live components consult state at render time, so earlier cards fold too. */
export function chillRenderers(renderers: ToolRenderers, chill: ChillState): ToolRenderers {
  const wrap = (component: Component, context: any, kind: "call" | "result", expanded: boolean): Component => {
    if (context?.invalidate) chill.watch(context.toolCallId, context.invalidate);
    return {
      invalidate: () => component.invalidate(),
      render(width) {
        const folded = expanded ? undefined : chill.folded(context?.toolCallId, kind);
        return folded === undefined ? component.render(width) : new WidthAwareLines(folded).render(width);
      },
    };
  };
  return {
    ...renderers,
    renderCall: renderers.renderCall && ((args, theme, context) => wrap(renderers.renderCall!(args, theme, context), context, "call", context.expanded)),
    renderResult: renderers.renderResult && ((result, options, theme, context) => wrap(renderers.renderResult!(result, options, theme, context), context, "result", options.expanded)),
  };
}
