# pi-cursor-cloud

Cloud subagents for Pi. Delegate a task to Cursor Cloud, keep working locally, and receive the result as a follow-up message. A pinned widget shows live activity above the editor.

## Compared with pi-subagents

| | pi-cursor-cloud | pi-subagents |
| --- | --- | --- |
| Where it runs | Cursor's cloud VM | Local Pi subprocess |
| Sees local files? | No. Checks out a GitHub repo and ref | Yes, according to its working directory and isolation settings |
| Tools | Cursor's cloud tools | Pi's configured tool set |
| Cost | Cursor Max Mode pricing for each run | Selected model's provider pricing |
| Steering | Follow-up when idle, or cancel | Live steering and local agent controls |

## Enable

For a one-off session from this monorepo:

```sh
pi -e ./packages/pi-cursor-cloud/src/index.ts
```

For a persistent local package install:

```sh
pi install ./packages/pi-cursor-cloud
```

If the monorepo is already enabled, the root catalog includes this extension. Do not load it twice. After publication, the npm install command is `pi install npm:@iurysza/pi-cursor-cloud`.

Set `CURSOR_API_KEY`, or use the existing `cursor.key` entry in `~/.pi/agent/auth.json`. `PI_CODING_AGENT_DIR` overrides that directory. The extension does not write credentials or Pi settings. SDK handles and raw errors never appear in tool results.

## Tools

| Tool | Parameters | Behavior |
| --- | --- | --- |
| `cursor_cloud_spawn` | `prompt`, optional `repo`, `ref`, `model`, `name` | Creates an agent, returns its short ID, then sends the prompt in the background |
| `cursor_cloud_send` | `id`, `prompt` | Starts a background follow-up on an idle agent |
| `cursor_cloud_cancel` | `id` | Requests cancellation of the current run |
| `cursor_cloud_status` | optional `id` | Returns plain state, activity, elapsed time, tool count, result text, and branch or PR info |

The default model is `composer-2-5`. The repository defaults to the current working directory's GitHub origin. SSH origins become HTTPS URLs. The ref defaults to the current branch if a corresponding local `origin` tracking ref exists, otherwise `main`. A different explicit repository defaults to `main`. Nothing fetches or uploads your local checkout.

IDs are the first 8 characters after `bc-`. Full IDs and unique prefixes also work. An ambiguous prefix fails rather than choosing an agent.

## Commands

```text
/cloud
/cloud list
/cloud spawn Read-only. Review the docs and suggest corrections.
/cloud send <id> Explain the most important correction.
/cloud cancel <id>
/cloud delete <id>
```

`/cloud list` includes every undeleted agent started by this extension instance, even after it leaves the widget. Deletion is restricted to those agents. Cancel a running agent and wait for its terminal result before deleting it.

## Example flow

Ask Pi:

```text
Use cursor_cloud_spawn to review https://github.com/owner/repo at main.
Name it docs-review. Read-only: identify outdated documentation.
While it runs, help me plan the local tests.
```

The spawn tool returns without waiting for the run. The widget shows thinking, tool names and arguments, then text snippets. On completion, Pi receives a custom follow-up message with the result, duration, and any branch or PR details Cursor supplies. This triggers a main-agent turn. Ask for a follow-up with `cursor_cloud_send` after the agent is idle.

Running agents animate every 150ms. Finished agents stay in the widget for 60 seconds. The tree shows at most 12 lines and collapses overflow into `+N more`.

## Limits

- every run and follow-up costs real money. There is no free local fallback
- cloud agents cannot see uncommitted files, unpushed branches, or local Pi tools and conversation history. Put needed context in the prompt
- Cursor rejects follow-ups during active runs with `agent_busy`. This extension checks before sending, including while the first send is starting
- handles live in memory. There is no resume across restarts or reloads. `/cloud` lists this extension instance's agents, not your whole Cursor account
- closing Pi stops local timers and closes handles. It does not cancel cloud runs. Manage orphaned runs through Cursor
- network failures may leave remote work running even when local status says failed. Check Cursor before starting replacement work
- there is no cost estimate, artifact download UI, or automatic application of cloud changes to your local checkout

## Foreground cloud turns

Use [pi-cursor-sdk](../pi-cursor-sdk/README.md) and `/cursor-runtime cloud` when you want the main Pi turn itself to run on Cursor Cloud rather than delegating background work.

For a dirty local worktree, explicitly bypass local-state validation and specify the cloud checkout:

```sh
pi --model cursor/composer-2-5 --cursor-runtime cloud --cursor-cloud-ack \
  --cursor-cloud-allow-local-state \
  --cursor-cloud-repo https://github.com/owner/repo \
  --cursor-cloud-branch main
```

Those flags belong to pi-cursor-sdk. They do not upload local uncommitted changes to the cloud.

## Development

```sh
npm run typecheck
npm test
npm run build
node scripts/smoke.mjs
```

The smoke starts one paid, read-only run against `https://github.com/iurysza/agents2` at `main`, prints plain widget frames every 3 seconds, and deletes the agent afterward. Tests use fake clients and make no network requests. Tests, compiled output, and smoke scripts are excluded from the published package.

The pure lifecycle reducer is in `src/state.ts`. `src/render.ts` formats the widget and completion messages. `src/cloud-client.ts` owns SDK calls and credential redaction. `src/repo.ts` resolves git defaults. `src/widget.ts` owns UI timers. `src/index.ts` registers the tools, command, and lifecycle handlers.
