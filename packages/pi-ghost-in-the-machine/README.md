# pi-ghost-in-the-machine

A tiny animated face in Ghostty that reacts to Pi. The shader follows agent
lifecycle changes and disappears when its pane is no longer relevant.

<p align="center">
  <img src="https://github.com/user-attachments/assets/c3a523f9-0c59-4738-bd11-c39ba39c1a42" alt="A glowing ASCII face and lifecycle symbols inside a dark terminal viewport" width="50%">
</p>

https://github.com/user-attachments/assets/c4004364-b363-45d1-a981-5779d1d80682

## Install

```bash
pi install npm:@iurysza/pi-ghost-in-the-machine
"${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/npm/node_modules/@iurysza/pi-ghost-in-the-machine/scripts/setup.sh"
```

Then restart Pi or run `/reload`.

The setup script:

- adds a managed shader-state fragment to Ghostty's configuration;
- enables shader animation when needed;
- links the Herdr plugin when Herdr is available; and
- starts the state watcher in `idle`.

## Lifecycle

The normal progression is:

```text
idle → thinking → working → done
```

A failed tool settles on `error`. Shutdown, non-Pi focus, or a collapsed Herdr
sidebar selects `off`. Visible states remain for at least two seconds so
Ghostty has time to compile and display the selected shader.

## Commands

| Command | Description |
| --- | --- |
| `/ghost-idle`, `/ghost-thinking`, `/ghost-working`, `/ghost-done`, `/ghost-error` | Force a visible lifecycle state. |
| `/ghost-off` | Hide the face. |
| `/ghost-on` | Restore the desired state. |
| `/ghost-disable` | Disable automatic transitions for the current Pi session. |
| `/ghost-status` | Show extension, sidebar, watcher, and shader state. |

## Requirements

- Pi 0.80.4 or newer
- Ghostty 1.3 or newer
- Node.js 22.19 or newer
- Bash, `pgrep`, and `jq`
- Optional: Herdr 0.7.4 or newer for focused-pane and sidebar routing

Without Herdr, the face still follows Pi lifecycle events. Herdr adds
focused-pane ownership and collapsed-sidebar behavior.

## License

MIT. The shader derives from
[isoden/claude-terminal-face](https://github.com/isoden/claude-terminal-face).
See [NOTICE](NOTICE) for attribution.