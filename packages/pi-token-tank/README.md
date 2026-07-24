<p align="center">
  <img src="assets/token-tank-banner.png" width="720" alt="Token Tank fuel gauge banner">
</p>

<h1 align="center">pi-token-tank</h1>

<p align="center"><strong>Your token mileage at a glance.</strong></p>

Provider-aware subscription quota status for Pi. It follows the active model and fetches that provider’s quota.

```text
▰▱▱▱  24%  ↻ 3h 25m
```

## Supported providers

| Active model provider | Subscription | Authentication | Quota windows |
| --- | --- | --- | --- |
| `openai`, `openai-codex` | OpenAI Codex | Pi `/login openai-codex` | 5 hour, weekly |
| `kimi-coding` | Kimi Coding | Pi `/login kimi-coding` or `KIMI_API_KEY` | 5 hour, weekly |
| `github-copilot` | GitHub Copilot | Pi `/login github-copilot` | Monthly AI credits/premium requests |
| `cursor` | Cursor | Registered Pi Cursor provider + `CURSOR_SESSION_TOKEN` | Billing-cycle total, Auto, API |

Unsupported model providers produce no footer status. Cursor appears only when Pi reports a registered `cursor` provider or a Cursor model is active.

## Install

```sh
pi install git:github.com/iurysza/pi-token-tank
```

Then authenticate the provider you use:

```text
/login openai-codex
/login kimi-coding
/login github-copilot
```

### Cursor setup

Token Tank detects Cursor through Pi's public ModelRegistry. Install and configure a Pi extension that registers provider id `cursor`, such as `pi-cursor-sdk`; Token Tank does not depend on or import it.

Cursor's SDK API key cannot read dashboard quota. For personal quota, copy the **value only** of the `WorkosCursorSessionToken` cookie from a signed-in `cursor.com` browser session and expose it to the process that launches Pi:

```sh
read -rs CURSOR_SESSION_TOKEN
CURSOR_SESSION_TOKEN="$CURSOR_SESSION_TOKEN" pi
unset CURSOR_SESSION_TOKEN
```

The value is a sensitive, short-lived browser session credential. The shell variable is not broadly exported. Token Tank captures it when the extension registers, immediately removes it from Pi's `process.env` so tools do not inherit it, and keeps it only in process memory across extension reloads. It never discovers, refreshes, logs, or persists it. An expired value shows `—`, or a stale last-good result when one exists, until Pi restarts with a replacement. Do not put the value in project files or command-line arguments.

Reload Pi after installation or environment changes.

## Footer modes

Minimal mode is the default and shows the provider’s primary window:

```text
▰▱▱▱  24%  ↻ 3h 25m
```

Full mode adds the configured detail windows:

```text
5h  ▰▱▱▱  24%  ↻ 3h 25m   ·   7d  ▰▱▱▱  15%  ↻ 4d 11h
```

- Four gauge cells represent 25-point usage buckets.
- Percentage colors show urgency: green under 70%, yellow under 90%, red at 90%+.
- `~` after a percentage means the extension is showing stale last-good data.
- Reset countdowns show relative time (`3h 25m`, `4d 11h`, or `soon`).

## Commands

| Command | Action |
| --- | --- |
| `/token-tank` | Toggle detailed quota data for every configured provider |
| `/token-tank minimal` | Use the compact footer with the primary quota window |
| `/token-tank full` | Use the bigger footer with every configured quota window |

The details widget keeps every configured provider on one width-aware line, including all available quota windows, so it stays below Pi's 10-line widget cap instead of dropping later providers. It also reminds you about `minimal` and `full`.

The selected mode is stored in `pi-token-tank.json` under Pi’s agent directory. The file contains only `{ "footerMode": "minimal" | "full" }`—never credentials or quota data.

## Refresh and failure behavior

- Fetches the active provider on session start.
- Refreshes after turns and model switches when cached data is older than five minutes.
- Routes immediately when the active model changes.
- Opening `/token-tank` forces all registered providers to refresh independently.
- Keeps last-good data and marks it stale if a later request fails.
- Shows `—` when credentials are missing and `!` when a request fails without cached data.

## Provider API notes

GitHub Copilot quota uses the read-only, undocumented `https://api.github.com/copilot_internal/user` endpoint. It supports GitHub.com, including Enterprise Cloud seats hosted on GitHub.com; custom GitHub Enterprise Server domains are rejected before any request. Token Tank reads Pi's stored GitHub OAuth token only in memory for that request. Tokens and raw responses are never logged, cached, or persisted. Normalized quota uses the existing in-memory five-minute/stale cache and is never persisted. The endpoint may change without notice.

Cursor quota uses the read-only, undocumented `https://cursor.com/api/usage-summary` dashboard endpoint. Detection uses only Pi's public ModelRegistry (`cursor` registered or active); package/filesystem detection is never used. Authentication is explicit opt-in through `CURSOR_SESSION_TOKEN`; Token Tank does not inspect browser cookie stores, Cursor Desktop/Agent auth databases, or `pi-cursor-sdk` internals. The Pi Cursor API key and `pi-cursor-sdk-cursor-api-key-placeholder` are never treated as dashboard auth.

The adapter prefers Cursor's own total plan percentage, then a finite plan ratio, Enterprise personal cap, or Enterprise pooled ratio. It does not infer quota from model calls. The session token is retained only in the non-environment process slot described above and is never logged or persisted. Raw responses are never logged, cached, or persisted; only normalized quota enters the existing process-memory five-minute/stale cache. The private endpoint may change without notice.

## Development

```sh
npm install
npm run check
npm test
npm pack --dry-run
```

## Troubleshooting

- `—`: authenticate the active model provider; for Cursor, refresh `CURSOR_SESSION_TOKEN`.
- `!`: verify credentials and network access.
- Missing footer segment with a custom footer: the custom `ctx.ui.setFooter()` implementation must render extension statuses. `/token-tank` remains available.
