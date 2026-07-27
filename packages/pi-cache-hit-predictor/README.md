# @iurysza/pi-cache-hit-predictor

Shows a cache continuity indicator when you switch Pi models or reasoning levels.

```text
cache gpt-5.6-sol · low ↓60% [██████░░]
```

The bar is a compact view of the destination model's context window:

- **Green** = prompt cache that will be carried across the switch.
- **Red** = prompt cache that will be lost because of the switch.
- **Dim** = remaining context-window headroom.
- `↓60%` = percentage of the source lane's cache that the switch discards.

This answers the decision question directly: how much of the current conversation stops carrying across the switch, and how large is that loss relative to the model's full window?

The indicator is UI-only. It is not sent to the model and does not change the prompt. It remains visible through aborts and failed requests, then clears after the first successful response on the predicted provider/API/model/reasoning lane.

The package uses Pi's native `setStatus()` API when installed alone. If `@iurysza/pi-ext` is also installed, it advertises priority metadata so pi-ext can place the same status in its bounded auxiliary footer line.

## Install

```bash
pi install npm:@iurysza/pi-cache-hit-predictor
```

Try it for one session:

```bash
pi -e npm:@iurysza/pi-cache-hit-predictor
```

## How it works

The extension treats each provider, API, model, and reasoning level combination as a separate cache lane. It remembers the prompt size from the latest successful request in each lane. When you switch lanes, it compares the cache each lane would likely reuse.

For example, if `low` last saw 25k tokens and the session grew to 100k on `high`, switching back to `low` predicts a loss of up to 25k, or 100% of the `low` cache. The red segment in the bar is small because 25k is only a fraction of the model's window, but the percentage tells you the continuity cost is total. The next completed request on `low` refreshes that lane with the larger prompt.

This is an estimate, not provider preflight data. Provider expiry or eviction, compaction, branch summaries, changed tools or system instructions, and provider serialization can change the actual hit. The provider's `cacheRead` usage remains the final result.

## Local development

```bash
npm install
npm run check
npm pack --dry-run
pi -e ./index.ts
```
