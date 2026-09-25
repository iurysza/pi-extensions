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

/** Assign dividers at execution start, not during rendering or completion. */
export class ToolTimeline {
  private readonly calls = new Map<string, ToolTiming>();
  private lastStartedAt: number | undefined;

  get(id: string): ToolTiming | undefined { return this.calls.get(id); }

  start(id: string, now: number): void {
    if (this.calls.has(id)) return;
    const showTimestamp = this.lastStartedAt === undefined
      || Math.floor(now / 60_000) !== Math.floor(this.lastStartedAt / 60_000);
    this.calls.set(id, { startedAt: now, showTimestamp });
    this.lastStartedAt = now;
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
    this.lastStartedAt = undefined;
    for (const result of results) {
      const timing = readToolTiming(result.details);
      if (!timing) continue;
      this.calls.set(result.toolCallId, timing);
      // Parallel tools can finish out of order. Use the latest start, not result order.
      if (timing.startedAt !== undefined) {
        this.lastStartedAt = Math.max(this.lastStartedAt ?? timing.startedAt, timing.startedAt);
      }
    }
  }
}

export function clockLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
