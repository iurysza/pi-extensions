import type { CacheLane } from "./predictor.js";

export const CACHE_WARNING_ICON = "\u{f163f}"; // Nerd Font md-database-clock
export const DEFAULT_IDLE_MINUTES = 30;

export function idleThresholdMs(value: string | undefined): number {
  const minutes = value?.trim() ? Number(value) : DEFAULT_IDLE_MINUTES;
  const milliseconds = minutes * 60_000;
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? milliseconds
    : DEFAULT_IDLE_MINUTES * 60_000;
}

export function cacheMayBeStale(
  refreshedAt: number | undefined,
  now: number,
  thresholdMs: number,
): boolean {
  return thresholdMs > 0 && refreshedAt !== undefined
    && Number.isFinite(refreshedAt) && now - refreshedAt >= thresholdMs;
}

// Older Pi SDKs lack UsageEntry. Read only the persisted warming fields we need.
// Warming records have no API/reasoning fields: associate them with the preceding
// successful response, not whichever model is currently selected in the editor.
export function cacheWarmTimestamp(
  entry: { type: string; timestamp: string; kind?: unknown; provider?: unknown; model?: unknown },
  precedingLane: CacheLane | undefined,
): number | undefined {
  if (!precedingLane || entry.type !== "usage"
    || entry.kind !== "cache_warm"
    || entry.provider !== precedingLane.provider
    || entry.model !== precedingLane.model) return undefined;
  const timestamp = Date.parse(entry.timestamp);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
