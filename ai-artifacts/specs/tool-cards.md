# Tool cards implementation

Tidy owns tool presentation through Pi 1.0.4's `registerToolRenderer`. Other packages register their tools without card imports or a pi-ext dependency.

## Rendering

`packages/pi-ext/extensions/tool-presentation/tidy/cards/` contains the specs, card builder, width handling, and shared runtime. `tidy/index.ts` retains its `buildToolBlock`, `fitToolLine`, and `formatElapsed` exports. The former `@iurysza/pi-ext/tool-cards` export and factory adopter are removed.

One resolver calls `next()` for every tool. Exact names select the specs in `cards/index.ts`. Names matching `mcp__<server>__<tool>` select the MCP spec. Unknown names and disabled tidy pass through unchanged. Pi also resolves cards for unregistered tools in resumed sessions.

The builtin `decorate(source)` registrations remain. They still inject reasoning, capture write diffs, and integrate pi-fff. The resolver retains their existing renderers. The original builtin rendering and composition tests remain unchanged.

Cards use the existing tidy mode, icon preference, and pending, success, and error theme backgrounds. Collapsed cards use two lines in default mode and one line in reasoning or result mode. Semantic failures change presentation without changing Pi's `isError` or tool results.

Expanded cards use the spec body when provided. Questions, plan review, Agent progress, and image results retain the renderers returned by `next()`. Their state and `lastComponent` values remain separate from the card wrapper. Without native renderers, expanded views use the raw result. Codemode keeps its script and nested calls in the expanded body.

The shared `cardRuntime` observes tool calls and results, restores recorded timing, and stops timers on results, turn end, session navigation, and shutdown. Nested calls and synthetic Cursor replay do not start visible clock entries. Missing historical timing stays missing. The resolver never executes tools or changes arguments, schemas, `content`, or `details`. Existing builtin execution hooks still persist tidy timing as before.

## Chill mode

`loadTidyChill` reads `chill` from `~/.pi/agent/pi-tidy-tools.json`. Only the boolean `true` enables it. The default is `false`. `/chill` toggles the current extension session without saving settings or reloading.

`tidy/chill.ts` groups builtin and spec'd calls between user or assistant text. Thinking and nested calls do not break a group. Running calls keep their cards. Completed calls fold into one `Worked · <count> tools · <duration>` line. It says `Working` when another call in that group is running. Failures add a red count. Duration totals the recorded tool durations. An untimed result makes the duration unknown.

The wrapper reads state at render time and requests redraws when calls finish or the setting changes. Ctrl+O reveals every folded card and its full body. Branch navigation rebuilds groups from the active branch without changing stored entries.

Unknown tools retain `next()` unchanged, including in chill mode. Pi-managed image attachments render outside the resolver's components, so folding the card does not hide those attachments. These boundaries need review if chill must hide every possible tool display.

## Coverage and evidence

All existing spec families now work through the resolver: memory, session tools, cmux, Cursor questions and skills, delegation, web tools, directories, visual artifacts, plan review, codemode, MCP tools, and MCP resources.

The fixtures contain 39 scrubbed historical captures and 7 constructor-backed cases. `card-renderer-baseline.json` records the step 2 output for all 46 fixtures, collapsed and expanded, at widths 20, 80, and 120. The chill-off test compares these bytes unchanged and also compares builtin result rendering.

`npm ci && npm run check` passes catalog validation, workspace typechecks, tests, and pack checks for all 13 packages. Presentation has 351 passing tests. Cursor SDK has 1,408 passing tests and 2 skipped tests. OptMem has 82 passing tests and one skipped test. WTF has 3 passing tests.

The [implementation report](../workflows/tidy-tool-cards/report.md) lists changed files, versions, screenshot paths, and verification gaps. The offline gallery uses an isolated Pi 1.0.4 with real subagents, web-access, ask-user, and visual-artifact extensions. It never loads the old replay renderer shim, submits a model prompt, or executes a tool.
