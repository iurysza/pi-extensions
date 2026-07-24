# Roadmap

> Work worth keeping, not promises.

## 1. Make control ownership explicit

The next reliability milestone is a single serialized control path for Ghostty's global shader fragment.

It should:

1. serialize lifecycle, manual-command, focus, sidebar, startup, and shutdown writes
2. establish which Herdr socket/pane currently owns the global Ghostty output
3. prevent a stale focus or sidebar event from applying after newer focus wins
4. make `/ghost-off`, `/ghost-disable`, and forced states actually win over queued lifecycle work

This is the highest-value follow-up because the current system has local pane state but one global renderer target.

Related docs:

- [`Architecture`](../ARCHITECTURE.md)
- [`Semantic map`](../SEMANTIC_MAP.md)
- [`Lifecycle`](./lifecycle.md)

## 2. Harden watcher lifecycle

Make watcher start and stop one atomic per-socket operation. A stop requested during startup must not leave an orphaned watcher; timeout and stop should clean up controller descendants too.

Add focused tests for start/stop overlap and non-`exec` blocked controller children.

Related docs:

- [`Operations`](./OPERATIONS.md)
- [`Watcher performance`](./WATCHER_PERFORMANCE.md)

## 3. Replace polling when Herdr exposes an event

The Node watcher removes client-side process churn, but still polls `pane.layout`. If Herdr adds a trustworthy sidebar visibility event, replace polling rather than layering a second heuristic on top of it.

Do not guess hidden-sidebar behavior from geometry before that API exists.

## 4. Keep the docs honest

As behavior changes, keep these maps aligned:

- public install and command claims in [`README`](../../README.md)
- runtime ownership in [`Architecture`](../ARCHITECTURE.md) and [`Semantic map`](../SEMANTIC_MAP.md)
- operational commands and prerequisites in [`Operations`](./OPERATIONS.md)
- verification evidence in [`Watcher performance`](./WATCHER_PERFORMANCE.md)

Record a decision only when it is durable, non-obvious, and meaningfully constrains future work. Put it under [`decisions/`](./decisions/INDEX.md).
