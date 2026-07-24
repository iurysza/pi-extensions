# Pi Extensions Monorepo

- Keep the root workspace private; publish only scoped child packages.
- The root `pi` manifest is the explicit union of every child Pi resource. Update it with every child manifest change.
- Import repository history with `git subtree`; never use Git submodules.
- Preserve `packages/pi-ext` provenance, licenses, and third-party notices.
- Do not modify `/Users/iurysouza/dev/personal/tools/agents`, installed Pi configuration, profiles, or old source repositories while working here.
- Keep exactly one root `package-lock.json`; child locks are forbidden.
- Run `npm ci` and `npm run check` before committing.
