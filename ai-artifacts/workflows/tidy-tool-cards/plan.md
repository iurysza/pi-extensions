# Plan: tidy owns every tool card, plus chill mode

Read `intent.md` and `facts.md` in this folder first. Work in this worktree on branch `feat/tool-cards`. Commit at the end of each step with a Conventional Commit message. Don't push, merge, or touch anything outside this worktree, except writing screenshots into the agents2 gallery folder named in `facts.md`.

## Step 1: build against Pi 1.0.4

- Raise the workspace devDependencies on `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to `1.0.4` in the packages that need the new types: at least pi-ext, and any package whose typecheck fails. Leave peer dependencies as `*`.
- Leave a package on its current version if 1.0.4 breaks it in ways unrelated to rendering, and note why in `report.md`. pi-cursor-sdk pins `0.80.9` on purpose. Don't force it.
- Regenerate the single root `package-lock.json` with `npm install`. Then `npm ci && npm run check` must pass.

## Step 2: one resolver in tidy

- In `extensions/tool-presentation/tidy/`, register a single `pi.registerToolRenderer((name, next) => ...)` during tidy's setup:
  - If tidy is disabled (`loadTidyState().enabled` is false), return `next()`.
  - If `specForTool({ name })` finds a spec, return the card renderers for it (`cardRenderers(spec, runtime)`), sharing the one `cardRuntime` clock.
  - Otherwise return `next()` unchanged.
  - For every tool, keep the original renderers from `next()` available. Use them in the expanded view where the spec has no expanded body of its own. Ask user, plan review, Agent progress and image results should keep their specialised views when expanded.
- Built-ins: keep tidy's `decorate(source)` registrations, which change behaviour (diffing write, pi-fff). Draw them through the same resolver path if that's simpler. Either way, built-in output must stay identical, and the existing built-in tests must pass unchanged.
- Move `card/` under `tidy/` (for example `tidy/cards/`) so everything lives in the tidy package, and update imports. Keep the `buildToolBlock`, `fitToolLine` and `formatElapsed` exports from `tidy/index.ts`.
- A spec is chosen by exact name, or by the `mcp__<server>__<tool>` pattern for MCP. Codemode keeps its nested calls in the expanded view only.

## Step 3: remove per-package wiring

- Delete every `ownedCard(...)` spread and its import from pi-optmem, pi-wtf, pi-cursor-sdk, cmux, session-query, session-store and handoff. Restore their package.json dependencies to what `main` had. They no longer need `@iurysza/pi-ext`.
- Remove the `./tool-cards` export from `packages/pi-ext/package.json` if nothing else uses it.
- Delete `card/adopter.ts` and its tests. The resolver replaces it.
- Diff those packages against `main` (`git diff main -- packages/pi-optmem packages/pi-wtf packages/pi-cursor-sdk`). Only unrelated, intentional changes may remain, and they need a note in `report.md`.

## Step 4: chill mode

- Setting `chill` in `~/.pi/agent/pi-tidy-tools.json`, read through `tidy/config.ts`. Default `false`. Command `/chill` toggles it for the current session only, without saving, like pi-chill.
- When chill is on:
  - The tool call currently running shows its normal card.
  - Finished tool calls since the last user or assistant text fold into one line, `Worked · <count> tools · <duration>`, plus a red failure count if any failed. While a tool is still running, the line says `Working`.
  - `Ctrl+O` (Pi's expand toggle) still shows everything in full.
  - Implement this inside the resolver: folded calls render as empty or as the one summary line. No changes to stored messages or tool results.
- When chill is off, output must be byte-identical to tidy without the chill code. Add a test that renders the fixtures with chill off and compares them with the step 2 output.
- Keep the design small. Don't copy pi-chill's notice or reasoning folding.

## Step 5: tests

- Keep all existing presentation tests passing. Built-in tests stay unchanged.
- Add resolver tests with a fake `pi` that records `registerToolRenderer`:
  - It returns cards for spec'd tools, including an MCP name.
  - It returns `next()` for unknown tools and when tidy is disabled.
  - It never calls `execute` and never changes `content` or `details`.
- Add chill tests: folding, failure count, running state, expanded view, and the chill-off identity check.

## Step 6: verify visually

- Build an isolated Pi 1.0.4 to replay with, without touching the global install. For example, `npm install --prefix /tmp/pi104-run @earendil-works/pi-coding-agent@1.0.4`, then run `/tmp/pi104-run/node_modules/.bin/pi`.
- Replay the gallery sessions (`make-session-real.mjs`) with `PI_OFFLINE=1`, the Tokyo Night theme, `--no-extensions`, and `-e` pointing at this worktree's tidy entry (`packages/pi-ext/extensions/tool-presentation/index.ts`). This time, load the real third-party extensions as well where possible, from `~/.local/share/agents2/tools/...` (pi-subagents, pi-web-access, pi-ask-user, visual-artifact). That way, cards apply to tools the replay shim didn't register. Never send a prompt.
- Save to the agents2 gallery folder:
  - `v2-collapsed-*.png` and `v2-expanded-*.png`, chill off
  - `v2-chill-*.png`, chill on
  - Use termctrl. Stop every session you start.

## Step 7: report

Write `ai-artifacts/workflows/tidy-tool-cards/report.md` with these sections:
- which tools get cards through the resolver
- what was removed from other packages
- the package versions changed
- chill mode behaviour
- test counts
- screenshot paths
- anything left unverified, such as live-running states or MCP servers that weren't connected

## Unresolved questions

- Whether `Ctrl+O` should expand folded chill groups or only individual calls. Default: it expands everything, as Pi already does.
