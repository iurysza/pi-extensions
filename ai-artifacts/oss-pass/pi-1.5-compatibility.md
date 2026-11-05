# Pi 1.5 compatibility

PR #31 carries the Pi 1.5 compatibility changes from PR #28 and now includes main's dependency updates from PR #30.

## Dependency alignment

PR #28 updated `pi-ai` and `pi-coding-agent` to 1.5.0 but left direct `pi-agent-core` and `pi-tui` development dependencies at 1.4.0.

The compatibility changes pin these remaining dependencies to 1.5.0:

- `packages/pi-ext/package.json`: `pi-agent-core` and `pi-tui`
- `packages/pi-cursor-sdk/package.json`: `pi-tui`
- `packages/pi-cursor-cloud/package.json`: `pi-tui`
- `packages/pi-follow-up/package.json`: `pi-tui`
- `packages/pi-token-tank/package.json`: `pi-tui`

The regenerated root lockfile uses main's lockfile as its baseline and keeps one copy of each Pi package, all at 1.5.0. Peer ranges stay unchanged. Main's PR #30 updates are included, with Cursor SDK 1.2.0, MCP SDK 1.32.2, Hono node-server 2.1.6, Node types 26.6.6, Shiki 4.6.0, and pi-vcc 0.11.2.

The merged metadata test retains both the SDK/Hono version assertions and the Pi 1.5 single-copy identity guard. Main's SDK contract tests and the Pi 1.5 journal rollback, render-context, and cmux tests remain in place.

This removes the duplicate `AgentMessage` identity behind the conversation timeline error. `conversation-timeline.ts` needs no cast, alternate import, or code change. A new metadata test rejects duplicate Pi lock entries and mismatched versions.

## Code and test changes

`packages/pi-cursor-sdk/test/helpers/render-fixtures.ts` now supplies `keyText` and `keyHint`, required by Pi 1.5's `ToolRenderContext`. Defaults represent an unbound key. A focused test verifies both defaults and caller overrides.

`packages/pi-ext/extensions/cmux/tools.ts` checks that `find_by` is a nonempty string before using it as a computed property. Pi 1.5's published `StringEnum` returns a pi-schema schema, and wrapping it with TypeBox's `Optional` loses the string inference at this call site. The guard resolves the error without a cast or schema rewrite. Valid requests are unchanged; malformed direct executor calls now return the existing missing-key error instead of dispatching them.

The new cmux tests use Pi's public `validateToolArguments` and a fake socket client. They cover all 6 selector keys, invalid enums, optional-null removal, numeric and boolean coercion, and rejection before dispatch. The workspace test script runs them.

Two existing tests also needed updated contracts:

- the real-host pi-fff alias test now expects Pi 1.5.0 and retains its shared-identity checks
- the real SessionManager failure test now asserts rollback of the branch, entry list, and leaf, then verifies successful retry and reloading from disk

Pi 1.5's `SessionManager._appendEntry` rolls back its in-memory changes when persistence throws. Earlier Pi behavior could leave a partial in-memory commit. The extension's recovery logic and its mocked older-host tests remain unchanged.

## Schema audit

Read the Pi 1.5 extension documentation, its hello, dynamic-tool, and built-in-renderer examples, and the installed pi-schema README and declarations.

Inspected repository tool registrations and their schema definitions in Cursor SDK, Cursor Cloud, OptMem, WTF, and pi-ext. This included imported question schemas, replay schemas, and built-in tool wrappers. Searched source for unsupported TypeBox refinements, JavaScript-only types, codecs, and custom format registration.

No registered schema uses `Type.Refine`, `Type.BigInt`, `Type.Undefined`, `Type.Void`, `Type.Function`, `Type.Codec`, or `Format.Set`. Constructors in source use JSON Schema objects, strings, booleans, numbers, arrays, records, unions, and optional fields. `StringEnum` emits standard string enums. No schema migration was needed.

This audit covers repository-owned registrations, not arbitrary third-party MCP or installed extension schemas. The cmux regression tests exercise Pi 1.5 validation directly; existing native session tests exercise the timeline and built-in tool wrappers.

## Initial verification

- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund`: passed
- `npm ci`: passed
- `npm run typecheck`: passed
- `npm run check`: passed, including catalog validation and pack checks for 16 packages
- Cursor SDK: 128 test files passed, one skipped; 1,418 tests passed, 3 skipped
- pi-ext presentation: 379 tests passed
- cmux: 3 new tests passed
- `npm ls` confirms the Pi family resolves to 1.5.0 with deduplicated dependencies
- `git diff --check`: passed

Logs are in `/tmp/oss-pass-pr28-ci.log`, `/tmp/oss-pass-pr28-check.log`, and `/tmp/oss-pass-pr28-ext-tests.log`. The last file records the initial stale-version failure, before its correction.

`npm ci` reports 8 vulnerabilities: 2 moderate, 5 high, and one critical. It also warns about unapproved install scripts for `@google/genai`, `better-sqlite3`, and `esbuild`. No audit fix or lifecycle-script approval was attempted. No live Pi configuration or installation was changed.

## Merge verification

After merging main at `8b82899`, regenerated the root lockfile from main's baseline with `npm install --ignore-scripts --no-audit --no-fund`.

- `npm ci && npm run check`: passed, including catalog validation, typechecking, tests, and pack checks for 16 packages
- Cursor SDK: 128 test files passed, one skipped; 1,420 tests passed, 3 skipped
- `npm ls`: exited 0, with all six Pi-family packages at 1.5.0 and Cursor SDK at 1.2.0
- installed MCP SDK, Hono node-server, Node types, Shiki, and pi-vcc match main's versions listed above

Logs are in `/tmp/oss-pass-pr31-merge/`. The merged install reports 7 vulnerabilities: 2 moderate, 4 high, and one critical. The same three lifecycle-script warnings remain. No audit fix or lifecycle-script approval was attempted.
