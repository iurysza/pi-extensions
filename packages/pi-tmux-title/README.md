# pi-tmux-title

Keep the Pi terminal title and current tmux window named after the session.
Titles come from the session name or first user prompt, normalized to a compact
kebab-case slug.

## Install

```bash
pi install npm:@iurysza/pi-tmux-title
```

Restart Pi or run `/reload` after installation.

## How it works

- Updates Pi's terminal title when the session title changes.
- Renames the current tmux window when Pi runs inside tmux.
- Restores tmux automatic window naming when the session shuts down.
- Provides `/retitle` to synchronize after you rename a session.

Outside tmux, the terminal title still updates and tmux operations are silent
no-ops.

## Requirements

- Pi
- Node.js 22.19 or newer
- tmux only for window renaming

## License

MIT