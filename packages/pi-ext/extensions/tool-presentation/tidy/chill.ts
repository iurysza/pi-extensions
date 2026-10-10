import type { ToolRenderers } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { formatElapsed, WidthAwareLines } from "./cards/card.js";
import { specForTool } from "./cards/index.js";
import { DIM, RED, RESET } from "./render.js";
import { readToolTiming, type ToolTimeline } from "./timeline.js";

const builtins = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);
const hasCard = (name: string) => builtins.has(name) || !!specForTool({ name });
type Group = { calls: Call[]; open?: boolean };
type Call = { id: string; name: string; group: Group; done: boolean; failed: boolean; elapsedMs?: number; settled?: boolean; cloud?: boolean };

// Built-ins have no card label, so the header groups them by what they did.
const builtinGroups: Record<string, string> = { read: "read", ls: "read", find: "read", grep: "read", write: "edit", edit: "edit", bash: "shell" };
const groupName = (name: string): string => builtinGroups[name] ?? specForTool({ name })?.label ?? name;
/** Columns the open group's cards shift right, so they sit under the header text past its arrow. */
export const CHILL_INDENT = 2;

export const CLOUD_COMPLETION_TYPE = "cursor-cloud-completion";
/** New completions carry a stable identity in details, shared by live and restored messages. */
export function completionId(message: { timestamp?: string | number; details?: any }): string {
  const time = typeof message.timestamp === "string" ? Date.parse(message.timestamp) : message.timestamp;
  return `cloud:${message.details?.completionId ?? `${message.details?.url ?? message.details?.id}:${time}`}`;
}

/** How long the newest finished card stays visible when no other tool follows. */
export const CHILL_GRACE_MS = 5000;

/** Presentation state only. Text closes a group; reasoning does not. */
export class ChillState {
  private calls = new Map<string, Call>();
  private current: Group | undefined;
  private invalidators = new Map<string, () => void>();
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(public enabled: boolean, private readonly timeline: ToolTimeline, private readonly graceMs = CHILL_GRACE_MS) {}

  boundary(): void {
    if (this.current) for (const call of this.current.calls) if (call.done) call.settled = true;
    this.current = undefined;
    this.refresh();
  }
  watch(id: string, invalidate: () => void): void { this.invalidators.set(id, invalidate); }
  refresh(): void { for (const invalidate of [...this.invalidators.values()]) invalidate(); }
  toggle(): boolean { this.enabled = !this.enabled; this.refresh(); return this.enabled; }

  start(id: string, name: string): void {
    if (!hasCard(name) || this.calls.has(id)) return;
    const group = this.current ??= { calls: [] };
    const call: Call = { id, name, group, done: false, failed: false, cloud: name === "cursor_cloud_completion" };
    group.calls.push(call);
    this.calls.set(id, call);
    this.refresh();
  }

  finish(id: string, name: string, result: any, isError = false, settled = this.graceMs <= 0): void {
    this.start(id, name);
    const call = this.calls.get(id);
    if (!call) return;
    call.done = true;
    call.settled = settled;
    call.failed = isError || result?.isError === true || specForTool({ name })?.failed?.(result) === true;
    call.elapsedMs = call.cloud ? result?.details?.elapsedMs : readToolTiming(result?.details)?.elapsedMs ?? this.timeline.get(id)?.elapsedMs;
    if (!settled) {
      const timer = setTimeout(() => { this.timers.delete(timer); call.settled = true; this.refresh(); }, this.graceMs);
      timer.unref?.();
      this.timers.add(timer);
    }
    this.refresh();
  }

  completeMessage(message: { customType?: string; timestamp?: string | number; details?: any }, settled = this.graceMs <= 0): void {
    if (message.customType !== CLOUD_COMPLETION_TYPE) return;
    const id = completionId(message);
    if (this.calls.has(id)) return;
    this.finish(id, "cursor_cloud_completion", { details: message.details }, false, settled);
  }

  /** A finished card folds once a later tool starts, text arrives, or its grace period ends. */
  private isFolded(call: Call): boolean {
    return call.done && (call.settled === true || call.group.calls.at(-1) !== call);
  }

  /** Opens or folds the group that owns this card. Chill owns this state, not Pi's per-card expand. */
  toggleGroup(id: string): void {
    const call = this.calls.get(id);
    if (!call) return;
    call.group.open = !call.group.open;
    this.refresh();
  }

  /** Clickable header above the first card of an open group. */
  header(id: string): string | undefined {
    const call = this.calls.get(id);
    if (!this.enabled || !call?.group.open || !this.isFolded(call)) return undefined;
    if (call.group.calls.find((item) => this.isFolded(item)) !== call) return undefined;
    return `${DIM} ${this.summary(call.group)}${RESET}`;
  }

  /** undefined keeps the normal card; [] hides it; the last folded card owns the group summary. */
  folded(id: string, kind: "call" | "result"): string[] | undefined {
    const call = this.calls.get(id);
    if (!this.enabled || !call || call.group.open || !this.isFolded(call)) return undefined;
    const finished = call.group.calls.filter((item) => this.isFolded(item));
    if (kind === "call" || finished.at(-1) !== call) return [];
    return [`${DIM} ${this.summary(call.group)}${RESET}`];
  }

  /** Provider groups in first-run order, e.g. "read 3 · edit · shell · 20s · 1 failed". */
  private summary(group: Group): string {
    const finished = group.calls.filter((item) => this.isFolded(item));
    const running = group.calls.some((item) => !this.isFolded(item));
    const failures = finished.filter((item) => item.failed).length;
    const timed = finished.filter((item) => item.elapsedMs !== undefined);
    const duration = timed.length ? formatElapsed(timed.reduce((total, item) => total + item.elapsedMs!, 0)) : "";
    const counts = new Map<string, number>();
    for (const item of finished) counts.set(groupName(item.name), (counts.get(groupName(item.name)) ?? 0) + 1);
    const names = [...counts].map(([name, n]) => n > 1 ? `${name} ${n}` : name);
    const shown = names.length > 4 ? [...names.slice(0, 3), `+${names.length - 3}`] : names;
    const facts = [...shown, duration, running ? "running" : ""].filter(Boolean).join(" · ");
    return `${facts}${RESET}${failures ? ` ${RED}· ${failures} failed` : ""}`;
  }

  /** Cards inside an open group render indented, like children in a file tree. */
  indented(id: string): boolean {
    const call = this.calls.get(id);
    return !!(this.enabled && call?.group.open && this.isFolded(call));
  }

  restore(entries: readonly { type: string; message?: any; customType?: string; timestamp?: string; details?: any; display?: boolean }[]): void {
    this.clear();
    for (const entry of entries) {
      // Pi persists custom messages directly on custom_message entries, not entry.message.
      if (entry.type === "custom_message" && entry.display !== false) this.completeMessage(entry, true);
      if (entry.type !== "message") continue;
      const message = entry.message;
      if (message?.role === "user") this.boundary();
      if (message?.role === "assistant") {
        if (hasText(message)) this.boundary();
        for (const block of message.content ?? []) {
          if (block.type === "toolCall") this.start(block.id, block.name);
        }
      }
      if (message?.role === "toolResult") this.finish(message.toolCallId, message.toolName, message, message.isError, true);
    }
  }

  clear(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.calls.clear(); this.invalidators.clear(); this.current = undefined;
  }
}

export function hasText(message: any): boolean {
  return Array.isArray(message?.content) && message.content.some((block: any) => block.type === "text" && block.text?.trim());
}

/** The live components consult state at render time, so earlier cards fold too. */
export function chillComponent(component: Component, chill: ChillState, context: any, kind: "call" | "result" | "message", expanded: boolean): Component {
  const id = context?.toolCallId;
  if (context?.invalidate) chill.watch(id, context.invalidate);
  // Lines added above the card, so mouse rows shift down by this much.
  let offset = 0;
  let summary = false;
  return {
    invalidate: () => component.invalidate(),
    render(width) {
      offset = 0;
      const folded = expanded ? undefined : chill.folded(id, kind === "message" ? "result" : kind);
      summary = !!folded?.length;
      if (folded !== undefined) return new WidthAwareLines(folded).render(width);
      const indent = chill.indented(id) ? CHILL_INDENT : 0;
      const body = indent ? component.render(Math.max(1, width - indent)).map((line) => " ".repeat(indent) + line) : component.render(width);
      const header = kind !== "result" ? chill.header(id) : undefined;
      if (header === undefined) return body;
      offset = 1;
      return [...new WidthAwareLines([header]).render(width), ...body];
    },
    handleMouse(event) {
      const click = event.type === "click" && event.button === "left";
      if (summary) return click ? (chill.toggleGroup(id), { handled: true }) : undefined;
      if (offset && event.y < offset) return click ? (chill.toggleGroup(id), { handled: true }) : undefined;
      const shift = chill.indented(id) ? CHILL_INDENT : 0;
      return component.handleMouse?.({ ...event, y: event.y - offset, ...(typeof (event as any).x === "number" ? { x: (event as any).x - shift } : {}) });
    },
  };
}

export function chillRenderers(renderers: ToolRenderers, chill: ChillState): ToolRenderers {
  return {
    ...renderers,
    renderCall: renderers.renderCall && ((args, theme, context) => chillComponent(renderers.renderCall!(args, theme, context), chill, context, "call", context.expanded)),
    renderResult: renderers.renderResult && ((result, options, theme, context) => chillComponent(renderers.renderResult!(result, options, theme, context), chill, context, "result", options.expanded)),
  };
}
