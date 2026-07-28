# @iurysza/pi-cache-hit-predictor

Shows a cache continuity indicator when you switch Pi models or reasoning levels.

```text
󰆼 ↓60k/100k
```

- `60k` = prompt-cache tokens the switch may discard.
- `100k` = prompt-cache tokens the current lane would likely reuse if you stayed.

This answers the decision question directly: how much cache this switch may discard in concrete token terms.

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

For example, if the current lane could reuse 100k tokens and the selected lane could reuse 25k, the footer shows `󰆼 ↓75k/100k`. The next completed request on the selected lane refreshes that lane with the larger prompt.

This is an estimate, not provider preflight data. Provider expiry or eviction, compaction, branch summaries, changed tools or system instructions, and provider serialization can change the actual hit. The provider's `cacheRead` usage remains the final result.

## Local development

```bash
npm install
npm run check
npm pack --dry-run
pi -e ./index.ts
```
