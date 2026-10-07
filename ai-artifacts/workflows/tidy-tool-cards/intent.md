# Intent: tidy owns every tool card

## Why

Tool calls in Pi look different depending on who registered the tool. Built-ins have compact tidy cards. Other tools show raw text, multi-line JSON or their own styles. Iury wants one standard look, customised in one place.

Branch `feat/tool-cards` (commits `0602f14`, `a4b235b`) built shared card specs. On Pi 1.0.0 it could only attach them to first-party tools, by adding `ownedCard(...)` to each tool's `registerTool` call. That spread presentation code across packages and added a dependency on `pi-ext` 0.2.0.

Pi 1.0.4 adds `pi.registerToolRenderer(resolver)`. One extension can choose how any tool is drawn, including tools other extensions registered. The pi-chill extension uses this.

## Outcome

1. Pi 1.0.4 is the target. The repo builds and tests against it.
2. Tidy owns all tool-card presentation. One resolver, registered by tidy, draws every tool that has a card spec. Tools without a spec draw exactly as before.
3. No other package contains card code. Remove the `ownedCard` wiring and the `pi-ext` 0.2.0 dependency from pi-optmem, pi-wtf, pi-cursor-sdk, cmux, session-query, session-store and handoff.
4. A chill mode, off by default. When on, the conversation shows only the current tool call. Earlier calls fold away. When off, everything looks exactly the same as without chill mode.

## Not in scope

- Hiding reasoning, user messages or custom notices, which pi-chill also does.
- Mouse interaction.
- Changing what any tool does or returns. Presentation only.
- Changing the live Pi install, agents2 or profiles. Iury's main session does that after the build.
