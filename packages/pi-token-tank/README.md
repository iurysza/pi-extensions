# @iurysza/pi-token-tank

See your subscription mileage without leaving Pi. Token Tank follows the active
model and adds provider quota, usage pressure, and reset timing to the footer.

```text
▰▰▱▱▱  󰔛 3h 25m
```

## Install

```bash
pi install npm:@iurysza/pi-token-tank
```

Authenticate the providers you use, then restart Pi or run `/reload`:

```text
/login openai-codex
/login kimi-coding
/login github-copilot
/login xai
```

## Supported providers

| Provider | Subscription | Quota |
| --- | --- | --- |
| Claude Code | `claude auth login` | 5-hour and weekly windows |
| OpenAI Codex | Pi `/login openai-codex` | 5-hour and weekly windows |
| Kimi Coding | Pi `/login kimi-coding` or `KIMI_API_KEY` | 5-hour and weekly windows |
| GitHub Copilot | Pi `/login github-copilot` | Monthly premium requests |
| xAI | Pi `/login xai` | Weekly SuperGrok pool |
| Cursor | Registered Pi Cursor provider plus `CURSOR_SESSION_TOKEN` | Billing-cycle total, Auto, and API |

Unsupported providers produce no footer status. Token Tank always publishes through Pi's native `setStatus()` API, so it works alone. When `@iurysza/pi-ext` is installed, it also advertises priority 100 metadata for pi-ext's bounded auxiliary footer line.

## Footer modes

Minimal mode shows the active provider's primary window. Claude Code shows its
weekly window instead:

```text
▰▰▱▱▱  󰔛 3h 25m
```

Full mode includes every available window:

```text
5h  ▰▰▱▱▱  󰔛 3h 25m   ·   7d  ▰▱▱▱  󰔛 4d 11h
```

| Command | Description |
| --- | --- |
| `/token-tank` | Refresh and show detailed quota for configured providers. |
| `/token-tank minimal` | Use the compact primary-window footer. |
| `/token-tank full` | Show every available quota window. |

Five gauge cells represent 20-point usage buckets. The gauge turns red at 90%
used; below that it stays green. `󰔛` marks time until reset. Minimal mode omits
the window label and percentage; full mode keeps labels to distinguish windows.
`~` marks stale last-good data; `—` means credentials are missing; `!` means a
request failed without cached data.

The selected mode is stored in `pi-token-tank.json` under Pi's agent directory.
The file contains only the footer mode—never credentials or quota data.

## Claude Code login

Token Tank reads the Claude Code CLI's existing OAuth login from macOS Keychain
or, with `CLAUDE_CONFIG_DIR` set, from that directory's `.credentials.json`.
On other systems it reads `~/.claude/.credentials.json`. It uses the access token
only for a read-only quota request and does not refresh or store credentials.
If the token expires, use `claude auth login`.

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

Claude Code, GitHub Copilot, Cursor, and xAI quota depend on read-only undocumented
endpoints. Those endpoints can change without notice. Raw responses, tokens,
and quota snapshots are never logged or persisted.

## Requirements

- Pi
- Node.js 22.19 or newer
- Provider authentication for each quota source

## License

MIT