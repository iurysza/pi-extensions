# Cursor SDK 1.2.0 contracts

The dependency manifests and root lockfile match PR #29 head `d26e756620a4bc0858234886da4de7e37d23a2d0`. Pi remains at 1.4.0. Runtime formulas and transport guards are unchanged. The runtime usage comment now distinguishes historical and current SDK totals.

## Evidence

Inspected the installed `@cursor/sdk` 1.2.0 declarations and ESM bundles. Tests find unique chunks by semantic markers where chunk numbers moved. Exact source assertions still check forwarding, timeout values, error handling, and arithmetic. Bundle inspection does not establish live service behavior.

| Contract | Installed evidence and result |
| --- | --- |
| Agent mock | `SDKAgent.summarize()` returns `Promise<Run>`. The mock supplies a typed run with stream, conversation, cancellation, and status-listener methods. |
| HTTP preference | `sdk-config` still accepts `boolean` or `null`; null clears the default. Executor selection still uses the configured preference before the environment fallback. The executor cache key excludes the preference, and releasing the last reference still removes the cached executor. Minified identifiers changed. |
| MCP timeout | `McpSdkClient` now delegates through `sendToolCall`, preserving request options and combining abort signals. Paginated discovery calls `Client.listTools` through a schema-repair helper. The protocol still defaults to 60,000 ms and calls `_setupTimeout`. Existing tests retain the 3,600-second tool override, 10-second connect override, and exclusion of unknown protocol stacks. |
| Closed writable | `WriteIterableClosedError`, its message, the controlled-executor catch, and the error-response write remain. The local runtime moved from chunk `464.js` to `336.js`. Existing error matching and real-process containment tests remain. |
| Child stdin | Background-shell `writeStdin` and observable-spawn writes still lack a local stdin error listener. Shell startup commands now use a guarded fd-5 pipe. Command-hook payload writes use `end` and `finished`, swallowing only `EPIPE`, `ERR_STREAM_DESTROYED`, and `ERR_STREAM_PREMATURE_CLOSE`. MCP stdio still forwards stdin errors. The guard remains unchanged because unguarded write paths remain; tests no longer claim the whole local-runtime bundle has no stdin listener. |
| Stalled connection | Both stalled messages still use `RetriableError`, retryable display details, and the same classifier inputs. 1.2.0 also assigns `code: "connection_stalled"`. |
| Ripgrep | An absolute `CURSOR_RIPGREP_PATH` still wins, followed by executable search and the configured fallback. Empty and unconfigured paths retain their errors. |
| Usage | `toTokenUsage` and `sumTokenUsage` changed from the historical four-field sum to `inputTokens + outputTokens`. They retain cache and optional reasoning fields, but exclude both from the total. Our runtime already totals full input plus output and subtracts cache fields only to produce Pi's disjoint input component. No formula change is needed. |
| Exact pins | Tests expect Cursor SDK 1.2.0, MCP SDK 1.32.2, Hono 2.1.6, and pi-vcc 0.11.2. The handoff test still loads the extension and checks its command registration. |

The exact PR lock retains an old Hono 2.1.5 `inBundle` workspace record. `npm ci` does not install that record; actual resolution and `npm ls` use hoisted Hono 2.1.6. The metadata test only prefers a nested lock entry when that package is installed locally, then checks the installed Hono version. The lockfile remains unchanged from #29.

## Historical fixtures

Captured fixtures are unchanged. The cloud activity fixture and stalled-error contract retain their 1.0.37 metadata. The usage fixture retains its note that raw turn-ended samples came from 1.0.23 and the published transform was rechecked on 1.0.37. Tests separate those historical claims from installed 1.2.0 assertions. No new live local or cloud capture was made.

## SDK trust

The lead independently checked that npm publisher `arousselxai` is a listed maintainer, the repository remains `cursor/cursor`, registry signatures exist, and there are no install hooks. This cleared local verification. No npm provenance or attestation was available, so source-build origin remains unverifiable.

Cursor SDK's `zod` peer resolves to 3.25.76, satisfying `^3.25.0 || ^4.0.0`.

## Verification

The preserved, untracked root brief contains a machine home path and fails the catalog scan in the shared worktree. Full verification uses a disposable snapshot of tracked worktree files plus this report, excluding the brief and friction notes. No user-owned file is moved or edited.

Clean-snapshot `npm ci && npm run check` passed, including catalog checks, all workspace typechecks and tests, and all 16 publishable package checks. The Cursor SDK suite passed 1,418 tests with 3 existing skips. `npm ci` reported 10 vulnerabilities and warned about three unapproved dependency lifecycle scripts. No audit fix or script-approval changes were made.
