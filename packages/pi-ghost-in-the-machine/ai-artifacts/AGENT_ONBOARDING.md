# Agent Onboarding — Ghost in the Machine

> Maintainer handoff: what matters, where the dragons are, and how to change this safely.

## 1. What this is

Ghost in the Machine is a Pi extension that projects one Pi pane's lifecycle into a Ghostty shader. It is intentionally small, but it spans three independent runtimes:

- **Pi extension** — maps session/tool events to `idle`, `thinking`, `working`, `done`, and `error`.
- **Controller** — remembers pane state, chooses one shader path, writes Ghostty's runtime fragment, and requests reload.
- **Herdr integration** — routes focus and sidebar visibility when Pi runs inside Herdr.

The load-bearing constraint:

> **Ghostty is global; Pi and Herdr panes are local.**

Do not change lifecycle mapping, focus routing, or sidebar behavior without reading the architecture and semantic map first.

## 2. Repository map

```text
pi-ghost-in-the-machine/
├── src/index.ts                   # Pi lifecycle mapping and command queue
├── scripts/ghost-state.sh         # controller, pane memory, watcher lifecycle
├── scripts/sidebar-watcher.mjs    # Herdr socket polling and transition dispatch
├── shaders/                        # source shader and generated state variants
├── tests/                          # controller, watcher, packaging checks
├── herdr-plugin.toml              # focus-event hook
├── ai-artifacts/                  # maintainer knowledge base
└── README.md                      # public installation and command contract
```

## 3. Read these first

1. [`README`](../README.md) — supported behavior and install path.
2. [`Architecture`](./ARCHITECTURE.md) — Pi, Herdr, controller, Ghostty, and shader boundaries.
3. [`Semantic map`](./SEMANTIC_MAP.md) — desired, pane, active, and sidebar state.
4. [`Docs map`](./docs/index.md) — task-specific documentation.

## 4. Common changes

| Change | Start here | Verify |
|---|---|---|
| Pi lifecycle or commands | `src/index.ts`, [`Lifecycle`](./docs/lifecycle.md) | `npm test`; manually exercise a Pi session |
| Focus/sidebar behavior | `ghost-state.sh`, `sidebar-watcher.mjs`, [`Operations`](./docs/OPERATIONS.md) | `npm test`; run live sidebar verification inside Herdr |
| Shader behavior | `shaders/ghost-in-the-machine.glsl`, [`Visual model`](./docs/VISUAL_MODEL.md) | `npm run generate`, `npm run check`, visual check |
| Installation/runtime paths | `setup.sh`, [`Operations`](./docs/OPERATIONS.md) | `npm pack --dry-run`; fresh setup smoke test |

## 5. Verification

```sh
npm run generate
npm run check
npm test
npm pack --dry-run
```

Run `scripts/verify-live-sidebar.sh` only from a focused Pi pane inside Herdr with Ghostty running.

## 6. Pitfalls

- `ghostty-state.conf` is Ghostty's real input; `active.state` is only controller memory.
- `off` removes the shader path. It is visibility, not a face state.
- Shader content changes alone do not reload Ghostty; a path swap plus `SIGUSR2` does.
- Sidebar geometry is a heuristic. Do not invent additional visibility rules without live evidence.
- Generated shader variants are tracked. Never edit them by hand.
- Runtime state is user-owned under `XDG_STATE_HOME` (default `~/.local/state`), never inside the package.
