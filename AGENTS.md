# Pi Extensions Monorepo

- Keep the root workspace private; publish only scoped child packages.
- The root `pi` manifest is the explicit union of every child Pi resource. Update it with every child manifest change.
- Import repository history with `git subtree`; never use Git submodules.
- Preserve imported package provenance, licenses, and third-party notices.
- Do not modify the external `agents` repository, installed Pi configuration, profiles, or old source repositories while working here.
- Keep exactly one root `package-lock.json`; child locks are forbidden.
- Run `npm ci` and `npm run check` before committing.

## Git commits
Never include Cursor (or any Cursor agent/bot) as git author, committer, or in a Co-authored-by / similar trailer.
