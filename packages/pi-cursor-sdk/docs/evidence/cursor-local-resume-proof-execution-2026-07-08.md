# Cursor local resume proof execution — 2026-07-08

> **Historical snapshot — superseded 2026-07-09.** This document records the proof status before recorded-ID cleanup landed. Cleanup was later implemented and proved across macOS, Ubuntu, and Windows, and local resume is now default-on with opt-out. See [cleanup proof and current decision](cursor-local-resume-cleanup-proof-2026-07-09.md) and [the current UX spec](../cursor-model-ux-spec.md).

Purpose: execute the outstanding real proof for local Cursor SDK resume without flipping the built-in default on at capture time.

Result at capture time: most default-on proof was green, including tree safety after a code fix and full macOS/Ubuntu/Windows platform promotion. **The recommendation then remained: do not flip default-on yet** because recorded-ID-only local SDK cleanup/GC was not implemented or proven.

## What changed for proof

- Fixed tree safety: an old resume handle is rejected when the same session/pool/SDK agent has a newer resume handle anywhere in the session file.
- Added focused smoke lanes:
  - `npm run smoke:local-resume:tree`
  - `npm run smoke:local-resume:copy-switch`
  - `npm run smoke:local-resume:fallback`
  - `npm run smoke:local-resume:compaction`
  - `npm run smoke:local-resume:default-dry-run`
- Promoted required platform suites:
  - `cursor-local-resume-safety`
  - `cursor-local-resume-tool-surface`
  - `cursor-local-resume-abort`
  - `cursor-local-resume-tree`
  - `cursor-local-resume-copy-switch`
  - `cursor-local-resume-fallback`
  - `cursor-local-resume-compaction`
  - `cursor-local-resume-default-dry-run`
- Kept built-in default behavior unchanged. Default-on was only simulated with a temp `PI_CODING_AGENT_DIR/cursor-sdk.json` inside the dry-run smoke.

## Focused local proof

Command log: `.artifacts/local-resume-proof-focused-2026-07-08.log`

All passed:

```bash
npm run smoke:local-resume
npm run smoke:local-resume:safety
npm run smoke:local-resume:tool-surface
npm run smoke:local-resume:abort
npm run smoke:local-resume:tree
npm run smoke:local-resume:copy-switch
npm run smoke:local-resume:fallback
npm run smoke:local-resume:compaction
```

Observed markers:

```text
local-resume-smoke-ok
local-resume-safety-smoke-ok
local-resume-tool-surface-smoke-ok
local-resume-abort-smoke-ok
local-resume-tree-smoke-ok
local-resume-copy-switch-smoke-ok
local-resume-fallback-smoke-ok
local-resume-compaction-smoke-ok
```

Additional default dry-run passed separately:

```bash
npm run smoke:local-resume:default-dry-run
```

Observed marker:

```text
local-resume-default-dry-run-smoke-ok
```

## Platform matrix proof

Command:

```bash
npm run smoke:platform:all
```

Result: pass.

Artifact index: `.artifacts/platform-smoke/latest.json`

Summary:

```text
startedAt: 2026-07-08T22:10:09.393Z
finishedAt: 2026-07-08T22:29:55.261Z
ok: true
runIds:
  macOS:          run-1783548609397-r2lpp4
  Ubuntu:         run-1783548609399-v2dair
  Windows native: run-1783548609400-zprb7f
```

Every target passed:

| Suite | macOS | Ubuntu | Windows native |
| --- | --- | --- | --- |
| `platform-build` | pass | pass | pass |
| `cursor-native-visual-matrix` | pass | pass | pass |
| `cursor-bridge-visual-matrix` | pass | pass | pass |
| `cursor-abort-cleanup` | pass | pass | pass |
| `cursor-local-resume-restart` | pass | pass | pass |
| `cursor-local-resume-safety` | pass | pass | pass |
| `cursor-local-resume-tool-surface` | pass | pass | pass |
| `cursor-local-resume-abort` | pass | pass | pass |
| `cursor-local-resume-tree` | pass | pass | pass |
| `cursor-local-resume-copy-switch` | pass | pass | pass |
| `cursor-local-resume-fallback` | pass | pass | pass |
| `cursor-local-resume-compaction` | pass | pass | pass |
| `cursor-local-resume-default-dry-run` | pass | pass | pass |

A prior platform attempt failed only because Windows finished `smoke:local-resume:abort` successfully and then hit `EPERM` deleting temp artifacts. The smoke cleanup was changed to best-effort retry/warn cleanup, and the failed Windows abort suite passed on rerun before the final full matrix pass.

## Proof details by requirement

| Requirement | Proof now available | Evidence |
| --- | --- | --- |
| Same-session restart | Pass | `cursor-local-resume-restart` on macOS/Ubuntu/Windows; focused `npm run smoke:local-resume`. |
| Fork/clone isolation | Pass | `cursor-local-resume-safety` on macOS/Ubuntu/Windows; original agent rejected for clone and fork-before-future. |
| Tool-surface mismatch | Pass | `cursor-local-resume-tool-surface` on macOS/Ubuntu/Windows; old handle rejected after bridge/builtin tool-surface change. |
| Abort/interrupted turn | Pass | `cursor-local-resume-abort` on macOS/Ubuntu/Windows; interrupted bridge turn appends no handle and next restart uses new agent. |
| Tree navigation | Pass after fix | `cursor-local-resume-tree` on macOS/Ubuntu/Windows; earlier assistant and earlier resume-entry targets reject future-seeing agent and do not leak future token. |
| Session copy/switch/import-like copied file | Pass | `cursor-local-resume-copy-switch` on macOS/Ubuntu/Windows; copied resume entry rejected, transcript still bootstraps token. |
| Missing SDK agent fallback | Pass | `cursor-local-resume-fallback` on macOS/Ubuntu/Windows; missing agent creates new agent, bootstraps token, and emits continuity notice in `pi-stream-events.jsonl`. |
| Compaction boundary | Pass | `cursor-local-resume-compaction` on macOS/Ubuntu/Windows; pre-compaction agent rejected, post-compaction handle records `compactionGeneration: 1`, and restart resumes post-compaction agent. |
| Default-on/opt-out dry run | Pass without changing defaults | `cursor-local-resume-default-dry-run` on macOS/Ubuntu/Windows; isolated temp user config `local.resume: true` resumes, `PI_CURSOR_LOCAL_RESUME=0` opts out and creates a new agent. |
| Cleanup/GC of superseded local SDK agents | **Blocked** | No recorded-ID-only local cleanup implementation exists yet. SDK local-store delete filters are match-all when IDs are omitted or empty, so proof must wait for exact recorded agent/run/checkpoint ownership and empty-filter guards. |

## Validation commands

All passed:

```bash
npm run check:platform-smoke
npm run smoke:local-resume:tree
npm run smoke:local-resume:copy-switch
npm run smoke:local-resume:fallback
npm run smoke:local-resume:compaction
npm run smoke:local-resume:default-dry-run
npm run smoke:platform:all
npm test
npm run typecheck
npm pack --dry-run
git diff --check
```

The focused all-lane log also shows `npm run smoke:local-resume`, `:safety`, `:tool-surface`, and `:abort` after the tree-safety fix.

## Recommendation

Do **not** flip local resume default-on yet.

Reason: the core resume safety, lifecycle, fallback, compaction, tree, default/opt-out, and cross-platform proofs are now green, but default-on would create more superseded local SDK agents and there is still no safe recorded-ID-only local cleanup/GC implementation. The SDK store deletion APIs are dangerous when filters are empty, so cleanup should be implemented and proven before exposing this to every user by default.

Recommended next route:

1. Keep local resume opt-in/default-off.
2. Implement local cleanup/GC as a separate, recorded-ID-only feature:
   - record exact predecessor agent IDs, run IDs, checkpoint/blob IDs if needed;
   - reject empty filters at every delete boundary;
   - never sweep global SDK state;
   - dry-run/list before delete;
   - prove only recorded superseded IDs are eligible.
3. Add focused and platform cleanup proof.
4. Then bring the full evidence package back for default-on approval.
