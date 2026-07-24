# @iurysza/pi-tmux-title

Pi extension that turns the session name or first user prompt into a compact
kebab-case title, updates Pi's terminal title, and keeps the current tmux window
name in sync.

It requires tmux for window renaming. Outside tmux, the extension still updates
Pi's terminal title and tmux operations are a no-op. On shutdown it restores
tmux automatic window naming when running inside tmux.

Use `/retitle` to force synchronization after renaming a session.

## Development

```sh
npm run check
npm pack --dry-run
```

## Provenance

Extracted from
`agents/pi/agent/extensions/pi-tmux-kebab-title.ts` at source commit
`466f46ae1834a0ad66c4909186494d31b9a8dbdd`.

## License

MIT
