# Team UI and optional Leader menu handoff

Status: Deferred. Design approved. No implementation started.

The self-contained implementation handoff lives in `iurysza/agents`:

```text
ai-artifacts/goals/team-ui-optional-leader/plan.md
```

Typical local path:

```text
~/dev/personal/tools/agents/ai-artifacts/goals/team-ui-optional-leader/plan.md
```

Give that file to the implementing agent. It contains both repository boundaries, menu drafts, the proposed v1 event contract, service safety rules, and the sequential test plan. `goal.md` beside it records the execution gate.

The owner requested future implementation after prerequisite work is committed and pushed. Both checkouts were dirty when this handoff was written. Confirm published revisions before starting. No commit, push, installation, or live restart is authorized by these files.

Leader scope is limited to generic contribution discovery/validation and registered-command dispatch in `packages/pi-ext/extensions/leader-key/`, plus focused tests and docs. Team owns all feature-specific behavior. Neither implementation imports the other, and there is no new shared package.

A worker in this repository must not mutate the external agents repository. Keep one writer per repository, work sequentially, and preserve unrelated dirty changes. Read the full canonical handoff before implementation; this pointer is not a second design contract.
