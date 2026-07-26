# Pi Extensions

A working collection of extensions, skills, and themes for [Pi](https://pi.dev),
the terminal coding agent. These are focused tools rather than a single
all-or-nothing setup: install the packages that fit your workflow.

| Package | Description |
| --- | --- |
| [@iurysza/pi-ext](packages/pi-ext) | Command palette, review tooling, session workflows, TUI polish, and Pi integrations. |
| [@iurysza/artifact-explorer](packages/artifact-explorer) | Open each repository's `ai-artifacts/` directory as an isolated Obsidian vault. |
| [@iurysza/pi-ghost-in-the-machine](packages/pi-ghost-in-the-machine) | Reactive Ghostty shader face for Pi lifecycle states. |
| [@iurysza/pi-token-tank](packages/pi-token-tank) | Subscription quota gauges for OpenAI Codex, Kimi, GitHub Copilot, and Cursor. |
| [@iurysza/pi-cache-hit-predictor](packages/pi-cache-hit-predictor) | Predict reusable prompt-cache prefixes across model and reasoning lanes. |
| [@iurysza/pi-cursor-sdk](packages/pi-cursor-sdk) | Run Cursor SDK models in Pi with fail-closed recorded tool replay. |
| [@iurysza/pi-agent-explorer](packages/pi-agent-explorer) | Read-only Neovim snapshot of Pi's loaded runtime. |
| [@iurysza/pi-context-audit](packages/pi-context-audit) | Inspect prompt, tool-schema, context, and MCP overhead. |
| [@iurysza/pi-secret-env](packages/pi-secret-env) | Load shared credentials while blocking and redacting secret access. |
| [@iurysza/pi-wtf](packages/pi-wtf) | Append timestamped friction notes to a repository-local WTF log. |

## Development

```bash
npm ci
npm run check
```

The repository is an npm workspace. The root package is private; each package
under [`packages/`](packages) is independently publishable.

### Isolated Pi test

Validate or drive the complete monorepo without loading or changing live Pi
configuration:

```bash
scripts/isolated-pi.sh --check
scripts/isolated-pi.sh
```

The launcher creates a temporary HOME, copies the current Pi auth and optional
keybindings files with mode `600`, loads only this local package, and deletes
the sandbox on exit.

## License

The root [MIT license](LICENSE) covers Iury-owned packages. `pi-ext` and
`pi-ghost-in-the-machine` retain their own licenses and attribution notices.
See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Install

```bash
pi install npm:@iurysza/<package-name>
```

See each package's README for setup and usage.