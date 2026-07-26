# Pi UI Consolidation — Working Brain Dump

Status: design notes, not an approved implementation plan.

This records the evidence, decisions, intended architecture, risks, and unresolved implementation details for consolidating tool rendering and footer UI across the monorepo. It deliberately separates facts from choices.

## The actual problem

This is not four independent features. It is one ownership problem appearing in two places:

1. Multiple extensions want to own the same built-in tool cards.
2. Multiple extensions want to contribute to one footer.

Pi supports one effective tool definition per name and one custom footer factory. It does support many status values through `ctx.ui.setStatus()`. The clean design is therefore:

- one tool-presentation owner that other providers can cooperate with;
- one footer host that composes many independently produced status values.

Everything else should remain standalone and optional.

## Decisions already made

- Tidy-style compact cards become the normal built-in tool presentation.
- pi-ext's Shiki diff renderer survives only for expanded edit/write details.
- Cursor built-in-equivalent replay uses those same compact cards.
- Cursor-only actions use one compact neutral line.
- Footer slots use one prioritized auxiliary line below the core footer line.
- Cache prediction stays visible until the first successful response on the destination lane.
- External projects are vendored into `pi-extensions`.
- Vendoring shape is hybrid:
  - Tidy implementation is folded into `@iurysza/pi-ext`.
  - Cursor SDK becomes a separate `@iurysza` child package.
  - Cache Hit Predictor becomes a separate `@iurysza` child package.

## Facts found in the current code

### Tool Pills

`packages/pi-ext/extensions/tool-pills/index.ts` owns:

- `ls`
- `read`
- `bash`
- `write`
- `edit`

It leaves `grep` and `find` to pi-fff. Normal read/list/bash output is truncated to 15 lines. The unique feature is `diff-renderer.ts`: roughly 1,500 lines of Shiki highlighting, split/unified layout, wrapping, theme-derived backgrounds, preview limits, and custom write/edit execution metadata.

The current renderer is not presentation-only. `registerDiffTools()` also replaces write/edit execution to capture extra details. This coupling must be removed if Tidy owns the tools.

There are currently no dedicated pi-ext tests for Tool Pills or Custom Footer.

### Tidy Tools 0.4.1

Tidy Tools owns all seven built-ins:

- `read`
- `write`
- `edit`
- `bash`
- `grep`
- `find`
- `ls`

It adds:

- required goal/reasoning phrases;
- default, reasoning-only, and result-only layouts;
- width-aware `renderShell: "self"` cards;
- elapsed timing;
- compact per-tool result summaries;
- Ctrl+O expansion;
- `/diff` for last-turn changes;
- optional icons;
- explicit pi-fff composition and recovery;
- a mature test suite.

Its expanded diffs are simpler than pi-ext's Shiki renderer. That is the only compelling reason not to replace Tool Pills wholesale.

Tidy cannot generically decorate a foreign extension's tools. Pi documents built-in slot inheritance, but no API exposes another extension's executable definition for safe composition. Keeping both extensions active is therefore inherently unstable, not merely cosmetically redundant.

### Cursor SDK 0.1.61

Cursor has two different tool paths:

1. The local Pi MCP bridge executes real Pi tools.
2. Native Cursor replay displays recorded Cursor-side work without re-running it.

Replay intentionally registers wrappers only when no other extension owns the tool name. If another extension owns `read`, `bash`, `edit`, etc., Cursor marks the wrapper skipped and falls back to scrubbed transcript traces.

That safety rule is correct. Cursor replay wrappers consume a recorded result from internal state. A normal Tidy or Tool Pills wrapper would execute the real tool again. For reads that is wasteful; for shell/edit/write it is dangerous.

Therefore load-order tricks are unacceptable. Clean shared cards require an explicit replay broker between the Cursor package and the tool-presentation owner.

The current installed Cursor package is 0.1.59 and its package extension is filtered out in the installed settings. No persisted Cursor-backed assistant sessions were found. The ugly current behavior must be reproduced in an isolated harness instead of inferred from local session history.

### Footer and Token Tank

`packages/pi-ext/extensions/custom-footer/custom-footer.ts` already suppresses Pi's built-in footer and renders:

- line 1: permission mode, path/branch, context, response age, model/thinking;
- line 2: every value from `footerData.getExtensionStatuses()`.

Token Tank already calls:

```ts
ctx.ui.setStatus("pi-token-tank", formattedQuota)
```

It does not call `setFooter()`. In other words, Token Tank already behaves like a footer slot producer. The missing capabilities are metadata and layout:

- deterministic priority;
- stable order;
- width-aware packing;
- lifecycle conventions;
- a host-ready handshake.

The content transport should remain Pi's official `setStatus()` map. Replacing it with a custom value transport would break native-footer fallback for no benefit.

The current custom footer manually runs Git and watches `.git/HEAD`. Pi's official `footerData` already supplies `getGitBranch()` and `onBranchChange()`, including repository layouts the manual watcher can miss. The rewrite should use the official provider and `ctx.cwd`, not `process.cwd()`.

### Cache Hit Predictor 0.0.1

The predictor:

- tracks cache lanes by provider, API, model, and thinking level;
- reconstructs history from the active session branch;
- clears incompatible history after compaction/branch summaries;
- coalesces model + thinking changes;
- currently posts a notification after a switch.

The prediction is an estimate, while real `cacheRead` usage remains authoritative. Its calculation is already separated into `src/predictor.ts`; only the UI lifecycle needs changing.

## Proposed monorepo shape

After this project, the relevant packages should be:

```text
packages/
  pi-ext/
    extensions/
      tool-presentation/
        index.ts
        tidy/                 # provenance-preserving Tidy import/adaptation
        rich-diff.ts          # extracted Shiki presentation only
        cursor-replay.ts      # optional replay broker adapter
      custom-footer/
        custom-footer.ts
        footer-slots.ts
        renderers.ts
  pi-token-tank/
  pi-cursor-sdk/              # independently installable @iurysza package
  pi-cache-hit-predictor/     # independently installable @iurysza package
```

There should be no separately published `@iurysza/pi-tidy-tools`. Publishing it would recreate the overlap we are removing. Tidy is an attributed implementation component inside pi-ext.

Cursor and Cache Predictor remain separate because forcing them into every pi-ext install would add a heavy provider SDK and optional behavior to users who did not ask for either.

## Provenance and licensing

Use public history only.

### Tidy

- Source: `mikeyobrien/pi-tidy-tools`, package `packages/pi-tidy-tools`, release 0.4.1.
- Create a history-preserving split for that package.
- Import unsquashed under pi-ext's tool-presentation directory.
- Adapt in a separate commit after the import commit.
- Retain MIT license and author attribution.
- Add the source and adaptation notice to `THIRD_PARTY_NOTICES.md`.

### Cursor

- Source: `fitchmultz/pi-cursor-sdk`, release commit `66b6e9237c381b905e7bc467d9b2f8066d940ce6` (0.1.61).
- Import the standalone repository unsquashed at `packages/pi-cursor-sdk`.
- Rename package metadata to an `@iurysza` package only in a follow-up commit.
- Keep upstream license, docs, changelog, and attribution.

### Cache Predictor

- Source: `IgorWarzocha/howaboua-pi-stuff`, package `packages/pi-cache-hit-predictor`, inspected at `9b9cd4aa4e4266864fb30282129b2f6ed6d7576b`.
- Split that package's history and import it unsquashed at `packages/pi-cache-hit-predictor`.
- Rename package metadata only after import.
- Keep license and attribution.

All imported child locks must be removed. The monorepo keeps one root lockfile.

## Tool presentation design

### One owner

Replace the Pi manifest entry for `extensions/tool-pills/index.ts` with one `tool-presentation` entry. That entry owns all seven built-ins.

Remove:

- the Tool Pills entrypoint;
- pill badges;
- custom basic-tool wrapping;
- write/edit registration from the old diff renderer.

Keep Tidy's:

- schemas and prompt guidance;
- execution composition;
- compact layouts;
- width handling;
- timing;
- configuration and `/tidy` command;
- `/diff` command;
- pi-fff integration.

Existing `pi-tidy-tools.json` configuration should continue to work. This gives current users a migration path without silently discarding mode/icon/pi-fff state.

### Rich diffs become presentation-only

Do not carry forward `registerDiffTools()` as-is. Extract only the parser/highlighter/layout logic behind an API shaped roughly like:

```ts
renderExpandedMutation({
  toolName,
  args,
  result,
  width,
  theme,
  context,
}): Component | undefined
```

Rules:

- It runs only when Ctrl+O expansion is active.
- Collapsed cards remain pure Tidy output.
- It never replaces execution.
- It consumes native/Tidy result details and call args.
- It uses the component's live `width`, not `process.stdout.columns`.
- It preserves existing line/character safety limits.
- It falls back to Tidy's simple expanded output if parsing or highlighting fails.
- It stores only bounded render state; it does not duplicate entire files in session details.

For edit, args already contain old/new text blocks. For write, use the native/Tidy unified diff in `result.details.diff`; new files can use bounded `args.content`. The extracted renderer may need a proper unified-diff parser instead of the current old/new-only `parseDiff()` entrypoint.

A single result component should render the compact card first, then append the rich diff only while expanded. Shiki work should be lazy so normal collapsed transcripts pay no highlighting cost.

### Reasoning schema and replay

Tidy marks `reasoning` required, but Cursor replayed tool calls were produced by Cursor and will not contain it.

Do not fake model reasoning. Keep the public schema and prompt guidance strict for normal models, then use `prepareArguments()` to inject an empty compatibility value when stored/provider-generated calls omit the field. Tidy already falls back when reasoning is absent.

For Cursor replay, force the compact result-style layout rather than repeating the path as both headline and target. Normal calls continue using the configured Tidy mode.

## Cursor replay cooperation

This is the highest-risk part.

### Required invariant

A replayed Cursor tool must never execute its underlying shell/file operation.

The shared card is only presentation. Cursor remains the source of recorded replay data and replay identity.

### Broker contract

Use the shared Pi event bus for discovery, but do not use event return values. `EventBus.emit()` returns void and handlers are async-wrapped. Instead, exchange callback-bearing registration objects.

Conceptual contract:

```ts
interface CursorReplayBroker {
  isReplayCall(toolCallId: string): boolean;
  consume(toolCallId: string): RecordedReplay | undefined;
}

interface ExternalReplayOwner {
  protocolVersion: 1;
  toolNames: readonly ["read", "bash", "grep", "find", "ls", "edit", "write"];
  attachBroker(broker: CursorReplayBroker): void;
  detachBroker(): void;
}
```

Discovery must be load-order safe:

- both extensions install listeners during factory load;
- pi-ext announces the owner immediately and again on `session_start`;
- Cursor emits a request/ready event immediately and on `session_start`;
- registration is versioned and idempotent;
- shutdown/reload detaches stale callbacks.

When Cursor sees a non-built-in owner that has registered this protocol:

- do not register a competing wrapper;
- do not mark that tool skipped;
- mark it externally replay-capable;
- route recorded replay through the existing tool name;
- leave current fallback traces unchanged when no compatible owner exists.

The pi-ext tool wrapper executes like this:

1. If the call is not a Cursor replay call, delegate to the real source tool.
2. If it is replay, consume the recorded result from the broker.
3. If no recorded result exists, throw before any real execution.
4. If the recorded result is an error, surface it as an error without executing.
5. Otherwise return the recorded content/details/termination value.
6. Consumption is one-shot.

The fail-closed rule applies to every replay tool, not only edit/write. That makes accidental execution impossible even if Cursor changes its replay set.

### Cursor-only activity

Cursor's neutral `cursor` replay tool remains Cursor-owned. Refine its renderer so collapsed output is one bounded line for:

- MCP;
- plans/todos;
- tasks/subagents;
- semantic search;
- web search/fetch;
- image/screen activity;
- unknown future tool names.

Keep:

- an explicit `Cursor …` label;
- pending state for genuinely long work;
- failure visibility;
- Ctrl+O details;
- scrubbing and size limits.

Do not hide all activity: the chosen direction is shared compact visibility, not silent execution.

### Cursor tests that matter

- Pi-ext loads before Cursor.
- Cursor loads before pi-ext.
- Cursor model selected at startup.
- Switch from non-Cursor to Cursor and back.
- Normal read/bash/edit/write still execute once.
- Replayed read/bash/edit/write execute zero times and consume one recorded result.
- Missing replay state fails closed.
- Replay errors remain errors.
- Cursor without pi-ext retains current native/fallback behavior.
- Protocol version mismatch falls back safely.
- JSONL keeps valid toolCall/toolResult pairs.
- No duplicate replay card plus transcript trace.

Use Cursor's existing visual matrix for read, grep, find, ls, shell, write, edit, and read failure. Keep PNG and JSONL evidence from a disposable install.

## Footer slot design

### Keep `setStatus()` as content transport

A producer continues to call:

```ts
ctx.ui.setStatus(slotId, renderedText)
```

This gives three properties for free:

- Pi requests a render after updates.
- The native footer works when pi-ext is absent.
- Existing status producers remain visible without migration.

The slot protocol adds metadata only.

### Minimal v1 metadata

Avoid a framework. V1 needs only:

```ts
interface FooterSlotRegistration {
  protocolVersion: 1;
  id: string;
  priority: number;
}
```

No custom component callbacks, arbitrary rows, alignment zones, TTL, or min/max widths in v1. Producers own their text and clearing lifecycle.

Use versioned channels for:

- host ready;
- register/upsert metadata;
- unregister metadata.

Like the Cursor protocol, listeners are installed during factory load and registrations are repeated on `session_start`/host-ready so package order does not matter.

### Rendering algorithm

Line 1 remains core state.

Line 2:

1. Read `footerData.getExtensionStatuses()`.
2. Sanitize CR/LF/tab to spaces and trim.
3. Match registered slot metadata by status key.
4. Treat unregistered statuses as legacy slots with priority 0.
5. Sort by priority descending, then key ascending for stability.
6. Join with one consistent dim separator.
7. Pack whole slots by priority.
8. Omit lower-priority slots before truncating higher-priority content.
9. If the highest-priority slot alone exceeds width, truncate that slot safely.
10. Never exceed the width supplied to `render()`.

Initial priorities can be:

- cache prediction: 200, because it is transient and actionable after a switch;
- Token Tank: 100, because it is persistent quota state;
- legacy/unregistered statuses: 0.

Do not assign priorities to every existing pi-ext status in the first implementation. They remain legacy and give us real compatibility coverage.

### Footer lifecycle cleanup

- Use `footerData.getGitBranch()` and `onBranchChange()`.
- Remove the manual Git subprocess/watcher.
- Use `ctx.cwd` for path display.
- Dispose the branch subscription from the footer component.
- Clear slot metadata and timers on shutdown.
- Restore the default footer on shutdown/reload if Pi's lifecycle requires explicit cleanup.
- Ensure repeated `session_start` cannot create duplicate timers or watchers.

## Token Tank integration

Token Tank already has the correct fallback architecture.

Changes should be small:

- register `pi-token-tank` slot metadata at priority 100;
- re-register when the host announces readiness;
- keep `ctx.ui.setStatus()` for updates and standalone behavior;
- clear status and unregister metadata on shutdown;
- rename internal `updateFooter()` terminology to `updateStatusSlot()` or equivalent so ownership is honest;
- keep minimal/full preference and the detail widget unchanged.

Token Tank must not import pi-ext or require it as a peer. The event protocol is optional and structural.

Tests:

- no host: status still appears through ordinary `setStatus()`;
- host before producer and producer before host both register;
- repeated ready events are idempotent;
- shutdown clears status and metadata;
- existing quota refresh, provider selection, and widget behavior remain unchanged.

## Cache Hit Predictor integration

Import it as a standalone child package, then change notification presentation to status-slot presentation.

### Lifecycle

On model/thinking switch:

1. Coalesce paired model/thinking events as today.
2. Calculate the destination lane prediction.
3. Set a concise status value.
4. Register slot priority 200.
5. Remember the pending destination lane key.

On assistant `message_end`:

1. Record successful real usage in history.
2. Derive the actual response lane from message provider/API/model and current thinking level.
3. If it matches the pending destination lane and stop reason is successful, clear the status and pending key.
4. Do not clear on aborted/error responses.

Clear pending UI on:

- another switch, by replacing it;
- session tree navigation;
- compaction;
- restore without a meaningful previous model;
- session shutdown.

The slot string should be materially shorter than the current notification, for example:

```text
cache gpt-5.6-sol · high ~27k/104k 26%
```

Cold lanes should remain explicit. Do not imply the prediction is provider-confirmed.

Standalone behavior uses Pi's native status line. Do not retain a duplicate notification once the status is set.

Tests:

- model + thinking clamp coalesces to one slot update;
- cold and warm text;
- successful matching response clears;
- error/abort does not clear;
- unrelated lane response does not clear;
- compaction/tree clears both history as appropriate and visible prediction;
- host/no-host behavior;
- no output in print/JSON modes beyond existing no-op UI semantics.

## Implementation order

### Milestone 0 — baselines and imports

- Create an implementation branch/worktree.
- Capture current package checks and disposable runtime behavior.
- Reproduce current Cursor conflict output in the isolated Cursor visual harness.
- Import Tidy package history into pi-ext.
- Import Cursor standalone history as a child package.
- Import Cache Predictor filtered history as a child package.
- Add licenses/notices before adaptation.
- Remove child lockfiles; refresh root workspace metadata.

Gate: imports are provenance-only commits plus separate migration commits; repository checks still explain any temporarily incomplete catalog state.

### Milestone 1 — one tool owner

- Replace Tool Pills resource with Tool Presentation.
- Adapt vendored Tidy to pi-ext package paths and dependencies.
- Extract rich diff presentation.
- Delete old Tool Pills registration code.
- Add rendering, width, schema, execution, and expansion tests.
- Add a startup warning or diagnostic for a separately installed `@mobrienv/pi-tidy-tools`, because users must remove it after migration.

Gate: pi-ext alone exposes exactly one owner for all seven built-ins; collapsed cards are Tidy-style; Ctrl+O edit/write shows rich Shiki details; all normal tools execute once.

### Milestone 2 — footer host and Token Tank

- Implement footer slot metadata registry and packing.
- Replace manual Git watching with `footerData`.
- Add Custom Footer tests.
- Register Token Tank metadata without changing its quota engine/widget.

Gate: arbitrary legacy `setStatus()` entries still appear; Token Tank wins its configured priority; widths never overflow; native fallback works without pi-ext.

### Milestone 3 — Cache Predictor package

- Adapt imported package name/metadata.
- Convert notification lifecycle to status slot.
- Add clear-after-destination-response behavior.
- Add package to root catalog, lock, docs, and pack checks.

Gate: package works alone and with pi-ext; prediction never remains after a successful matching response.

### Milestone 4 — Cursor package and replay broker

- Adapt imported package name/metadata.
- Add versioned external replay-owner protocol.
- Add pi-ext broker adapter and fail-closed execution interception.
- Compact neutral Cursor-only cards.
- Run unit, routing, JSONL, and visual replay matrices.

Gate: shared cards render without duplicate traces; replayed mutations execute zero times; Cursor standalone behavior remains safe.

### Milestone 5 — integration, migration, and release

- Run clean root `npm ci`.
- Run full catalog/typecheck/test/pack checks.
- Install all affected tarballs into disposable Pi agent directories in multiple package combinations.
- Test pi-ext alone, pi-ext + Token Tank, pi-ext + Cache Predictor, pi-ext + Cursor, and all together.
- Test package load order variants where possible.
- Update root/package READMEs and migration notes.
- Publish only after tarball and privacy scans pass.

Likely versions:

- `@iurysza/pi-ext`: 0.2.0, because tool presentation changes materially.
- `@iurysza/pi-token-tank`: 0.6.3, additive slot metadata.
- `@iurysza/pi-cursor-sdk`: 0.1.0 under the new namespace.
- `@iurysza/pi-cache-hit-predictor`: 0.1.0 under the new namespace.

Do not change the real installed Pi setup during implementation. After published-package parity is proven, propose a separate explicit migration:

- update `@iurysza/pi-ext`;
- remove separately installed `@mobrienv/pi-tidy-tools`;
- replace `pi-cursor-sdk` with `@iurysza/pi-cursor-sdk` if desired;
- install `@iurysza/pi-cache-hit-predictor` if desired;
- update Token Tank;
- reload and visually verify.

## Validation contract

Implementation is not done because unit tests pass. Done requires:

- one built-in tool owner in runtime metadata;
- no duplicated tool cards;
- no tool/schema warning caused by the consolidation;
- no replayed shell/file operation re-execution;
- compact cards within 40-, 80-, and 120-column widths;
- rich diff only on expansion;
- footer line count stable at one core + at most one slot line;
- priority packing proven at narrow widths;
- Token Tank standalone fallback;
- Cache Predictor standalone fallback and correct clearing;
- Cursor standalone fallback when pi-ext is absent;
- PNG + JSONL evidence for Cursor replay categories;
- clean `npm ci`, full monorepo check, native dependency smoke, and tarball allowlists;
- disposable installation from packed/published artifacts;
- clean Git worktree and untouched installed/source repositories.

## Risks and blind spots

### Replay protocol is private coupling

We control both packages, but the protocol can still drift. Version it from day one, test mismatch fallback, and keep it small. Do not create a general plugin framework.

### Required reasoning and provider-generated replay

Stored/provider-generated calls can omit Tidy's new field. `prepareArguments()` is the correct Pi seam. Tests must cover validation before execution.

### Tidy's pi-fff orchestration is large

Folding Tidy means inheriting its settings transitions and recovery behavior, not just its pretty cards. Preserve upstream tests and avoid rewriting that subsystem during UI consolidation.

### Rich diff maintenance remains expensive

The user explicitly chose to keep it. Contain the cost by making it a lazy presentation module with no tool registration or execution responsibility. If extraction proves inseparable from the old wrappers, stop and revisit rather than preserving unsafe coupling.

### Footer status strings contain pre-rendered ANSI

This matches Pi's official API. The host can width-measure and truncate them, but it cannot reinterpret their semantics. V1 should accept that limitation instead of inventing a typed rendering DSL.

### Full Token Tank mode can crowd other slots

Priority packing may omit lower slots. That is acceptable and predictable. A future compact/full slot variant can be considered only after real evidence shows it is needed.

### Installed Cursor baseline is currently disabled

The user's reported ugly output may come from an earlier enabled configuration/version. Capture before/after evidence in an isolated setup and avoid editing live settings merely to reproduce it.

### Publishing renamed forks

Docs must clearly state provenance and that these are integrated distributions, not upstream ownership claims. Keep upstream links prominent.

## Non-goals

- A general-purpose footer component framework.
- Arbitrary third-party tool renderer interception.
- Rewriting Tidy's pi-fff lifecycle.
- Changing quota provider logic.
- Changing cache prediction math.
- Changing Cursor's provider, bridge, auth, or agent lifecycle beyond replay presentation cooperation.
- Hiding all Cursor activity.
- Modifying the user's installed Pi setup during development.
- Removing old public source repositories before migration parity is proven.

## Remaining implementation-time questions

These do not need product decisions now; choose conservative defaults and stop only if evidence contradicts them:

- Exact event channel names and payload field names.
- Whether Cursor replay ownership registration belongs in one module or beside native replay registration.
- Whether the rich diff component parses unified diffs directly or derives edits from args when available.
- Exact concise cache slot copy.
- Exact numeric priorities beyond Cache Predictor > Token Tank > legacy.
- Whether pi-ext should warn or hard-fail when a separate Tidy install still owns tools. Default: warn, never silently mutate settings.
