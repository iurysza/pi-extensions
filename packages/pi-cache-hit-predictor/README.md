# @iurysza/pi-cache-hit-predictor

Shows an amber Nerd Font database-clock icon when prompt-cache reuse is at risk.

```text
… │ ▰▰▰▰ 13k left  󱘿
```

The icon appears when a model or reasoning-level switch may discard cached tokens, or when the selected lane's last known refresh is old enough that its cache may be stale. It stays hidden otherwise. Both warnings are estimates, not confirmed cache misses.

With `@iurysza/pi-ext`, the icon sits immediately after the context budget on line one. Without that footer, it uses Pi's native `setStatus()` display. It is UI-only and does not change the prompt.

## Idle threshold

The default is **30 minutes**, aligned with the documented GPT-5.6 retention window in Cursor and GPT-5.6-and-later OpenAI API caching. Set `PI_CACHE_IDLE_MINUTES` before launching Pi to choose another threshold, such as five minutes for Claude:

```bash
PI_CACHE_IDLE_MINUTES=5 pi
```

Zero disables only age warnings. Fractional minutes are allowed. Empty, negative, non-finite, or invalid values use the 30-minute default. Pi reads the setting when the session starts or its branch is rebuilt.

The default is a caution point, not a confirmed expiry time. It remains an estimate for ChatGPT-backed `openai-codex` and models with unpublished retention. The extension uses one threshold across all providers; it does not select a threshold from the model's retention policy.

## Retention evidence

Sources checked on 25 September 2026. Cursor and ChatGPT-backed OpenAI sessions are the main cases for this setup. Cache lifetime means time since the last write or reuse, not time since the conversation was opened. A published lifetime does not guarantee a hit: the prompt prefix and routing must also match.

| Route and model | Published lifetime | Meaning for the warning |
| --- | --- | --- |
| Cursor using GPT-5.6 | Cursor staff confirm 30 minutes. OpenAI documents at least 30 minutes for GPT-5.6 and later. [7] [2] | 30 minutes is a supported caution point for this route, not proof of expiry. |
| Cursor using earlier OpenAI models | Cursor staff describe 24-hour retention for most OpenAI models. OpenAI says extended retention typically lasts around 30 minutes and can last up to 24 hours. [1] [2] | Do not treat 24 hours as a guaranteed safe period. Check the model's policy. |
| Cursor using Claude | Cursor staff confirm the default sliding window of about 5 minutes. [1] [3] | Use a 5-minute override. The GPT-aligned default is too late for this case. |
| Cursor Composer and Cursor Grok | No lifetime found in the reviewed Cursor docs or staff replies. The thread's question about these models remains unanswered. [1] [4] | Keep the threshold explicitly heuristic. Absence of a cache-write charge does not establish freshness. |
| Direct OpenAI API, GPT-5.6 and later | `prompt_cache_options.ttl` defaults to `30m`, its only supported value. Eligibility lasts at least 30 minutes after the latest write or reuse. [2] | A 30-minute caution point follows the documented minimum. Entries may remain available longer. |
| Direct OpenAI API, earlier models | `in_memory`: typically 5 to 10 minutes idle, up to one hour. `24h`: typically around 30 minutes, up to 24 hours. GPT-5.5 supports only `24h`. [2] | Choose from the actual model and retention setting, not the provider name alone. |
| Pi `openai-codex`, signed in through ChatGPT | The reviewed Codex authentication and pricing docs distinguish subscription access from API-key access, but give no prompt-cache lifetime for subscription sessions. [5] [6] | The 30-minute default is an API-based estimate here, not a verified subscription guarantee. |

### Cursor evidence

Cursor staff member Colin explains that Cursor uses its model providers' caches and does not do anything special to keep them warm. On 16 July 2026, he explicitly confirms 30 minutes for GPT-5.6. [7]

His earlier explanation says provider cache duration does not change between local, Cloud Agent, and self-hosted use. [3] This supports using the upstream model's documented policy for Cursor, rather than inventing a separate Cursor-wide lifetime.

The April explanation also says only Anthropic charges for cache writes. That pricing claim predates GPT-5.6 and is superseded by the current OpenAI and Cursor pricing docs. [2] [4] Its timing claims must still be read per model.

### OpenAI evidence and subscription limits

For API models supporting both retention policies, OpenAI currently defaults to `24h` without Zero Data Retention and `in_memory` with it. [2] These are API organization settings, not evidence of the policy used by a ChatGPT subscription.

The inspected Pi 0.87.1 adapter, `@earendil-works/pi-ai/dist/api/openai-codex-responses.js`, uses `https://chatgpt.com/backend-api`. Its request builder supplies `prompt_cache_key`, but does not set `prompt_cache_retention` or `prompt_cache_options.ttl`. A cache key is not a lifetime setting. The subscription path must therefore remain a separate, unverified case.

Codex pricing lists cached-input rates and says credit billing has no separate cache-write charge. [6] That establishes billing behavior, not retention time. Likewise, `applyCursorApproximateUsage` in `packages/pi-cursor-sdk/src/cursor-usage-accounting.ts` sets cache counters to zero when it estimates usage. Those fallback zeros are not measured cache misses.

### Current policy and remaining uncertainty

The default is 30 minutes because GPT is the main target for this setup. Shorter-lived caches need an explicit override. Model-switch warnings still appear immediately when the predictor estimates a loss.

A future provider-aware policy needs the actual route, model family, and retention setting. For Cursor Auto, Composer, Cursor Grok, and ChatGPT-backed Codex, the shared 30-minute default remains an estimate until provider confirmation or route-specific measurements support it.

[1]: https://forum.cursor.com/t/how-long-does-cursors-prompt-cache-persist-before-expiring/165686/4 "Cursor staff on provider caching; see replies 7 and 9 for GPT-5.6 and write charges"
[2]: https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime "OpenAI cache lifetime and model differences"
[3]: https://forum.cursor.com/t/understanding-write-cache/156915/5 "Cursor staff on provider-managed cache duration across deployments"
[4]: https://cursor.com/docs/models-and-pricing "Cursor model pricing, including cache reads and writes"
[5]: https://developers.openai.com/codex/auth "Codex subscription and API-key authentication"
[6]: https://developers.openai.com/codex/pricing "Codex cached-input credit billing"
[7]: https://forum.cursor.com/t/how-long-does-cursors-prompt-cache-persist-before-expiring/165686/7 "Cursor staff confirm 30 minutes for GPT-5.6"

## How it works

The extension treats each provider, API, model, and reasoning-level combination as a separate cache lane. It remembers the prompt size and request timestamp from each lane's latest successful response.

Switches compare the selected lane with the last successfully used lane, not intermediate menu selections. A smaller reusable cache shows the icon. Switching back to a recent lane with no estimated loss hides it. Aborted and failed requests do not clear a warning.

Age starts at the assistant message's request timestamp, so streaming consumes that time too. Successful persisted `cache_warm` records refresh the estimate for the preceding response's matching provider and model. Those records supply completion timestamps, not request-start times. Unknown or mismatched warming records do not reset the clock. The extension checks age and warming once per second while the TUI is open.

A successful response on the selected lane clears the switch warning, but an already-old request can still trigger the age warning. Session navigation rebuilds the estimate; compaction and branch summaries discard incompatible snapshots. Shutdown stops the timers.

Provider eviction, expiry, changed tools or instructions, and serialization can change the actual hit. No icon means no known warning, not guaranteed cache reuse. The provider's `cacheRead` usage remains the final result.

## Install

```bash
pi install npm:@iurysza/pi-cache-hit-predictor
```

Try it for one session:

```bash
pi -e npm:@iurysza/pi-cache-hit-predictor
```

## Local development

```bash
npm install
npm run check
npm pack --dry-run
pi -e ./index.ts
```
