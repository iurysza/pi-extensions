# Changelog

## 0.1.0 - Unreleased

### Added

- Add the `claude-code` provider. Each pi turn runs the user's Claude Code CLI once with `--max-turns 1` on the user's subscription login, while pi runs every tool.
- Add a loopback admission relay that forwards one Messages request per turn, denies any later request, pins the prompt-cache breakpoint onto the latest message, and streams the captured answer to pi.
- Replay pi history as `stream-json` frames in order, carrying signed thinking across tool calls on the same model.
- Add a pinned 200K model list and a refresh from the account's own model picker, cached for 24 hours. 1M routes appear as separate `-1m` models, labeled when they draw from usage credits.
- Add `/claude-code-status` and `/claude-code-refresh-models`.
- Refuse turns while `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, or a Bedrock, Vertex, or Foundry switch is set.
- Add a fake-CLI test lane, a contract lane against the real Claude Code 2.1.282 binary, and a live smoke script.
