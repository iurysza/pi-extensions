# @iurysza/pi-cache-hit-predictor

## 0.2.0

### Changes

- Replace the raw cache percentage (`~27k/~104k 26%`) with a stacked context-window bar.

  The new indicator shows how much cache continuity is lost by switching model or reasoning lanes, and how large that loss is relative to the destination model's context window.

  ```text
  cache gpt-5.6-sol · low ↓60% [██████░░]
  ```

  - Green = carried cache.
  - Red = cache lost by the switch.
  - Dim = remaining context-window headroom.
  - `↓60%` = percentage of the source lane's cache that is discarded.

- Track the active lane from the last successful assistant message, so switches are evaluated against the lane that actually holds the likely reusable cache.

- Keep a concise legacy fallback when context-window usage data is unavailable.

## 0.0.1

### Changes

- Add inline cache-hit predictions when switching Pi model or reasoning lanes.

  Warn once that automatic reasoning-level changes can cause prompt-cache misses and affect provider costs or quotas.
