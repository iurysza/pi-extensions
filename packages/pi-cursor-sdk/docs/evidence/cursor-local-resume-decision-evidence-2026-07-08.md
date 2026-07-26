# Cursor local resume decision evidence — 2026-07-08

> **Historical snapshot — superseded 2026-07-09.** This document records the evidence and decision at capture time. The tree-safety and recorded-ID cleanup blockers were later fixed and proved, and local resume is now default-on with opt-out. See [cleanup proof and current decision](cursor-local-resume-cleanup-proof-2026-07-09.md) and [the current UX spec](../cursor-model-ux-spec.md).

Purpose: collect the proof that was used to choose the next route for local Cursor SDK resume.

Bottom line at capture time: **do not flip local resume default-on yet**. Several opt-in slices were proven, but opt-in local resume still had a known-risk tree/custom-entry path: a same-file tree navigation probe resumed a future-seeing SDK agent and leaked a future token. Default-on was to wait for a tree-safety fix plus reruns.

Scope:

- Runtime: local Cursor SDK agents.
- Model used for new live probes: `cursor/composer-2-5:slow`.
- User/default behavior changed by this evidence collection: none.
- Cloud resume/default-on: out of scope and still product-deferred.

## Evidence summary

| Area | Evidence | Decision impact |
| --- | --- | --- |
| Current HEAD platform gate | `npm run smoke:platform:all` passed on 2026-07-08 from `19:48:48Z` to `19:58:23Z`. Run IDs: macOS `run-1783540128790-ckon62`, Ubuntu `run-1783540128793-3vu2a1`, Windows native `run-1783540128794-309dwz`. Suites passed on every target: `platform-build`, `cursor-native-visual-matrix`, `cursor-bridge-visual-matrix`, `cursor-abort-cleanup`, `cursor-local-resume-restart`. | Baseline provider/runtime + same-session local resume restart are green cross-platform on current HEAD. |
| Focused local resume restart | `npm run smoke:local-resume` passed. Log: `.artifacts/local-resume-decision-evidence/focused-local-resume-smokes-2026-07-08.log`. Agent `agent-893982a3-3ceb-40fb-a42b-2486c8744509` resumed across restart. | Opt-in same-session resume works locally. |
| Fork/clone safety | `npm run smoke:local-resume:safety` passed. Original agent `agent-1b23221a-be93-4d32-8696-56d7c2e0ae6f` rejected for clone and fork-before-future. | Focused clone/fork-before-future proof is green. |
| Tool-surface safety | `npm run smoke:local-resume:tool-surface` passed. Original agent `agent-4f441571-5a85-420a-8479-4f1900a1b6ff` rejected after bridge builtin tool-surface change. | Focused bridge tool-surface mismatch proof is green. |
| Abort safety | `npm run smoke:local-resume:abort` passed. Original agent `agent-68a7d1b6-2ef6-45dd-b7cb-07bf4d8b0f3f` was not reused after an aborted bridge turn. | Focused interrupted-turn persistence proof is green. |
| Copied session file / session switch | Throwaway decision probe `sessionCopySwitch` passed. A copied session file carried 1 resume custom entry, but copied-entry reuse was rejected: original `agent-bae449d8-dd43-4e64-8a1e-b0240bd9df2f`, copied-session turn `agent-c7185f26-67b0-47cf-bb39-710300b46468`, `resumedAgent: false`, token bootstrapped from transcript. Report: `.artifacts/local-resume-decision-probes-2026-07-08T20-01-12-038Z/report.json`. | Session file binding works for copied/import-like session files. |
| Missing SDK agent / resume failure fallback | Throwaway decision probe `resumeFailureFallback` passed core fallback: custom resume entries were rewritten to bogus `agent-missing-1783540906046`; next turn created `agent-9efaf60e-1a82-4214-8205-b310c4978069` instead of baseline `agent-be2c7018-f78c-4ea2-8201-1c66fca52887`, `resumedAgent: false`, and recalled token from pi transcript. The metadata excerpt did not include `resumeNotice`, so display-note evidence remains unit-level unless separately probed via UI/JSONL. | Live SDK-store-missing behavior falls back safely to create+bootstrap. Continuity-note display still needs a focused UI/JSONL check if required for default-on. |
| Realistic tree navigation to prior assistant entry | Throwaway tree proof passed safe for assistant-entry target. After base+future turns on `agent-b4d48425-2b0f-40d8-b179-bb4e0cbe33eb`, navigating to the earlier assistant entry created `agent-eed37488-601d-49cf-bbbe-161e9352c813`, `resumedAgent: false`, and answered `NO_TOKEN` for the future token. Report: `.artifacts/local-resume-tree-proof-2026-07-08T20-14-37-156Z/report.json`. | Ordinary earlier assistant-path navigation can be safe when the resume custom entry is not on the selected path. |
| Internal tree navigation to prior resume custom entry | Throwaway tree proof found an unsafe path. Navigating to the earlier `cursor-sdk-agent-resume` custom entry resumed the same future-seeing agent `agent-b4d48425-2b0f-40d8-b179-bb4e0cbe33eb`, `resumedAgent: true`, `sendPlan.mode: incremental`, and answered `TOKEN=TREE_FUTURE_1783541679210`. Report: `.artifacts/local-resume-tree-proof-2026-07-08T20-14-37-156Z/report.json`. | **Default-on blocker and opt-in known risk.** A branch path that includes an old resume handle can resume an SDK agent that later saw future messages. Fix required before default-on. |
| Compaction boundary | Manual live proof already captured in `docs/evidence/cursor-local-compaction-boundary-2026-07-08.md`: pre-compaction `agent-9f5c78fb-458c-4225-9976-a95b22806221` was not reused; post-compaction `agent-b5e5e885-9c63-4415-9593-575418449607` was recorded with `compactionGeneration: 1` and resumed. | Good manual proof, but still needs automated smoke before default-on. |
| Defaults | Existing tests and config keep local resume opt-in/default-off. No source/default behavior changed during evidence collection. | Safe to keep opt-in. Not enough to flip default. |

## Full platform gate evidence

Command run:

```bash
npm run smoke:platform:all
```

Result: pass.

Artifact index: `.artifacts/platform-smoke/latest.json`

Summary:

```text
startedAt: 2026-07-08T19:48:48.787Z
finishedAt: 2026-07-08T19:58:23.177Z
ok: true
macos:          run-1783540128790-ckon62  platform-build/native/bridge/abort/local-resume-restart all true
ubuntu:         run-1783540128793-3vu2a1  platform-build/native/bridge/abort/local-resume-restart all true
windows-native: run-1783540128794-309dwz  platform-build/native/bridge/abort/local-resume-restart all true
```

This proves the current release gate and the cross-platform same-session restart slice only. It does not prove the focused safety/tool-surface/abort lanes across every platform.

## Focused local-resume smoke evidence

Command log: `.artifacts/local-resume-decision-evidence/focused-local-resume-smokes-2026-07-08.log`

Commands run:

```bash
npm run smoke:local-resume
npm run smoke:local-resume:safety
npm run smoke:local-resume:tool-surface
npm run smoke:local-resume:abort
```

Markers observed:

```text
local-resume-smoke-ok
local-resume-safety-smoke-ok
local-resume-tool-surface-smoke-ok
local-resume-abort-smoke-ok
```

These are strong opt-in local-host proofs. Before default-on, promote the relevant lanes into the platform matrix or run equivalent macOS/Ubuntu/Windows artifacts.

## Extra decision probes

The first combined decision probe at `.artifacts/local-resume-decision-probes-2026-07-08T20-01-12-038Z/report.json` successfully captured copy/switch and resume-failure fallback, but its embedded `runTreeProbe` timed out (`Timeout waiting for agent to become idle`). That tree attempt is superseded by the corrected focused tree proof at `.artifacts/local-resume-tree-proof-2026-07-08T20-14-37-156Z/report.json`, which registered the command correctly and produced the safe assistant-entry result plus unsafe resume-custom-entry leak.

### Copied session / switch

Probe artifact: `.artifacts/local-resume-decision-probes-2026-07-08T20-01-12-038Z/report.json`

Observed:

```text
original agent: agent-bae449d8-dd43-4e64-8a1e-b0240bd9df2f
copied-session agent: agent-c7185f26-67b0-47cf-bb39-710300b46468
copied session contained resume entries: 1
copiedEntryRejected: true
resumedAgent on copied turn: false
tokenBootstrappedFromTranscript: true
```

Decision: copied/import-like session files do not reuse the original SDK agent just because they carry a copied resume custom entry.

### Missing/resume-failure fallback

Probe artifact: `.artifacts/local-resume-decision-probes-2026-07-08T20-01-12-038Z/report.json`

Observed:

```text
baseline agent: agent-be2c7018-f78c-4ea2-8201-1c66fca52887
bogus rewritten agent: agent-missing-1783540906046
fallback agent: agent-9efaf60e-1a82-4214-8205-b310c4978069
fallbackCreatedNewAgent: true
resumedAgent on fallback: false
tokenBootstrappedFromTranscript: true
continuityNoticeRecorded in metadata excerpt: false
```

Decision: live fallback is safe at the SDK-agent level. If the continuity note is part of the default-on acceptance contract, run a specific UI/JSONL assertion for it; current live metadata excerpt did not include it.

### Tree navigation

Probe artifact: `.artifacts/local-resume-tree-proof-2026-07-08T20-14-37-156Z/report.json`

Setup:

- Base turn wrote `TREE_BASE_1783541679210`.
- Future turn wrote `TREE_FUTURE_1783541679210` on SDK agent `agent-b4d48425-2b0f-40d8-b179-bb4e0cbe33eb`.
- Temporary extension command called `ctx.navigateTree(targetId, { summarize: false })`, then `pi.sendUserMessage(...)`.

Observed for earlier assistant entry target:

```text
new agent: agent-eed37488-601d-49cf-bbbe-161e9352c813
resumedAgent: false
answer: NO_TOKEN
assistantTargetReusedFutureSeenAgent: false
assistantTargetLeakedFutureToken: false
```

Observed for earlier resume custom-entry target:

```text
agent: agent-b4d48425-2b0f-40d8-b179-bb4e0cbe33eb
resumedAgent: true
sendPlan.mode: incremental
answer: TOKEN=TREE_FUTURE_1783541679210
resumeTargetReusedFutureSeenAgent: true
resumeTargetLeakedFutureToken: true
```

Decision: local resume is not safe to default-on until old resume handles are invalidated or bounded so a branch cannot resume an SDK agent that later saw descendant/future messages.

## Decision routes

### Route A — keep local resume opt-in/default-off

Recommended now.

Evidence supports this as the least-risk route:

- Default-off config and tests remain intact.
- Current full platform gate is green.
- Same-session restart is platform-proven.
- Focused safety/tool-surface/abort lanes are green locally.
- Copy/switch and missing-agent fallback probes are safe.
- The tree custom-entry hazard is not acceptable for default-on and remains a known opt-in risk until fixed.

Route A avoids exposing all users to the known tree/custom-entry risk while the tree-safety fix is built.

### Route B — fix tree safety, then consider broader opt-in hardening

Recommended next engineering route if the goal is eventual default-on.

Required fix shape:

- A resume handle must not be usable if its SDK agent later continued beyond that handle on another descendant/future path.
- At minimum, after tree navigation to an older path, create+bootstrap unless the handle is known not to have seen messages outside the selected active path.
- Prefer false negatives/new agents over false positives/future-token leakage.

Proof required after fix:

```bash
npm run smoke:local-resume
npm run smoke:local-resume:safety
npm run smoke:local-resume:tool-surface
npm run smoke:local-resume:abort
# new automated tree proof: assistant-target safe and resume-entry-target no leak/no future-seeing reuse
npm run smoke:platform:all
```

Also add/automate:

- compaction boundary smoke;
- session copy/switch smoke;
- missing-agent fallback smoke including continuity note if UX contract requires it.

### Route C — flip local resume default-on

Not recommended from current evidence.

Blockers:

- Tree custom-entry target leaked future token through a resumed future-seeing SDK agent.
- Focused safety/tool-surface/abort lanes are not yet in the cross-platform matrix.
- Compaction proof is manual, not automated.
- Cleanup/GC of superseded local SDK agents is still unresolved.
- Periodic rebootstrap/predecessor cleanup proof is still missing.
- Default-on/opt-out full-gate dry run is still missing.

### Route D — narrow default-on to same-session process restart only

Possible product route, but it is **not the current implementation**. It would need a new narrower mode that cannot restore branch/tree/fork/copy handles. Evidence required would be smaller, but implementation complexity grows. Ponytail view: do not add this unless default-on pressure is high.

### Route E — cloud resume/default-on

Do not choose now.

Cloud resume/default-on is product-deferred and would require separate context-handoff, compaction, cleanup, lifecycle, privacy, and cloud smoke decisions. It is not needed for the local resume route.

## Outstanding proof still required before local default-on

All of these remain real proof/run requirements:

1. Tree safety fix and rerun:
   - earlier assistant path remains safe;
   - earlier resume custom-entry path must not reuse future-seeing agent;
   - future token must not leak.
2. Cross-platform promotion/runs for focused lanes:
   - safety;
   - tool-surface;
   - abort;
   - tree after fix;
   - compaction after automation.
3. Automated compaction boundary smoke:
   - pre-compaction agent not reused;
   - post-compaction generation agent resumes;
   - token recall survives;
   - usage remains bounded after compaction.
4. Session copy/switch/import smoke:
   - copied custom entry rejected;
   - transcript bootstraps successfully.
5. Live resume-failure fallback smoke:
   - missing/deleted SDK state creates new agent;
   - token bootstraps from transcript;
   - continuity note is visible if required by UX contract.
6. Cleanup/GC proof:
   - only recorded superseded local agents are eligible;
   - empty/match-all SDK delete filters are rejected;
   - no global SDK-store sweep.
7. Periodic rebootstrap proof:
   - replacement agent is recorded after threshold;
   - predecessor is cleanup-eligible only when safe.
8. Default-on/opt-out dry run:
   - default-on config path works;
   - env/CLI/user opt-out wins;
   - full platform gate passes with chosen default behavior.
9. Artifact/redaction audit for default-on release artifacts:
   - debug/session artifacts contain no API keys, bearer tokens, cookies, local secrets, or SDK store secret material.

## Product/SDK-blocked items, not runnable as local proof today

- Cloud resume/default-on — product-deferred.
- SDK `local.customTools` as default Pi-tool transport — needs SDK cancellation/deadline support or a full pi-owned adapter.
- Automatic local `force` stale-run recovery — rejected until pi owns run ownership, heartbeat/stale proof, active SDK run-status read, stale threshold, idempotency key, and competing-owner warning.
- Inline cloud MCP — rejected until SDK/API contract or live probes prove first-run availability, replacement, resume/resupply, and no hidden persistence.
- Remote Pi bridge — product/security decision required.
- Cloud env forwarding — product decision required.

## Recommendation

Choose **Route A now**: keep local resume opt-in/default-off.

Next action if default-on remains desired: implement **Route B**, the tree-safety fix, because the current evidence found a concrete future-token leak through an earlier resume custom-entry path. After that fix, rerun the listed proof matrix before reconsidering default-on.
