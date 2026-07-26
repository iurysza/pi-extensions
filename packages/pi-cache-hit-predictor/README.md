# @iurysza/pi-cache-hit-predictor

Shows a cache-hit prediction when you switch Pi models or reasoning levels.

```text
cache gpt-5.6-sol · low · ~27k/~104k 26%
```

The prediction is UI-only. It is not sent to the model and does not change the prompt. It remains visible through aborts and failed requests, then clears after the first successful response on the predicted provider/API/model/reasoning lane.

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

The extension treats each provider, API, model, and reasoning level combination as a separate cache lane. It remembers the prompt size from the latest successful request in each lane. When you return to one, the old prompt size is the prefix that may still be reusable.

For example, if `low` last saw 25k tokens and the session grew to 100k on `high`, switching back predicts a hit of up to 25k, or 25%. The next completed request refreshes that lane with the larger prompt.

This is an estimate, not provider preflight data. Provider expiry or eviction, compaction, branch summaries, changed tools or system instructions, and provider serialization can change the actual hit. The provider's `cacheRead` usage remains the final result.

## Local development

```bash
npm install
npm run check
npm pack --dry-run
pi -e ./index.ts
```
