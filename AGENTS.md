# Pi extensions

Pi toolbox monorepo adapted to Iury's workflow.

## Map

| Topic | Rule |
| --- | --- |
| Docs | How-it-works docs live under `ai-artifacts/` in `goals/`, `plans/`, and `specs/`. Start there. Update them when architecture or behavior changes. |
| Publish | Keep the root workspace private. Publish only scoped child packages. |
| Catalog | The root `pi` manifest is the explicit union of every child Pi resource. Update it with every child manifest change. |
| Imports | Import repository history with `git subtree`. Do not use Git submodules. Preserve imported package provenance, licenses, and third-party notices. |
| Lockfile | Keep exactly one root `package-lock.json`. Child lockfiles are forbidden. |
| Boundary | Do not modify the external `agents` repository, installed Pi configuration, profiles, or old source repositories while working here. |
| Subagents patch | After every `@tintinweb/pi-subagents` install, update or reinstall (agents2 replaces the package dir and wipes the patch), run `packages/pi-ext/patches/tintinweb-pi-subagents/0.19.0/apply.sh`, then `/reload` in pi. `apply.sh --status` shows whether it is applied. If the patch no longer applies to a new version, it exits 2 and changes nothing: regenerate it (see that folder's `README.md`). No upstream PR is planned. |
| Startup bundles | Some entries load from git-ignored bundles in `packages/<pkg>/.prebundle/`. The entry `index.ts` is a loader; the code is in `main.ts`. See `ai-artifacts/specs/2026-11-10-startup-prebundle.md`. |
| Commits | Never include Cursor, or any Cursor agent or bot, as git author or committer. Never add Cursor in a `Co-authored-by` trailer or a similar trailer. |

## Closed loop

Before committing, run `npm ci`, then `npm run check`.

| Script | Runs |
| --- | --- |
| `check` | `npm run check:catalog && npm run typecheck && npm test && npm run check:packs && npm run check:bundles` |
| `check:catalog` | `node scripts/check-catalog.mjs` |
| `typecheck` | `npm run typecheck --workspaces --if-present` |
| `test` | `npm test --workspaces --if-present` |
| `check:packs` | `node scripts/check-packs.mjs` |
| `check:bundles` | `node scripts/build-bundles.mjs --strict && node --import tsx --test "tests/prebundle/*.test.mjs"` |
| `build:bundles` | `node scripts/build-bundles.mjs` |
| `build` | `npm run build:bundles` |
| `pack:check` | `npm run check:packs` |
| `prepublishOnly` | `node scripts/refuse-root-publish.mjs` |

`prepublishOnly` refuses a root publish.
