import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface ToolTiming {
  startedAt?: number;
  elapsedMs?: number;
  showTimestamp: boolean;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Old sessions can have a duration without a start time. Never invent either. */
export function readToolTiming(details: unknown): ToolTiming | undefined {
  if (!details || typeof details !== "object") return undefined;
  const value = details as Record<string, unknown>;
  const started = nonNegativeNumber(value.piTidyStartedAt);
  const startedAt = started !== undefined && Number.isFinite(new Date(started).getTime()) ? started : undefined;
  const elapsedMs = nonNegativeNumber(value.piTidyElapsedMs);
  if (startedAt === undefined && elapsedMs === undefined) return undefined;
  return { startedAt, elapsedMs, showTimestamp: startedAt !== undefined && value.piTidyShowTimestamp === true };
}

/** Share one minute clock across visible messages and tool execution starts. */
export class ToolTimeline {
  private readonly calls = new Map<string, ToolTiming>();
  private lastActivityAt: number | undefined;

  get(id: string): ToolTiming | undefined { return this.calls.get(id); }

  observe(now: number): boolean {
    const showTimestamp = this.lastActivityAt === undefined
      || Math.floor(now / 60_000) !== Math.floor(this.lastActivityAt / 60_000);
    this.lastActivityAt = now;
    return showTimestamp;
  }

  restoreClock(timestamp: number): void {
    this.lastActivityAt = Math.max(this.lastActivityAt ?? timestamp, timestamp);
  }

  start(id: string, now: number): void {
    if (this.calls.has(id)) return;
    this.calls.set(id, { startedAt: now, showTimestamp: this.observe(now) });
  }

  finish(id: string, now: number): ToolTiming | undefined {
    const timing = this.calls.get(id);
    if (timing?.startedAt === undefined) return timing;
    if (timing.elapsedMs === undefined) {
      const finished = { ...timing, elapsedMs: Math.max(0, now - timing.startedAt) };
      this.calls.set(id, finished);
      return finished;
    }
    return timing;
  }

  restore(results: Iterable<{ toolCallId: string; details?: unknown }>): void {
    this.calls.clear();
    this.lastActivityAt = undefined;
    for (const result of results) {
      const timing = readToolTiming(result.details);
      if (!timing) continue;
      this.calls.set(result.toolCallId, timing);
      // Parallel tools can finish out of order. Use the latest start, not result order.
      if (timing.startedAt !== undefined) {
        this.restoreClock(timing.startedAt);
      }
    }
  }
}

export function timeDivider(timestamp: number, width: number, theme?: Pick<Theme, "fg">): string {
  const max = Math.max(1, width);
  const label = `── ${clockLabel(timestamp)} `;
  const line = truncateToWidth(label + "─".repeat(Math.max(0, max - visibleWidth(label))), max);
  if (!theme) return line;
  return line.split(/(─+)/).map((part) => theme.fg(/^─+$/.test(part) ? "border" : "dim", part)).join("");
}

export function clockLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
