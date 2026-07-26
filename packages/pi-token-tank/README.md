# @iurysza/pi-token-tank

See your subscription mileage without leaving Pi. Token Tank follows the active
model and adds provider quota, usage pressure, and reset timing to the footer.

```text
▰▱▱▱  24%  ↻ 3h 25m
```

## Install

```bash
pi install npm:@iurysouza/pi-token-tank
```

Authenticate the providers you use, then restart Pi or run `/reload`:

```text
/login openai-codex
/login kimi-coding
/login github-copilot
```

## Supported providers

| Provider | Subscription | Quota |
| --- | --- | --- |
| OpenAI Codex | Pi `/login openai-codex` | 5-hour and weekly windows |
| Kimi Coding | Pi `/login kimi-coding` or `KIMI_API_KEY` | 5-hour and weekly windows |
| GitHub Copilot | Pi `/login github-copilot` | Monthly premium requests |
| Cursor | Registered Pi Cursor provider plus `CURSOR_SESSION_TOKEN` | Billing-cycle total, Auto, and API |

Unsupported providers produce no footer status. Token Tank always publishes through Pi's native `setStatus()` API, so it works alone. When `@iurysza/pi-ext` is installed, it also advertises priority 100 metadata for pi-ext's bounded auxiliary footer line.

## Footer modes

Minimal mode shows the active provider's primary window:

```text
▰▱▱▱  24%  ↻ 3h 25m
```

Full mode includes every available window:

```text
5h  ▰▱▱▱  24%  ↻ 3h 25m   ·   7d  ▰▱▱▱  15%  ↻ 4d 11h
```

| Command | Description |
| --- | --- |
| `/token-tank` | Refresh and show detailed quota for configured providers. |
| `/token-tank minimal` | Use the compact primary-window footer. |
| `/token-tank full` | Show every available quota window. |

Four gauge cells represent 25-point usage buckets. Green is below 70%, yellow
is below 90%, and red is 90% or higher. `~` marks stale last-good data; `—`
means credentials are missing; `!` means a request failed without cached data.

The selected mode is stored in `pi-token-tank.json` under Pi's agent directory.
The file contains only the footer mode—never credentials or quota data.

## Cursor setup

Token Tank detects Cursor through Pi's public model registry. Install a Pi
extension that registers provider ID `cursor`; Token Tank does not import or
depend on that extension.

Cursor's normal API key cannot read dashboard quota. Start Pi with the value of
the `WorkosCursorSessionToken` cookie from a signed-in `cursor.com` session:

```bash
read -rs CURSOR_SESSION_TOKEN
CURSOR_SESSION_TOKEN="$CURSOR_SESSION_TOKEN" pi
unset CURSOR_SESSION_TOKEN
```

Treat this value as a sensitive browser credential. Do not store it in project
files or pass it as a command-line argument. Token Tank captures it during
extension registration, removes it from `process.env`, retains it only in
process memory, and never logs or persists it.

## Refresh behavior

- Fetches the active provider at session start.
- Refreshes stale data after turns and model switches.
- Refreshes all configured providers when `/token-tank` opens.
- Preserves last-good data when a later request fails.
- Keeps normalized quota only in the process-memory cache.

GitHub Copilot and Cursor quota depend on read-only undocumented endpoints.
Those endpoints can change without notice. Raw responses, tokens, and quota
snapshots are never logged or persisted.

## Requirements

- Pi
- Node.js 22.19 or newer
- Provider authentication for each quota source

## License

MIT