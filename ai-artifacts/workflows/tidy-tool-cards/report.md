# Tidy tool cards report

Tidy now resolves cards centrally on Pi 1.0.4. Package-local card wiring is removed, and `/chill` folds completed cards without changing stored messages or results.

## Tools covered by the resolver

The resolver selects 33 exact-name specs:

- memory: `memo_note`, `memo_nap`, `memo_zoom`, `memo_recall`
- sessions: `session_query`, `search_sessions`, `handoff`
- friction: `wtf`
- cmux: `cmux_browser`, `cmux_workspace`, `cmux_notify`
- Cursor: `cursor_ask_question`, `cursor_activate_skill`
- questions: `ask_user`, `choose_visual_artifact_direction`
- directories: `add_directory`, `search_external_files`
- artifacts: `create_visual_artifact`
- plans: `plannotator_mark_done`, `plannotator_submit_plan`
- web: `web_enable`, `web_search`, `fetch_content`, `get_search_content`, `source_check`
- delegation: `Agent`, `SubagentWorkflow`, `get_subagent_result`, `steer_subagent`
- MCP resources: `list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`
- scripts: `codemode`

Names matching `mcp__<server>__<tool>` also get cards, including unregistered tools in resumed sessions. Unknown tools and disabled tidy return `next()` unchanged.

The builtin registrations for `read`, `write`, `edit`, `bash`, `grep`, `find`, and `ls` remain. Their diffing, reasoning, and pi-fff behavior remain intact. The resolver preserves their existing rendering.

Questions, plan review, Agent progress, and image results retain native expanded renderers when available. Codemode scripts and nested calls remain expanded-only. The shared runtime never executes tools or changes result content or details.

## Wiring removed from other packages

Removed every `ownedCard` import and spread from OptMem, WTF, Cursor SDK, cmux, session-query, session-store, and handoff. Removed the public `./tool-cards` export, `ownedCard` helper, factory adopter, and 2 adopter tests.

Restored the 3 dependent package manifests and card-related test scaffolding to `main`. This command produces no diff:

```sh
git diff main -- packages/pi-optmem packages/pi-wtf packages/pi-cursor-sdk
```

No unrelated package changes remain.

## Package versions changed

Only pi-ext's devDependencies changed:

| Package | Before | After |
| --- | --- | --- |
| `@earendil-works/pi-coding-agent` | `^0.80.10` | `1.0.4` |
| `@earendil-works/pi-tui` | `^0.80.10` | `1.0.4` |
| `@earendil-works/pi-ai` | `^0.80.10` | `1.0.4` |
| `@earendil-works/pi-agent-core` | `^0.80.10` | `1.0.4` |

The AI and agent-core upgrades resolve incompatible message types. Other workspace versions stay unchanged. Cursor SDK retains its intentional `0.80.9` pins. Peer dependencies stay `*`. The single root lockfile was regenerated with `npm install`.

Pi 1 adds persistent system messages and a builtin bash guideline. Updated 2 native integration assertions for the new version and system-message behavior. Tidy retains its earlier bash prompt metadata. The builtin rendering and composition tests remain unchanged.

The supplied facts file's 2 absolute home-path prefixes now use `~`. Catalog validation rejects machine-specific home paths. No accepted facts changed.

## Chill mode behavior

`loadTidyChill` reads `chill` from `~/.pi/agent/pi-tidy-tools.json`. The default is `false`. Only the literal boolean `true` enables it.

`/chill` toggles the current session without saving or reloading. Running cards stay visible. Completed builtin and spec'd calls between user or assistant text fold into one summary. Thinking and nested calls do not break groups.

The line reads `Working` while another grouped tool runs, then `Worked`. It includes completed tool count, total recorded tool duration, and a red failure count. Missing historical durations display `unknown duration` rather than invented timing. Parallel calls keep their running cards and one summary.

Ctrl+O shows every folded card in full. Session navigation rebuilds groups from the active branch. No transcript entries, tool content, or tool details change.

Unknown tools keep the approved pass-through behavior and do not fold. Pi-managed image attachments sit outside renderer components and can remain visible after their card folds. Hiding these displays would require extending the approved pass-through rule or Pi's image-rendering API.

## Test counts and verification

`npm ci && npm run check` passes from this worktree. The check includes catalog validation, all workspace typechecks and tests, and pack checks for 13 packages.

| Tests | Passed | Skipped |
| --- | ---: | ---: |
| presentation | 351 | 0 |
| Cursor SDK | 1,408 | 2 |
| OptMem | 82 | 1 |
| WTF | 3 | 0 |
| all workspace tests | 2,134 | 3 |

Added 14 tests after removing 2 adopter tests. Coverage includes resolver selection, pass-through, disabled tidy, immutable results, native expanded views, image delegation, codemode expansion, folding, failures, parallel calls, boundaries, restoration, toggling, and config defaults.

The chill-off test compares all 46 fixtures against step 2's recorded bytes, collapsed and expanded, at widths 20, 80, and 120. It also compares builtin result output. `git diff --check` passes.

`npm ci` reports 29 dependency vulnerabilities, including one critical vulnerability. No audit fixes were applied because dependency-wide remediation is outside this plan.

## Screenshot paths

Saved and opened all 17 screenshots under:

```text
~/dev/personal/tools/agents2/ai-artifacts/tool-ui-inventory/gallery/
```

The files are:

```text
v2-collapsed-1.png
v2-collapsed-2.png
v2-collapsed-3.png
v2-collapsed-4.png
v2-collapsed-5.png
v2-expanded-1.png
v2-expanded-2.png
v2-expanded-3.png
v2-expanded-4.png
v2-expanded-5.png
v2-expanded-top-2.png
v2-expanded-top-4.png
v2-chill-1.png
v2-chill-2.png
v2-chill-3.png
v2-chill-4.png
v2-chill-5.png
```

Replay used an isolated Pi 1.0.4 at `/tmp/pi104-tool-cards-run`, offline mode, Tokyo Night, explicit worktree tidy loading, and termctrl. Real extensions loaded were subagents 0.19.0, web-access 0.35.0, ask-user 0.15.1, and visual-artifact. The generator's obsolete replay renderer shim was not loaded. The resolver drew tools that no extension registered.

`replay-gallery.mjs` reproduces the captures with isolated home, settings, and session directories under `/tmp`. `/chill` was the only submitted text and is an extension command, not a model prompt. No tools or models executed. Every started terminal stopped. The real Pi install and installed packages were untouched.

## Unverified behavior and boundaries

Live-running and partial states have automated coverage but no live-model screenshot. Remote web providers, connected MCP servers, dialogs, and native plan-review UI were not exercised. Image delegation has a renderer test, but terminal image attachments and their chill-mode behavior were not visually verified.

The gallery's older labels still say "spec preview only" because the supplied generator was left unchanged. Page 5 remains constructor-backed evidence, not historical session output. Untimed fixtures account for the unknown-duration summaries.

The live user setup is unchanged. It needs Pi 1.0.4 or newer to use the resolver and `/chill`. Older hosts retain builtin tidy registrations only.

## Changed files

Paths are relative to the worktree. This list compares the implementation with its starting commit, `a4b235b`. The supplied `intent.md` and `plan.md` remain untouched and untracked.

```text
ai-artifacts/specs/tool-cards.md
ai-artifacts/workflows/tidy-tool-cards/facts.md
ai-artifacts/workflows/tidy-tool-cards/replay-gallery.mjs
ai-artifacts/workflows/tidy-tool-cards/report.md
package-lock.json
packages/pi-cursor-sdk/package.json
packages/pi-cursor-sdk/src/cursor-question-tool.ts
packages/pi-cursor-sdk/src/cursor-skill-tool.ts
packages/pi-cursor-sdk/test/cursor-project-trust-contract.test.ts
packages/pi-cursor-sdk/test/helpers/event-harness.ts
packages/pi-cursor-sdk/test/helpers/pi-harness-types.ts
packages/pi-ext/package.json
packages/pi-ext/extensions/cmux/tools.ts
packages/pi-ext/extensions/handoff/index.ts
packages/pi-ext/extensions/session-query/session-query.ts
packages/pi-ext/extensions/session-store/index.ts
packages/pi-ext/extensions/tool-presentation/index.ts
packages/pi-ext/extensions/tool-presentation/tidy/index.ts
packages/pi-ext/extensions/tool-presentation/tidy/config.ts
packages/pi-ext/extensions/tool-presentation/tidy/chill.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/card.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/index.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/renderers.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/spec.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/builtins.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/codemode.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/mcp.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/memory.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/misc.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/subagents.ts
packages/pi-ext/extensions/tool-presentation/tidy/cards/specs/web.ts
packages/pi-ext/tests/tool-presentation/card-renderer-baseline.json
packages/pi-ext/tests/tool-presentation/cards.test.ts
packages/pi-ext/tests/tool-presentation/conversation-timeline-native.test.ts
packages/pi-ext/tests/tool-presentation/tidy/chill.test.ts
packages/pi-ext/tests/tool-presentation/tidy/pi-fff-adapter.test.ts
packages/pi-ext/tests/tool-presentation/tidy/renderer-harness.ts
packages/pi-ext/tests/tool-presentation/tidy/resolver.test.ts
packages/pi-optmem/package.json
packages/pi-optmem/src/index.ts
packages/pi-optmem/tests/extension.test.mjs
packages/pi-wtf/package.json
packages/pi-wtf/src/index.ts
packages/pi-wtf/tests/wtf.test.mjs
```

The 11 files now under `tidy/cards/` moved from `tool-presentation/card/`. Deleted `packages/pi-ext/extensions/tool-presentation/card/adopter.ts`. The 17 external screenshots listed above are the only retained changes outside this worktree.
