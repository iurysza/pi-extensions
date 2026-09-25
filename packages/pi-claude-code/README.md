# @iurysza/pi-claude-code

A pi provider extension that answers Claude turns through your own [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, so pi can use the Claude Pro or Max subscription you are logged in to.

pi keeps the agent loop. Every tool call is a normal pi tool call, with pi's approvals, rendering, and session history. Claude Code only produces the model answer for one turn at a time.

## Subscription and policy

Read this before you install.

- The extension runs **your** `claude` binary with **your** login, on **your** machine. It never reads, stores, or forwards credentials. The CLI sends the request to Anthropic itself.
- Anthropic sees this traffic as Claude Agent SDK traffic from Claude Code (`cc_entrypoint=sdk-cli`). Anthropic's terms for the Agent SDK say third-party products may not offer claude.ai login or its rate limits without approval. This package is a personal tool for your own account. It is not a hosted service and does not offer anyone else's login.
- Usage counts against your subscription allowance. Some long-context models draw from paid usage credits instead. The model picker labels those models `· usage credits`.
- If you want API-key, Bedrock, Vertex, or Foundry billing, use pi's `anthropic` provider instead.

## Requirements

- Node.js 22.19 or newer.
- pi 0.80.10 or newer.
- Claude Code installed as `claude` on `PATH`, or set `PI_CLAUDE_CODE_COMMAND` to its path. The extension was verified against Claude Code 2.1.282.
- A Claude Code subscription login: run `claude auth login`.
- macOS or Linux. Native Windows is untested.

## Install

```bash
pi install npm:@iurysza/pi-claude-code
```

Source lives in [`iurysza/pi-extensions`](https://github.com/iurysza/pi-extensions/tree/main/packages/pi-claude-code).

## Use

```bash
pi --model claude-code/claude-sonnet-5
```

Use `/model` in pi to switch between `claude-code` models. Use `--thinking` or pi's thinking control to set the effort level. `off` disables thinking on models that allow it; other levels map to Claude's adaptive thinking with the matching effort.

### Models

Until the first refresh, pi shows a pinned list of 200K-context models: `claude-sonnet-5`, `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-fable-5-1`, and `claude-haiku-4-5`.

When pi refreshes models, the extension asks your CLI for the models your account offers and caches the answer for 24 hours. The refresh runs offline against the CLI and sends no model request. 1M-context routes become separate models with a `-1m` suffix, for example `claude-sonnet-5-1m`. If the refresh fails or you are logged out, pi keeps the cached or pinned list.

### Commands

| Command | What it does |
| --- | --- |
| `/claude-code-status` | Shows the CLI path and version, the login state, any blocking environment variables, and the outcome of the last turn. |
| `/claude-code-refresh-models` | Reloads the model list from your account now, ignoring the cache. |

### Configuration

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PI_CLAUDE_CODE_COMMAND` | `claude` on `PATH` | Path to the Claude Code binary. |
| `PI_CLAUDE_CODE_IDLE_TIMEOUT_MS` | `180000` | Stops a turn when the CLI and the response are silent for this long. |

The extension refuses to run while any of these are set in pi's environment, because they would move the turn off your subscription: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, and `CLAUDE_CODE_USE_FOUNDRY`. Unset them for pi, or use pi's `anthropic` provider.

## How a turn works

1. pi calls the provider with the conversation and the enabled tools.
2. The extension starts `claude -p --max-turns 1` in a fixed, empty directory, `~/.cache/pi-claude-code/cwd`. The CLI's built-in tools, MCP servers, hooks, plugins, slash commands, `CLAUDE.md`, and session files are all turned off.
3. It replays the conversation to the CLI as `stream-json` frames and sends pi's tools in the request body under an `mcp__pi__` prefix.
4. The CLI's request goes to a loopback relay. The relay forwards exactly one request to Anthropic and moves the prompt-cache breakpoint so later turns reuse the cached history. It denies any later request in the same turn.
5. The relay reads the streamed answer and passes it to pi as text, thinking, and tool-call events. A tool call ends the turn, and pi runs the tool and starts the next turn.

Thinking signatures carry across tool calls as long as you stay on the same model. When you switch models, earlier thinking is replayed as plain text.

## Troubleshooting

| Message | Fix |
| --- | --- |
| `Claude Code is not logged in. …` | Run `claude auth login` in a terminal, then retry. |
| `Claude Code CLI not found …` | Install Claude Code, or set `PI_CLAUDE_CODE_COMMAND`. |
| `The claude-code provider refuses to run while … set` | Unset the listed variables in the environment that starts pi. |
| `Claude Code rejected the replayed conversation history.` | The CLI protocol probably changed. Run `/claude-code-status`, note the version, and report it. |
| `Claude Code produced no output for … s and was stopped.` | Retry. If it repeats, raise `PI_CLAUDE_CODE_IDLE_TIMEOUT_MS`. |
| `Claude API error (429): …` | Your subscription limit or a rate limit was reached. pi retries rate limits on its own. |

## Limitations

- Claude Code's own tools, subagents, skills, and MCP servers are not available. Use pi's tools.
- Cost is reported as 0, because usage is subscription allowance rather than dollars.
- The extension does not check the CLI version. A future Claude Code release can change the replay protocol. The contract tests below are the early warning.

## Development

```bash
npm test                 # unit tests and end-to-end tests with a fake CLI and a fake Anthropic server
npm run test:contract    # the same scenarios against the real Claude Code 2.1.282 binary, downloaded to .cache/
npm run smoke:live       # two real turns through pi on your own login; spends a little usage
```

The contract lane needs no Claude account. It runs the real binary with a dummy token against a loopback fake server.

## Credits

The transport design is ported from Nous Research's [Hermes DirectSDK plugin](https://github.com/NousResearch/hermes-plugin-claude-subscription-directsdk). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
