# Cache Hit Predictor: switch-impact stacked bar

## Problem
The current footer shows a raw cache percentage (`~27k/~104k 26%`). That number answers an arithmetic question, not the decision question: *how much cache do I lose by switching, and how big is that loss relative to the destination model’s context window?*

## Decision
Use a compact stacked context-window bar:

```text
cache gpt-5.6-sol · low ↓60% [██████░░]
```

- Green segment = cache carried after the switch.
- Red segment = cache lost because of the switch.
- Dim segment = remaining context-window headroom.
- `↓60%` = percentage of the source-lane cache that is discarded.

This encodes two dimensions without inventing a combined score:
1. **Continuity loss** — the percentage label.
2. **Absolute/window impact** — the visual length of the red segment inside the full window bar.

## Behavior

### When to show
- Show only on a model or reasoning-level switch that has a meaningful previous lane.
- Do not show on a brand-new chat (no source lane, no history).
- If source and destination are both cold, show nothing.
- If there is no loss, show the bar with a `↓0%` label and no red.
- Clear after a successful response on the displayed lane, or on session tree/compaction/shutdown.

### Calculation
For a switch from source lane `S` to destination lane `D`:

```text
sourceTokens = min(history[S], currentPromptTokens)
destTokens   = min(history[D], currentPromptTokens)
lostTokens   = max(0, sourceTokens - destTokens)
drop%        = lostTokens / sourceTokens * 100
window%      = lostTokens / contextWindow * 100
```

### Fallback
If `currentPromptTokens` or `contextWindow` is unavailable, fall back to the previous concise text format (`cache <lane> · cold` or `~tokens/~tokens pct%`).

## Implementation

### Files changed
- `packages/pi-cache-hit-predictor/src/predictor.ts`: add `predictCacheSwitchImpact`, `renderSwitchImpact`, segment allocation helper.
- `packages/pi-cache-hit-predictor/index.ts`: track `activeLane`, compute switch impact on model/thinking changes, render bar using `ctx.ui.theme`, keep legacy fallback.
- `packages/pi-cache-hit-predictor/tests/predictor.test.ts`: add impact and bar rendering tests.
- `packages/pi-cache-hit-predictor/tests/extension.test.ts`: update harness and assertions for the new status string.
- `packages/pi-cache-hit-predictor/README.md`, `CHANGELOG.md`, `package.json`: document and bump to 0.2.0.

### Verification
- `npm run check` in the package.
- `npm run check` at the monorepo root.
- Update lockfile if the version bump requires it.
