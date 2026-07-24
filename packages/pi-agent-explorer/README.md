# pi-agent-explorer

Inspect what Pi actually loaded. Agent Explorer opens a read-only, timestamped
Neovim snapshot of the current runtime: extensions, skills, context files,
tools, commands, session paths, and context usage.

## Install

```bash
pi install npm:@iurysza/pi-agent-explorer
```

Restart Pi or run `/reload`, then run:

```text
/agent-explorer
```

## What opens

- **Herdr 0.7.4+** — an 80% modal; the package links its small Herdr plugin on
  first use.
- **tmux** — a focused split to the right.
- **No multiplexer** — a new Ghostty window on macOS.

The snapshot opens with `nvim -R` from Pi's cache directory. If your Neovim
configuration enables Neo-tree for directories, it appears there; otherwise
Neovim's built-in directory browser does.

## Requirements

- Pi
- Neovim
- Optional: Herdr 0.7.4+ for the modal
- Optional: tmux for the split fallback
- Ghostty on macOS when no multiplexer is active

## License

MIT