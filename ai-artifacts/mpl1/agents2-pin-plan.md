# agents2 pin plan for pi-mpl-chart (research only, NOTHING APPLIED)

agents2 = `~/dev/personal/tools/agents2` (HEAD 6bf451c). `lock.json` = its lock.

## Summary

Recommended: **Option C (vendored dist)**. The pi-extensions pin installs with the same Node that runs agents2 (22.x), and mpljs needs Node 24 to build. A vendored dist needs no build, no new script allowance, and no change beyond a pin bump plus two profile lines. Option A works only if mpl's `prepare` is skipped or a Node 24 is made available; agents2 offers no per-record Node setting. Option B is not supported (git records cannot be consumed as a library by another record).

## How agents2 works (facts)

- Git pins: `kind: "git"` record with `url`, 40-hex `rev`; install is a shallow fetch of exactly `rev`, HEAD check, `.git` dropped (`src/model/lock.ts:88-96`; `src/install/sources.ts:142-153`; `docs/install.md:111`).
- pi-extensions pin: `lock.json:497-529`, rev 86f4f51, `allowScripts: true` + `scriptsReason`, `dependencies.lockfileSha256` (line 513-515) = hash of the checkout's ROOT `package-lock.json`, `productionScripts: true`, `payloadBuild` list of `.prebundle` dirs (lines 520-526).
- Install flow for it (`src/install/kinds.ts:246-263`): fetch rev, check lockfile SHA-256, `npm ci --omit=dev` at the checkout root (scripts ON because `productionScripts`), then `payload-build` (`src/install/helper.ts:102-135`: copy, `npm ci --include=dev --ignore-scripts`, `npm run build`, keep only listed outputs).
- allowScripts is a boolean per record plus a required `scriptsReason` (`src/model/lock.ts:63-72`; `docs/install.md:92`). It is NOT a per-package key like `pkg@ver`. The per-package form (`"better-sqlite3@12.11.1": true`) lives in pi-extensions' own root `package.json:15-25`, which the scriptsReason says is "the checkout's reviewed package.json allowScripts" (`lock.json:503`). agents2 does not read it (no match in `src`); npm 10 ignores it. So it is documentation only.
- Node for install/build: the Node running agents2: `defaultTooling()` uses `process.execPath` (`src/install/kinds.ts:40-42`). agents2 requires `>=22.22` (`package.json:5-7`). `local.json` `nodeRuntime` (22.23.4 Volta) only sets the script-bin launcher (`src/install/launcher.ts:48-60`, `src/apply/apply.ts:275`). The payload build puts that Node first on PATH (`helper.ts:133`). No Node 24 anywhere. `docs/catalog.md:80` already notes avoiding an npm wrapper with a Node 24 engine for the same reason.
- Pi-extension loading: the profile lists each extension path explicitly (`profiles/personal.json:184-200+`, `profiles/work.json:150`). A new child package is NOT picked up by a pin bump alone; its entry file must be added to those lists. Root `package.json` `pi.extensions` in pi-extensions also lists them (`package.json:39-72` there).
- Bump flow (`docs/updating.md:9-21`): `update pi-extensions --yes`, rewrites `lock.json`, `locks/npm`, evidence, and the root lockfile SHA. Any change to the root `package-lock.json` (a new workspace, or a git dep) changes `lockfileSha256` and is caught by the SHA check.
- Home Mac: `local.json` `devOverrides` points pi-extensions at the dev checkout (`local.json`; `docs/updating.md:27`). A pin bump does not change the home Pi; the dev checkout does. `src/apply/apply.ts:91` reportedly refused to run with overrides (`docs/handoff-2026-09-30.md:30`); unconfirmed whether that is still true.

## Option A: git dep of pi-mpl-chart, rides the pi-extensions pin

Edits:
1. In pi-extensions: add `"mpl": "git+https://github.com/ivarvong/mpl.git#689ebd4..."` (full 40-hex) to `packages/pi-mpl-chart/package.json`; regenerate root `package-lock.json`; commit. Add `./packages/pi-mpl-chart/src/index.ts` to root `pi.extensions`.
2. agents2 `lock.json` pi-extensions record: `rev` -> new commit; `dependencies.lockfileSha256` -> new root lock hash (use `update pi-extensions`). No change to `allowScripts` (already `true`, line 502); no new key exists to add. Extend `scriptsReason` (line 503) to name mpl's `prepare`.
3. `profiles/personal.json` (after line ~200) and `profiles/work.json` (line ~150): add `"packages/pi-mpl-chart/src/index.ts"` to the pi-extensions `extensions` array.

Node 24 problem: `npm ci --omit=dev` runs with scripts on (`kinds.ts:257`, `productionScripts`). npm builds a git dep by running its `prepare` (`node scripts/build_package.ts`) under Node 22, which fails and aborts the whole pi-extensions install (it is not `payloadBuildOptional` for the prod step). Handling: (a) not viable without an agents2 change (e.g. `npmCi` using a Node 24); or (b) make the git dep inert at install: depend on a fork/tag branch that contains a committed `dist` and no `prepare`. That is effectively Option C hosted on GitHub. Unconfirmed: whether npm runs `prepare` for git deps during `npm ci` with these flags; test in a scratch dir with Node 22.

## Option B: separate agents2 git pin for mpljs

Not supported. A `kind: "git"` record installs to `tools/<id>/<rev>/` and cannot be linked as a `node_modules` dependency of another record; git records also cannot declare `bins` (`docs`/`ai-artifacts/goals/pi-optmem/FINDINGS-2.md:68` in pi-extensions). The only way would be a new agents2 feature. Not recommended.

## Option C: vendored dist (recommended)

Edits: commit the built mpl dist (JS + any wasm/assets, plus LICENSE and a PROVENANCE note with commit 689ebd4) inside `packages/pi-mpl-chart/vendor/mpl/`; import it by relative path or a `file:` dependency. Build it once on a Node 24 machine. No new npm dependency means root `package-lock.json` does not change, so `lockfileSha256` stays as is. Then:
1. agents2 `lock.json` pi-extensions: `rev` -> new commit only (lock hash unchanged unless other deps change; still run `update`).
2. Profiles: add the extension path as in Option A step 3.
No `allowScripts` change.
Keep vendored files out of `payloadBuild`; they are plain checkout files and ship with the fetch.

## Steps to apply (NOT APPLIED, needs Iury's go)

1. Merge pi-mpl-chart into pi-extensions main (with vendor dist, Option C); run its `npm run check`.
2. From a clean agents2 worktree: `A2="node --experimental-strip-types --no-warnings src/cli.ts"`; `$A2 update pi-extensions --repo .` (dry run), then add `--yes` after review.
3. Edit both profiles' pi-extensions `extensions` arrays (personal line ~200, work line ~165).
4. `npm run check` in agents2; commit lock.json, locks, evidence, profiles; PR.
5. Apply via the bridge (`$A2 apply --profile personal --root ~ --repo . --allow-home --yes`). At home the dev checkout is already live, so the tool works there as soon as the dev checkout has the package and `pi.extensions` entry.

## Verify after apply

`pi -p --no-session 'list tools'` shows `mpl_render`; render one chart; `$A2 doctor`; check `~/.local/share/agents2/tools/pi-extensions/<rev>/packages/pi-mpl-chart/` exists and `.agents2-complete` is present.

## Rollback

`$A2 rollback pi-extensions` (docs/updating.md:39 mentions rollback; retention keeps two previous versions, `docs/install.md:59`) or revert the agents2 commit and re-apply. A failed install deletes its staging dir and leaves the old version (`docs/install.md:115`).

## Could not confirm

- Whether npm runs `prepare` for git deps under `npm ci --omit=dev` here (needs a Node 22 scratch test).
- Whether `apply` still refuses with `devOverrides` set (`handoff-2026-09-30.md:30` is dated; I did not read `apply.ts:91` after that).
- Exact `rollback` CLI syntax for git pins; line numbers in work.json for the exact insert point.
