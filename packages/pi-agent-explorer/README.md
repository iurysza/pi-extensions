# Pi Agent Explorer

A [Pi package](https://pi.dev) that creates a read-only snapshot of the current Pi runtime: loaded skills, context files, extensions, tools, commands, session paths, and context usage.

## Install

```bash
pi install git:github.com/iurysza/pi-agent-explorer
```

Restart Pi or run `/reload`, then run:

```text
/agent-explorer
```

## Launch behavior

1. **Herdr 0.7.4+** — an 80% modal popup. The package links its tiny local Herdr plugin on first use.
2. **tmux** — a focused right-hand split.
3. **No multiplexer** — a new Ghostty window on macOS.

The explorer runs `nvim -R` on a timestamped snapshot under Pi's cache directory. Neo-tree is used when your Neovim setup opens it for directories; otherwise Neovim's directory browser is used.

## Requirements

- Pi
- Neovim
- Optional: Herdr 0.7.4+ for popups
- Optional: tmux for split fallback
- Ghostty on macOS for the no-multiplexer fallback

## License

MIT
