# Pi Extensions

A working collection of extensions, skills, and themes for [Pi](https://pi.dev),
the terminal coding agent. These are focused tools rather than a single
all-or-nothing setup: install the packages that fit your workflow.

| Package | Description |
| --- | --- |
| [@iurysza/pi-ext](packages/pi-ext) | Command palette, review tooling, session workflows, TUI polish, and Pi integrations. |
| [@iurysza/pi-ghost-in-the-machine](packages/pi-ghost-in-the-machine) | Reactive Ghostty shader face for Pi lifecycle states. |
| [@iurysza/pi-token-tank](packages/pi-token-tank) | Subscription quota gauges for OpenAI Codex, Kimi, GitHub Copilot, and Cursor. |
| [@iurysza/pi-agent-explorer](packages/pi-agent-explorer) | Read-only Neovim snapshot of Pi's loaded runtime. |
| [@iurysza/pi-context-audit](packages/pi-context-audit) | Inspect prompt, tool-schema, context, and MCP overhead. |
| [@iurysza/pi-tmux-title](packages/pi-tmux-title) | Keep Pi and tmux window titles aligned with the session. |
| [@iurysza/pi-secret-env](packages/pi-secret-env) | Load shared credentials while blocking and redacting secret access. |

## Install

Install any package with Pi:

```bash
pi install npm:@iurysza/pi-token-tank
```

Restart Pi or run `/reload` after installation. Each package README covers its
configuration and requirements.

## Development

```bash
npm ci
npm run check
```

The repository is an npm workspace. The root package is private; each package
under [`packages/`](packages) is independently publishable.

## License

The root [MIT license](LICENSE) covers Iury-owned packages. `pi-ext` and
`pi-ghost-in-the-machine` retain their own licenses and attribution notices.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).