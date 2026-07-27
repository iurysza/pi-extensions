# Cursor Shell Progress Deduplication

## Summary

When Cursor SDK executes a shell command that will later be replayed as a Pi `bash` call, the transcript currently shows both:

```text
Cursor shell: <command>
```

and a completed Tidy `bash` card. Shell output deltas may add up to three more `Cursor shell stdout/stderr` lines.

Suppress those transient Cursor shell lines only when the existing replay router says the completed call will be queued as a native/Tidy card. Continue buffering shell output deltas so they can populate the final card when Cursor's completed result omits output.

This is a Cursor SDK presentation change only. It does not change execution, replay protocol, Tidy, persisted configuration, or normal Pi tools.

## Current State

### Normal Pi execution

```text
model emits Pi tool call
  -> Pi creates pending tool row
  -> Tidy renderCall(... isPartial=true)
  -> Pi executes tool
  -> Tidy renderResult(... isPartial=false)
  -> the same row settles
```

The user sees one live card that becomes one completed card.

### Cursor SDK execution

```text
Cursor tool-call-started
  -> CursorToolLifecycleEmitter waits 75 ms
  -> emits "Cursor shell: <command>" as thinking text

Cursor shell-output-delta
  -> CursorShellOutputTracker buffers output
  -> emits up to three stdout/stderr preview lines as thinking text

Cursor tool-call-completed
  -> CursorTurnDisplayRouter resolves replay disposition
  -> queue_replay records a display-only Pi bash call
  -> pi-ext consumes the recorded result
  -> Tidy renders the completed bash card
```

Cursor executes the command once. The duplication is two presentation paths for that one execution.

Relevant code:

- `packages/pi-cursor-sdk/src/cursor-provider-turn-coordinator.ts`
- `packages/pi-cursor-sdk/src/cursor-provider-turn-lifecycle-emitter.ts`
- `packages/pi-cursor-sdk/src/cursor-provider-turn-shell-output.ts`
- `packages/pi-cursor-sdk/src/cursor-native-replay-routing.ts`
- `packages/pi-cursor-sdk/src/cursor-provider-turn-display-router.ts`
- `packages/pi-ext/extensions/tool-presentation/index.ts`

## Goals

- Show one completed `bash` card for a Cursor shell call when native/Tidy replay is available.
- Remove the preceding `Cursor shell: <command>` line in that path.
- Remove `Cursor shell stdout/stderr: ...` transcript previews in that path.
- Preserve output-delta buffering and merge it into the final replay result.
- Preserve lifecycle and output progress text whenever replay cannot produce a card.
- Preserve visible failure or abort output for calls that never complete.
- Keep normal non-Cursor Pi tool UX unchanged.

## Non-Goals

- Live or pending Tidy cards for Cursor-owned execution.
- Changes to Cursor command execution or cancellation.
- Changes to the pi-ext/Cursor replay protocol.
- Changes to Tidy rendering or configuration.
- Generic suppression of Cursor-only MCP, task, plan, web, image, or semantic-search activity.
- Removal of shell output from the completed card.
- Parsing or filtering Cursor text inside pi-ext.

## Invariants and Constraints

1. A Cursor replay must never execute the underlying Pi `bash` tool.
2. Suppression is allowed only when `resolveNativeReplayDisposition()` returns `queue_replay` for Pi tool name `bash`.
3. `inactive_trace` and `transcript_trace` keep current progress behavior.
4. Output deltas remain buffered even when their preview text is suppressed.
5. Missing completion, SDK failure, run drain, and abort remain visible through existing incomplete-tool handling.
6. The active-tool decision uses the provider context snapshot, matching completed replay routing.
7. Cursor SDK remains usable without pi-ext. If its own native replay wrapper can produce the card, the same deduplication applies.
8. No settings, files, or durable state are added.
9. Pi-ext remains the sole built-in presentation owner when installed; Cursor SDK owns the decision not to emit redundant provider traces.

## Alternatives

### A. Gate progress at the Cursor replay-routing seam — recommended

Use the same routing facts for start-time progress and completion-time replay. If `bash` will route to `queue_replay`, cancel shell lifecycle text and mark shell output previews as hidden while still buffering their bytes.

**Benefits:** correct ownership, no text parsing, standalone-safe, fallback-safe, no protocol change.

**Cost:** a small state addition to the shell output tracker and coordinator tests.

### B. Suppress every Cursor shell progress line

Never emit lifecycle or output previews for shell calls.

**Rejected:** simple but creates silent long-running work when native replay is disabled, unavailable, inactive in the context snapshot, or replaced by an incompatible tool owner.

### C. Filter Cursor text inside pi-ext/Tidy

Have pi-ext recognize and discard `Cursor shell:` thinking text.

**Rejected:** wrong ownership and brittle string coupling. Pi-ext would need provider-specific parsing and could not know reliably whether a final replay card will arrive.

### D. Emit a pending replay card

Create a synthetic Pi call at Cursor start and settle it at Cursor completion.

**Rejected for this change:** closest parity with normal Pi, but requires pending-result state, replay protocol changes, turn coordination, and new abort/concurrency semantics. The UX defect does not justify that architecture.

## Recommendation

Implement Alternative A entirely in `@iurysza/pi-cursor-sdk`.

The replay router already decides whether a completed Cursor tool becomes a Pi card. Reuse that decision before emitting shell progress. Do not add a second policy or inspect whether Tidy specifically is installed.

## Domain Model and Types

Add an internal shell progress mode:

```ts
export type CursorShellProgressMode = "transcript" | "card-only";
```

Add a pure resolver beside native replay routing:

```ts
export type CursorShellProgressRoutingInput = Omit<
  NativeReplayRoutingInput,
  "toolName"
>;

export function resolveCursorShellProgressMode(
  input: CursorShellProgressRoutingInput,
): CursorShellProgressMode {
  return resolveNativeReplayDisposition({ ...input, toolName: "bash" }) === "queue_replay"
    ? "card-only"
    : "transcript";
}
```

`card-only` means:

- cancel any delayed shell lifecycle line;
- do not emit stdout/stderr preview text;
- keep buffering output;
- let completion or incomplete-call handling provide the visible terminal state.

Extend shell tracking without importing replay-routing concerns into the tracker:

```ts
export interface CursorShellStartOptions {
  progressMode?: CursorShellProgressMode; // default: "transcript"
}

class CursorShellOutputTracker {
  onShellToolStarted(callId: string, options?: CursorShellStartOptions): void;
  appendShellOutputDelta(delta: CursorShellOutputDelta):
    | CursorShellOutputProgressDelta
    | undefined;
}
```

The tracker stores progress mode by call ID. `appendShellOutputDelta()` always buffers attributable data first. It returns a user-visible progress delta only in `transcript` mode and within the existing three-preview limit.

## Interfaces and APIs

No public package or cross-package API changes.

Changed internal contracts:

1. `resolveCursorShellProgressMode()` becomes the single start-time policy for shell transcript progress.
2. `CursorShellOutputTracker.onShellToolStarted()` accepts optional display policy while preserving the current default.
3. `CursorSdkTurnCoordinator` computes the policy from its existing fields:

```ts
const progressMode = resolveCursorShellProgressMode({
  useNativeToolReplay: this.useNativeToolReplay,
  activeToolNames: this.activeToolNames,
  hasLiveRun: this.liveRun !== undefined,
});
```

The resolver itself relies on `canRenderCursorToolNatively("bash")`, exactly as completion routing does.

## Boundaries and Adapters

### Cursor SDK event boundary

`tool-call-started` and `shell-output-delta` remain external SDK inputs. No Cursor SDK payload is changed.

### Replay-routing boundary

`cursor-native-replay-routing.ts` owns the decision because it already combines:

- runtime replay enablement;
- registered/shared native renderer availability;
- active context tool names;
- live-run availability.

### Shell output boundary

`CursorShellOutputTracker` continues to own attribution, overlap ambiguity, buffering, and visible preview limits. It gains only per-call visibility state.

### Pi/Tidy boundary

Unchanged. Completion still queues the existing recorded replay result. pi-ext still consumes it once and Tidy renders it. No Tidy-specific import or event is introduced.

## Call Stacks and Data Flow

### Proposed replay-card path

```text
Cursor partial-tool-call
  -> lifecycle may be tentatively scheduled
  -> timer cannot emit before the call is registered as started

Cursor tool-call-started(shell, callId)
  -> resolveCursorShellProgressMode(..., Pi name "bash")
  -> resolveNativeReplayDisposition() == queue_replay
  -> lifecycleEmitter.cancel(callId)
  -> shellOutput.onShellToolStarted(callId, { progressMode: "card-only" })
  -> optional debug decision: tool_lifecycle_skip/native-replay-card

Cursor shell-output-delta
  -> attribute and buffer bytes
  -> card-only returns no progress preview
  -> no thinking text is emitted

Cursor tool-call-completed
  -> merge buffered bytes if completed stdout/stderr are empty
  -> existing duplicate ledger
  -> existing routeCompletedToolCall()
  -> queue_replay
  -> recorded replay consumed once
  -> one completed Tidy/native bash card
```

### Proposed fallback path

```text
Cursor tool-call-started(shell, callId)
  -> resolveCursorShellProgressMode(...)
  -> disposition is inactive_trace or transcript_trace
  -> lifecycle remains scheduled
  -> tracker starts in transcript mode

75 ms / shell output deltas
  -> current Cursor shell lifecycle/output text remains

completion
  -> current transcript/inactive trace remains
```

### Incomplete or aborted replay path

```text
card-only shell starts
  -> no transient progress text
  -> completion never arrives
  -> discardIncompleteStartedToolCalls()
  -> existing incomplete display/trace reports missing completion, SDK failure,
     run drain, or abort
```

No failure path may end without either a completed card or existing incomplete-tool output.

## Files to Add, Change, or Delete

### Add

None.

### Change

- `packages/pi-cursor-sdk/src/cursor-native-replay-routing.ts`
  - Add `CursorShellProgressMode` and `resolveCursorShellProgressMode()`.

- `packages/pi-cursor-sdk/src/cursor-provider-turn-coordinator.ts`
  - Resolve shell progress mode on `tool-call-started`.
  - Cancel a lifecycle timer for `card-only` calls, including timers created by `partial-tool-call`.
  - Pass progress mode into the shell output tracker.
  - Optionally record a bounded debug skip reason.

- `packages/pi-cursor-sdk/src/cursor-provider-turn-shell-output.ts`
  - Store and clear per-call progress mode.
  - Suppress preview return values in `card-only` mode while preserving buffers.

- `packages/pi-cursor-sdk/test/cursor-native-replay-routing.test.ts`
  - Cover all progress-mode routing outcomes.

- `packages/pi-cursor-sdk/test/cursor-provider-turn-shell-output.test.ts`
  - Prove hidden previews still populate buffered output.

- `packages/pi-cursor-sdk/test/cursor-provider-replay-shell.test.ts`
  - Update replay-path expectations from progress text plus card to card only.
  - Preserve fallback trace expectations.

- `packages/pi-cursor-sdk/test/cursor-provider-replay-live-run.test.ts`
  - Add a shell call lasting beyond 75 ms and prove lifecycle text is absent when replay is queued.

- `packages/pi-cursor-sdk/test/cursor-provider-incomplete-tools-live-run.test.ts`
  - Prove a suppressed-progress shell remains visible on failure/abort.

### Delete

None.

### Explicitly unchanged

- `packages/pi-ext/extensions/tool-presentation/**`
- Cursor replay broker/protocol files
- package manifests and settings

## Red-Green Test Plan

### Slice 1 — Routing contract

1. Add failing tests for `resolveCursorShellProgressMode()`.
2. Expect `card-only` only when replay is enabled, `bash` is renderable and active, and a live run exists.
3. Expect `transcript` for disabled replay, inactive `bash`, no live run, or unavailable native renderer.
4. Implement the pure resolver through `resolveNativeReplayDisposition()`.

### Slice 2 — Hidden preview still buffers

1. Add a failing tracker test starting a call in `card-only` mode.
2. Assert stdout/stderr appends return `undefined`.
3. Assert `takeDeltasForCall()` returns all bytes unchanged.
4. Assert default/transcript mode still returns at most three previews.
5. Implement per-call mode storage and cleanup.

### Slice 3 — One-card replay path

1. Add a failing provider test with a shell call that remains started for more than 75 ms and emits output deltas before completion.
2. Assert thinking text contains neither `Cursor shell:` nor `Cursor shell stdout/stderr:`.
3. Assert the resulting Pi call is `bash` with the original command.
4. Execute the replay wrapper and assert the output delta appears in the final result when completed output is empty.
5. Implement coordinator gating and lifecycle cancellation.

### Slice 4 — Fallback remains informative

1. Add a failing test where native replay is disabled or `bash` is absent from `activeToolNames`.
2. Assert the delayed command lifecycle and bounded output preview still appear.
3. Assert completed fallback trace behavior is unchanged.
4. Adjust only if the new gating accidentally suppresses fallback output.

### Slice 5 — Failure and abort remain visible

1. Start a `card-only` shell call and omit completion.
2. Exercise SDK failure and abort outcomes.
3. Assert existing incomplete-tool card/trace is emitted.
4. Assert no stale tracker mode, buffer, lifecycle timer, or native result remains.

### Slice 6 — Visual and package verification

Run:

```bash
npm run typecheck --workspace @iurysza/pi-cursor-sdk
npm test --workspace @iurysza/pi-cursor-sdk
npm run check
```

Then use a disposable Pi setup containing both `@iurysza/pi-ext` and `@iurysza/pi-cursor-sdk`:

- run one shell command long enough to cross the 75 ms lifecycle threshold;
- capture PNG and JSONL through the existing visual audit workflow;
- verify exactly one completed Tidy `bash` card;
- verify no `Cursor shell:` or `Cursor shell stdout/stderr:` transcript line;
- verify JSONL contains one `bash` tool call/result pair;
- verify the command executed once;
- repeat with native replay disabled and verify fallback progress remains visible.

## Risks and Open Questions

### Risks

- **Start/completion routing drift:** mitigated by delegating both decisions to `resolveNativeReplayDisposition()` rather than duplicating conditions.
- **Tentative partial-call timer leaks:** `tool-call-started` must cancel an existing lifecycle timer before it can emit.
- **Lost result text:** output preview suppression must occur after buffering, not instead of buffering.
- **Silent incomplete calls:** existing incomplete-tool behavior must be integration-tested for failure and abort.
- **Parallel shell calls:** preserve current ambiguity rule; do not attempt new attribution logic in this change.
- **Runtime registration changes mid-call:** completion may theoretically choose a different disposition after reload. Existing completed or incomplete fallback output remains authoritative; no new recovery mechanism is warranted.

### Open Questions

None. The chosen scope suppresses both command lifecycle and stdout/stderr previews only for calls already eligible for a replay card.
