# pi-ghost-in-the-machine



<p align="center">
  <img src="https://github.com/user-attachments/assets/c3a523f9-0c59-4738-bd11-c39ba39c1a42" alt="A glowing ASCII face and lifecycle symbols inside a dark terminal viewport" width="50%">
</p>

A tiny GSL SHader ASCII face floating in Herdr's side panel. It follows Pi agent state changes and disappears when its pane is no longer relevant.


https://github.com/user-attachments/assets/c4004364-b363-45d1-a981-5779d1d80682


## Requirements

- Pi 0.80.4+
- Ghostty 1.3+
- Node 22.19+, Bash, `pgrep`, and `jq`
- Herdr 0.7.4+ for focused-pane and sidebar routing (optional)

## Install

```sh
pi install git:github.com/iurysza/pi-ghost-in-the-machine
~/.pi/agent/git/github.com/iurysza/pi-ghost-in-the-machine/scripts/setup.sh
```

Then reload Pi:

```text
/reload
```

The setup script adds the stable Ghostty state fragment, links the Herdr plugin when available, and selects `idle`. A Pi session started inside Herdr starts its per-socket watcher. For manual setup, runtime files, and diagnosis, see the [engineering map](ai-artifacts/docs/index.md).

## Lifecycle and commands

`idle -> thinking -> working -> done`; a failed tool settles on `error`. Shutdown, non-Pi focus, or a collapsed Herdr sidebar selects `off`. Visible states remain for at least two seconds so Ghostty can compile the selected shader.

| Command | Action |
| --- | --- |
| `/ghost-idle`, `/ghost-thinking`, `/ghost-working`, `/ghost-done`, `/ghost-error` | Force a visible state |
| `/ghost-off` / `/ghost-on` | Hide or restore the desired state |
| `/ghost-disable` | Disable automatic transitions for this Pi session |
| `/ghost-status` | Show extension, sidebar, watcher, and shader state |

## Development

```sh
npm install
npm run generate
npm run check
npm test
npm pack --dry-run
```

Edit `shaders/ghost-in-the-machine.glsl`, then commit every regenerated file under `shaders/variants/`. Architecture, lifecycle, watcher protocol, diagnostics, performance, and release checks live in the [engineering docs](ai-artifacts/docs/index.md).

# Shout out
Huge thanks to [isoden/claude-terminal-face](https://github.com/isoden/claude-terminal-face) for the work on this concept and the shaders. See [NOTICE](NOTICE) and [LICENSE](LICENSE).
