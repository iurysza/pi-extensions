# Cursor local compaction boundary evidence — 2026-07-08

> **Historical snapshot — superseded 2026-07-09.** This document records one pre-decision proof. Local resume is now default-on with opt-out and the listed platform/cleanup proofs are complete. See [cleanup proof and current decision](cursor-local-resume-cleanup-proof-2026-07-09.md) and the [current UX spec](../cursor-model-ux-spec.md).

Purpose: record one live local Cursor SDK resume probe across a pi compaction boundary before any default-on resume decision.

Scope:

- Runtime: local Cursor agent.
- Model: `cursor/composer-2-5:slow`.
- User behavior/defaults changed: none.

Captured evidence:

- Sanitized report excerpt: `docs/evidence/cursor-local-compaction-boundary-2026-07-08.report.json`
- The report excerpt omits large filler prompt/session bodies and keeps the relevant metadata, compaction result, run IDs, and SHA-256 hashes for local raw artifacts.

| Fact | Evidence |
| --- | --- |
| Pre-compact session was large enough | `tokensBefore: 113244` |
| Manual pi compaction succeeded | `compactResponse.success: true` |
| Compaction reduced estimated context | `estimatedTokensAfter: 40260` |
| Compaction entry was written | `5c65d5c6` |
| Dropped-prefix continuity survived | Post-compact reply was `TOKEN=COMPACT_BOUNDARY_1783484227852` |
| Pre-compaction SDK agent was not reused after compaction | Pre-compaction agent: `agent-9f5c78fb-458c-4225-9976-a95b22806221`; first post-compact agent: `agent-b5e5e885-9c63-4415-9593-575418449607` with `resumedAgent: false` |
| Post-compaction SDK agent was reusable | Next restart used `agent-b5e5e885-9c63-4415-9593-575418449607` with `resumedAgent: true` and `sendPlan.mode: incremental` |
| Resume identity moved to post-compaction generation | Final resume handles for the post-compact agent used `compactionGeneration: 1`; older pre-compact handles used generation `0` |

Key run IDs:

- Pre-compact long turn 1: `run-14fcc15a-a52d-4bd5-a664-0458da95de93` (`resumedAgent: false`)
- Pre-compact long turn 2: `run-f71ed2e8-e88c-41a8-916a-c7dcba391e2e` (`resumedAgent: true`)
- Pre-compact long turn 3: `run-415a29c8-2d08-402a-94ea-792df9fec6ec` (`resumedAgent: true`)
- First post-compact restart: `run-67aaa061-2b1e-4236-88ec-05a309da7939` (`resumedAgent: false`)
- Second post-compact restart: `run-b15c8fe3-f7ea-4e17-966e-b1919c978783` (`resumedAgent: true`)

Local artifacts retained outside git:

- `.artifacts/compaction-boundary-three-turn-2026-07-08T04-17-07-848Z/report.json`
- `.artifacts/compaction-boundary-three-turn-2026-07-08T04-17-07-848Z/session.before-compact.jsonl`
- `.artifacts/compaction-boundary-three-turn-2026-07-08T04-17-07-848Z/session.after-compact.jsonl`
- `.artifacts/compaction-boundary-three-turn-2026-07-08T04-17-07-848Z/session.after-post-compact-prompt.jsonl`
- `.artifacts/compaction-boundary-three-turn-2026-07-08T04-17-07-848Z/session.after-post-compact-resume.jsonl`

Decision impact at capture time:

- This recorded one live manual compaction boundary for local resume.
- It did **not** by itself move local resume to the roadmap's broad **Validated** contract bucket or flip the default.
- It did **not** change cloud resume or cloud runtime policy.
- The then-missing automated platform and cleanup evidence was completed before the 2026-07-09 default-on decision linked above.
