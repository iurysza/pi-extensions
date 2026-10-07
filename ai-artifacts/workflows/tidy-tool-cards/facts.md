# Facts (verified 2026-10-07)

## Pi 1.0.4 renderer API

Extracted package for reading: `/tmp/pi104/package/` (from `npm pack @earendil-works/pi-coding-agent@1.0.4`).

- `ExtensionAPI.registerToolRenderer(resolver: ToolRendererResolver): void`, at `dist/core/extensions/types.d.ts:1221`. Doc: "Choose how tool calls are drawn. Resolvers run in extension load order."
- `type ToolRendererResolver = (toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined` (`types.d.ts:506`). `next()` returns what the remaining resolvers, then the registered tool, would use.
- `type ToolRenderers = Pick<ToolDefinition, "renderShell" | "renderCall" | "renderResult">` (`types.d.ts:501`).
- Interactive mode resolves renderers with `extensionRunner.resolveToolRenderers(toolName, () => withBuiltInRenderers(toolName, getToolDefinition(toolName)))` (`dist/modes/interactive/interactive-mode.js:1701`). It also covers unregistered tools, such as MCP tools in resumed sessions (CHANGELOG 1.0.1).
- Docs: `/tmp/pi104/package/docs/extensions.md`, section "Tool rendering".
- Breaking changes from 1.0.0 to 1.0.4: the Azure provider was renamed (Iury's config doesn't use it). `Home`/`End` keys changed. Nothing touches extension rendering.

## Installed today

- Live Pi is 1.0.0 via Volta (`~/.volta/bin/pi`). agents2 `lock.json` also pins 1.0.0. An agents2 dry run (`src/cli.ts update pi`) resolves cleanly to 1.0.4.
- Workspace devDependencies in this repo use `@earendil-works/pi-coding-agent` `^0.80.10` (pi-cursor-sdk pins `0.80.9`). Peer dependencies are `*`.

## pi-chill (reference only, MIT)

Clone: `/tmp/howaboua-pi-stuff/packages/pi-chill` (dev branch, commit `4a4aff9`).
- `index.ts:79-81`: one `registerToolRenderer` for every tool except `new_context`.
- `src/renderers.ts:127-258`: wraps `next()` renderers and delegates expanded views to the original renderer.
- README: chill folds finished calls into a `Working/Worked · duration` block and shows only the current action. `/chill` toggles per session. `Ctrl+O` shows full details.
- Risk it notes: a resolver that loads earlier and doesn't call `next()` hides tools from later resolvers.

## Current branch state (`feat/tool-cards` at `a4b235b`)

- Card module: `packages/pi-ext/extensions/tool-presentation/card/`, with `card.ts` (`renderCard`, `buildToolBlock`), `spec.ts`, `specs/*.ts`, `renderers.ts` (`cardRenderers`, `cardRuntime`, `ownedCard`) and `adopter.ts`, which is disabled and unused.
- Exported as `@iurysza/pi-ext/tool-cards` in `packages/pi-ext/package.json`.
- Built-ins are drawn by tidy re-registering read, write, edit, bash, grep, find and ls through `decorate(source)` (`tidy/index.ts:~393-401`). Those registrations also change behaviour: diffing write and pi-fff search. Keep them.
- `ownedCard` is used in pi-optmem (`src/index.ts`), pi-wtf (`src/index.ts`), pi-cursor-sdk (`cursor-question-tool.ts`, `cursor-skill-tool.ts`) and pi-ext (`cmux/tools.ts`, `session-query/session-query.ts`, `session-store/index.ts`, `handoff/index.ts`).
- Tests: `packages/pi-ext/tests/tool-presentation/cards.test.ts` and fixtures `card-fixtures.json` and `card-contract-fixtures.json`. All 339 presentation tests pass. `npm run check` passes.
- Settings file: `~/.pi/agent/pi-tidy-tools.json`, read by `tidy/config.ts`.
- Design: `~/dev/personal/tools/agents2/ai-artifacts/tool-ui-inventory/card-proposal.md`.
- Gallery tooling: `~/dev/personal/tools/agents2/ai-artifacts/tool-ui-inventory/gallery/` (`make-session-real.mjs`, `fixed-collapsed-*.png`). Replay command pattern: `PI_OFFLINE=1 pi --no-extensions ... --theme <tokyo-night.json> --session <file> -e <ext>`. Theme: `~/.local/share/agents2/tools/pi-themes/1.0.1/node_modules/pi-themes/themes/tokyo-night.json`. Capture with termctrl (`TERMCTRL_RUNTIME_DIR=/tmp/tc`, `--font-family 'IoskeleyMonoTerm Nerd Font Mono'`).

## Repo rules (pi-extensions AGENTS.md)

- One root `package-lock.json`. No child lockfiles.
- Update the root `pi` catalog if any child manifest's Pi resources change.
- `npm ci && npm run check` must pass.
- Never add Cursor as author or co-author.
- Don't touch agents2, installed Pi config, profiles, `~/.pi/agent/*` or installed packages under `~/.local/share/agents2`.
- Never send a prompt in a replay Pi, because that calls a model.
