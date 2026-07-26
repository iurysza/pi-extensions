# Cursor Cloud activity callback evidence — 2026-07-19

## Capture

- Installed package: `@cursor/sdk@1.0.23`.
- Cloud agent: `bc-f69b9be6-4e88-4275-b496-0c6501c54abb`.
- Cloud run: `run-6535056e-39ef-443e-913a-336033855d30` (`finished`).
- Captured callbacks: 117 `onDelta` and 7 `onStep` callbacks.
- Captured activity sequence: read, shell, task. Delta types included `tool-call-started`, `tool-call-completed`, and `text-delta`; `onStep` included `toolCall` envelopes.

`test/fixtures/cursor-cloud-activity-callbacks-2026-07-19.json` is a normalized, secret-free excerpt, not raw debug output. It retains only callback kinds observed in the capture and preserves the callback envelopes and `toolCall.type` shapes while replacing call IDs, paths, file contents, shell output, and task results with bounded synthetic equivalents.

## Contract test and source anchors

`test/cursor-provider-cloud-activity.test.ts` feeds both callback channels through `streamCursor()`'s actual cloud prepare/send path. It enables ambient local native-display and bridge settings, then proves:

- fixture provenance: installed `@cursor/sdk` version match, exact source `bc-*` / `run-*` IDs, source callback counts strictly greater than the retained excerpt, terminal `finished`, and cleanup `archived` / `deleted` / `getNotFound` / `listExcluded` all true;
- cloud `Agent.create()` and `send()` omit local, MCP, custom-tool, and setting-source assumptions;
- `prepareCursorCloudProviderTurn()` in `src/cursor-provider-turn-prepare.ts` creates the cloud `CursorSdkTurnCoordinator` with native replay disabled;
- `sendCursorProviderTurn()` in `src/cursor-provider-turn-send.ts` forwards SDK `onDelta` and `onStep` callbacks to that coordinator;
- `CursorSdkTurnCoordinator.handleDelta()` / `.handleStep()` in `src/cursor-provider-turn-coordinator.ts` produce bounded read, shell, and task traces plus the correct final text;
- print/stream bounds stay tight and no Pi tool-call events, native replay cards, or live-run `toolUse` completion leaks into cloud output;
- installed Pi `AssistantMessageComponent` renders the actual `done.message` at fixed width 80 with `visibleWidth` line bounds, a bounded line count, representative read/shell/task/final text, and no bridge/native-replay leakage. This is a contract assertion against the pinned Pi dev dependency renderer, not PNG/screenshot evidence.

## Cleanup proof

The captured agent was archived and `Agent.get(...)` returned `archived: true`. It was then deleted; follow-up `Agent.get(...)` returned `agent_not_found`/404, and `Agent.list({ runtime: "cloud", includeArchived: true })` excluded the exact ID.

No raw `.debug` path, prompt, tool result, auth material, or API key is retained as evidence.
