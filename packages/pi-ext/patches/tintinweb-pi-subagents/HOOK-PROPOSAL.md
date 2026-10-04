# Proposal: re-apply tool-pills after package updates

Status: proposal only. Nothing in `agents2` or the generated config was changed.

## How agents2 installs this package

- `lock.json` record `tintinweb-pi-subagents` (`kind: npm`, `@tintinweb/pi-subagents@0.19.0`, `allowScripts: false`) plus `locks/npm/tintinweb-pi-subagents/{package.json,package-lock.json}`.
- `src/install/kinds.ts` `npmInputs()`: copies the manifest and lockfile into a staging dir, runs `npm ci --omit=dev --ignore-scripts` (`npmCi`), verifies, then `planInstall()` (`src/install/plan.ts`) writes a completion marker and renames staging to `~/.local/share/agents2/tools/<id>/<version>/`.
- The marker (`.agents2-complete`) holds a hash of the whole version tree. `markerValid()` recomputes it; any mismatch means "incomplete", and the directory is **replaced from staging, never repaired in place** (decision 0001, review 2.2 F6).
- I checked this: with the patch applied `markerValid` returns `false`; reverted it returns `true`.
- So an agents2 install/sync that re-evaluates the tool wipes the patch. That is the 10:14 rewrite. Pi reads the package from `settings.json` as the versioned path, so a new version also means a new, unpatched directory.
- There is no hook, patch or post-install mechanism today. The only script step is `allowScripts` (package lifecycle scripts, needs `scriptsReason`).

## Recommended: a `patches` field on npm records (agents2)

Patch inside staging, before the marker. Then the marker hashes the patched tree, so the patched version is "complete" and stays stable, and every reinstall or version bump re-applies it. A failing patch aborts the install before promotion, so the previous version stays active (nothing half-applied).

Patch files must live in the repo (`exec` paths are guarded and the plan's source roots are the repo and `locks/`), so the patch is copied or referenced from agents2, e.g. `patches/tintinweb-pi-subagents/0.19.0/tool-pills.patch`. `apply.sh` in pi-extensions is not called by this route; the `.patch` file is the shared artifact (pi-extensions stays the source of truth and agents2 vendors a copy, or the lock points at a path inside the repo).

Prototype, typechecked in a scratch copy of agents2 (not applied to the real repo). The command was also run against a pristine staging layout: it applies, and on a drifted `index.ts` it exits 1 with `patch does not apply`.

```diff
diff --git a/src/install/kinds.ts b/src/install/kinds.ts
--- a/src/install/kinds.ts
+++ b/src/install/kinds.ts
@@ -197,6 +197,8 @@ function npmInputs(id: string, record: Extract<ToolRecord, { kind: "npm" }>, rep
     { kind: "copyFile", from: manifest, to: join(staging, "package.json") },
     { kind: "copyFile", from: lockfile, to: join(staging, "package-lock.json") },
     ...npmCi(staging, tooling, record.allowScripts === true),
+    // Patches apply all-or-nothing; a failure aborts the install and leaves the previous version active.
+    ...(record.patches ?? []).map((patch): Effect => ({ kind: "exec", argv: ["/usr/bin/git", "apply", "-p1", `--directory=node_modules/${record.name}`, join(repo, patch)], cwd: staging, env: {} })),
   ];
 
   const verify = (_record: ToolRecord, staging: string): Effect[] => [
diff --git a/src/model/lock.ts b/src/model/lock.ts
--- a/src/model/lock.ts
+++ b/src/model/lock.ts
@@ -84,6 +84,8 @@ export const toolRecordSchema = z.discriminatedUnion("kind", [
     integrity: integrity.optional(),
     lockfileSha256: sha256,
     bins: bins.optional(),
+    /** Repo-relative `git apply -p1` patch files applied to node_modules/<name> in staging, before the completion marker. */
+    patches: z.array(relativePathSchema).optional(),
   }).refine(scriptsReviewed, scriptsIssue),
```

And in `lock.json`, the record gains: `"patches": ["patches/tintinweb-pi-subagents/0.19.0/tool-pills.patch"]` (the record fingerprint changes, so the next install rebuilds the version once, patched).

Still to do on the agents2 side before merging: add the patch file, a test in `test/install/kinds.test.ts`, regenerate `lock.json`/golden files, and decide whether patching needs a `patchReason` like `scriptsReason`. It is code from a different repo run at install time, so it deserves the same review gate.

## On upgrade to a new package version

The patch is pinned to 0.19.0 and is context-sensitive (`index.ts` hunks). When `update` bumps the version:

- The new staging gets the patch applied. If it does not apply, `git apply` exits non-zero, the `exec` effect fails, staging is removed (`runLocked` rollback) and the old patched version stays active. Loud failure, never half-applied (`git apply` is atomic per patch).
- The bump then needs a human: regenerate the patch (see README "Regenerate") and update the `patches` path in `lock.json`.
- `apply.sh` has the same contract for the manual route: all-or-nothing, exit 2 with `Nothing changed.`

## Fallback if agents2 gets no hook

A small `session_start` extension in `pi-ext` (not built here):

1. On `session_start`, run `apply.sh --status` against the package path from the loaded extension.
2. `applied`: silent. `not applied`: run `apply.sh` and `ctx.ui.notify("tool-pills re-applied; run /reload")`. exit 2 or 3: `notify(..., "warning")` with the message.
3. Cost: one `git apply --check`, a few ms. Weakness: the first session after an install runs unpatched until `/reload`, and it edits files under agents2's tree, which agents2's next `doctor` or install treats as drift.

Pick this only if the agents2 owner rejects the `patches` field. A launchd job is worse: it cannot tell when pi reloads, and adds a daemon for a cosmetic patch.
