# Pi UI Consolidation

Create one coherent tool-call presentation and one extensible footer surface across the Pi packages in this monorepo.

## Outcomes

- pi-ext uses Tidy-style compact cards as the sole built-in tool presenter.
- Expanded edit/write cards retain pi-ext's Shiki rich diffs.
- Cursor SDK replayed built-ins use the same compact cards without re-executing recorded work.
- Cursor-only activity uses bounded one-line neutral cards.
- pi-ext's footer hosts prioritized extension slots on one auxiliary line.
- Token Tank and Cache Hit Predictor participate through slots while remaining usable without pi-ext.
- Cursor SDK and Cache Hit Predictor become independently installable `@iurysza` packages in this monorepo.

## Constraints

- Preserve public source provenance and licenses with unsquashed subtree imports.
- Keep Tidy implementation inside `@iurysza/pi-ext`; do not publish another overlapping Tidy package.
- Keep Cursor SDK and Cache Hit Predictor as separate child packages.
- Keep one root lockfile and the explicit root Pi resource union.
- Do not modify installed Pi configuration, profiles, old repositories, or upstream repositories during implementation.
- Prove parity in disposable Pi directories before proposing live migration.
