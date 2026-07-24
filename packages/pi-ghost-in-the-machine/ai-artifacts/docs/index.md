# Ghost in the Machine MOC

> Map of content for Ghost in the Machine knowledge. Start with the question you have, then follow the links.

This project is documented as a small knowledge base, not one giant manual. The [`README`](../../README.md) is the public landing page. This index is the maintainer map.

## Start here

Read these in order when you are new to the project:

1. [`README`](../../README.md) — what the package does and the shortest install path.
2. [`Architecture`](../ARCHITECTURE.md) — Pi, Herdr, controller, Ghostty, and shader boundaries.
3. [`Semantic map`](../SEMANTIC_MAP.md) — desired, pane, active, and sidebar state.
4. [`Agent onboarding`](../AGENT_ONBOARDING.md) — repository map, common changes, and pitfalls.

Agents should also read [`AGENTS.md`](../../AGENTS.md), the terse repository operating map.

## Task map

| If you need to | Read |
|---|---|
| understand a stale or wrong face | [`Semantic map`](../SEMANTIC_MAP.md), then [`Architecture`](../ARCHITECTURE.md) |
| change Pi event mapping, timing, or commands | [`Lifecycle`](./lifecycle.md), then `src/index.ts` |
| change focus, sidebar, sockets, or watcher behavior | [`Architecture`](../ARCHITECTURE.md), [`Operations`](./OPERATIONS.md) |
| install, diagnose, or release the package | [`Operations`](./OPERATIONS.md) |
| touch GLSL or face placement | [`Visual model`](./VISUAL_MODEL.md) |
| understand the polling trade-off | [`Watcher performance`](./WATCHER_PERFORMANCE.md) |
| find planned engineering work | [`Roadmap`](./ROADMAP.md) |
| record a durable trade-off | [`decisions`](./decisions/INDEX.md) |

## Core maps

[`Architecture`](../ARCHITECTURE.md) explains the control plane, render plane, Ghostty reload contract, and Herdr integration boundaries.

[`Semantic map`](../SEMANTIC_MAP.md) defines the state vocabulary that prevents most bugs: desired state, pane state, active state, and sidebar gate.

[`Lifecycle`](./lifecycle.md) defines event mapping, coalescing, error persistence, and manual-command semantics.

## Working docs

[`Operations`](./OPERATIONS.md) covers setup, runtime paths, diagnosis, live sidebar verification, and release checks.

[`Visual model`](./VISUAL_MODEL.md) covers shader variants, placement, coordinates, and visual invariants.

[`Watcher performance`](./WATCHER_PERFORMANCE.md) records the measured Bash-versus-Node trade-off and its limits.

[`Roadmap`](./ROADMAP.md) keeps worthwhile work visible without turning the README into a promise list.

## Current facts

- Pi emits intent; the controller selects a Ghostty shader path; Ghostty receives a reload signal.
- Ghostty renders one global shader pipeline while Herdr owns local panes.
- `ghostty-state.conf` under `XDG_STATE_HOME` is Ghostty's actual runtime input.
- The watcher polls Herdr's API socket and invokes Bash only on sidebar transitions.
- Shader variants are generated from one source shader and committed together.

## Verification quick map

| Change | Minimum evidence |
|---|---|
| TypeScript, shell, or generated shader | `npm run check` |
| Controller or watcher | `npm test` |
| Package surface | `npm pack --dry-run` |
| Sidebar behavior | `scripts/verify-live-sidebar.sh` inside focused Herdr Pi pane |
| Docs only | `git diff --check` and link/path sanity |

Update this map when a path, runtime contract, verification command, or ownership boundary changes.
