# Claude Code provider: type breakdown

Superseded where they differ by [the technical specification](../specs/2026-09-25-claude-code-provider.md), which re-checks these facts against Claude Code 2.1.282.

Type-driven implementation outline for `packages/pi-claude-code`. Terms follow [the context glossary](../packages/pi-claude-code/CONTEXT.md).

Approved direction: pi runs every Host Tool and each Turn ends at a Tool Boundary, as in Hermes. The Admission Relay ships in full, including the Cache Breakpoint pin.

```text
[existing]   Confirmed in pi 0.80.10 or in this repository
[existing*]  Written in the working tree, not yet committed
[inferred]   Implied by the current implementation
[proposed]   Introduced by this plan
[?]          Unresolved
```

## Execution tree

### Extension load

```text
▼ [existing] pi extension loader imports ./src/index.ts (package and root `pi.extensions`)
  └─▶ [proposed] default export claudeCodeExtension(pi)
      defined: src/index.ts
      input:   Pick<ExtensionAPI, "registerProvider" | "registerCommand" | "on">
      output:  void
      effects: registers provider "claude-code", two commands, one shutdown handler; spawns nothing

      ├─▶ [proposed] createClaudeCodeProviderConfig(models): ProviderConfig
      │     { name: "Claude Code", baseUrl: CLAUDE_CODE_BASE_URL, apiKey: CLI_LOGIN_PLACEHOLDER,
      │       api: CLAUDE_CODE_API, models, streamSimple: streamClaudeCodeLazy, refreshModels }
      │     └─▶ [existing*] pinnedModelConfigs(): ProviderModelConfig[]      src/claude-code-model-catalog.ts
      ├─▶ [existing] pi.registerProvider("claude-code", config)
      ├─▶ [existing] pi.registerCommand("claude-code-status", …)
      ├─▶ [existing] pi.registerCommand("claude-code-refresh-models", …)
      └─▶ [existing] pi.on("session_shutdown", removeProcessDirectory)
```

`apiKey` is a non-secret placeholder. pi's provider composer throws `no authentication method configured` for a provider with models but neither `apiKey` nor `oauth` (`provider-composer.js`, `composeModelProvider`). The Subscription Login stays inside the Claude Code CLI.

### Model refresh

```text
▼ [existing] ModelRuntime.refresh({ allowNetwork, force?, signal? })
  defined: pi-coding-agent/dist/core/model-runtime.js
  called:  startup with allowNetwork: false; /model selector on open (15 s budget); ModelRegistry.refresh()
  └─▶ [existing] composed provider.refreshModels(context)                    provider-composer.js
      └─▶ [proposed] refreshClaudeCodeModels(context, cli): Promise<ProviderModelConfig[]>
          defined: src/claude-code-model-refresh.ts
          input:   RefreshModelsContext { store, allowNetwork, force?, signal? }
          effects: reads and writes pi's per-provider model store; may spawn the CLI twice

          ├─▶ [existing] context.store.read(): Promise<ModelsStoreEntry | undefined>
          ├─ return cached ?? pinned when: !allowNetwork, or checkedAt is under 24 h old and neither
          │  context.force nor the refresh command's one-shot flag is set
          ├─▶ [proposed] readAuthStatus(cli, signal): Promise<AuthStatus>          src/claude-code-setup.ts
          │     effects: spawns `claude auth status`; offline
          ├─▶ [proposed] readPicker(cli, signal): Promise<readonly NativePickerRow[] | undefined>
          │     effects: starts an Admission Relay, sends the initialize control request, requires zero
          │              Upstream Requests, returns undefined on any surprise
          ├─▶ [existing*] modelConfigsFromPicker(rows): ProviderModelConfig[]
          └─▶ [existing] context.store.write({ models: configs.map(modelFromConfig), checkedAt })
```

A logged-out CLI still answers the handshake with a generic list, so `readPicker` runs only after `readAuthStatus` reports a Subscription Login. Failure returns the cached or pinned list and writes nothing.

### Turn

```text
▼ [existing] streamAssistantResponse(context, config, signal, emit, streamFn)
  defined: pi-agent-core/dist/agent-loop.js:177 (provider call at :194)
  └─▶ [existing] composed provider.streamSimple → extension.streamSimple     provider-composer.js
      └─▶ [proposed] streamClaudeCodeLazy(model, context, options): AssistantMessageEventStream
          defined: src/claude-code-provider-lazy.ts
          effects: dynamic import, so pi startup never loads the runtime modules
          └─▶ [proposed] streamClaudeCode(model, context, options, runtime = defaultRuntime())
              defined: src/claude-code-provider.ts
              output:  AssistantMessageEventStream   start … done | error

              ├─▶ [proposed] buildTurnRequest(model, context, options): TurnRequest        PURE
              │     defined: src/claude-code-request.ts
              │     throws:  TurnRequestError
              │     ├─▶ normalizeHistory(messages, model): Message[]
              │     │     drops error and aborted assistant messages; synthesizes results for orphaned
              │     │     tool calls; Foreign Message thinking becomes text; foreign tool-call ids are
              │     │     rewritten to ^[A-Za-z0-9_-]{1,64}$ with results remapped
              │     ├─▶ toFrames(messages, model): { replayed: InputFrame[]; query: UserFrame }   × messages
              │     ├─▶ toToolInventory(tools): ToolInventory                               × tools
              │     │     normalizeInputSchema(schema) drops top-level oneOf/allOf/anyOf
              │     └─▶ toExtraBody(model.id, options.reasoning, options.maxTokens, inventory): ExtraBody
              │           uses [existing*] acceptsThinkingDisable, supportsAdaptiveThinking, effortForLevel
              │
              └─▶ [proposed] runTurn(request, runtime, emitter, signal): Promise<TurnOutcome>
                  defined: src/claude-code-turn.ts
                  effects: temp dir, loopback server, child process group, pipes

                  ├─▶ resolveClaudeCommand(env): ResolvedCommand | undefined         src/claude-code-cli.ts
                  ├─▶ writeTurnFiles(request): Promise<TurnFiles>                     src/claude-code-turn-files.ts
                  │     system.md, settings.json { env: { CLAUDE_CODE_EXTRA_BODY } }, tools.json, mcp.json
                  ├─▶ AdmissionRelay.start({ upstream, idleTimeoutMs, queried, onEvent })
                  │     defined: src/claude-code-admission.ts
                  │     ├─▶ pinCacheBreakpoint(payload, queried): Buffer        PURE  src/claude-code-cache-breakpoint.ts
                  │     └─▶ ResponseCapture.feed(chunk)                         PURE  src/claude-code-response-capture.ts
                  │           SSE bytes → SseEvent × N → onEvent(event)
                  ├─▶ buildProcessEnv(env, relay.url, request): NodeJS.ProcessEnv     src/claude-code-cli.ts
                  ├─▶ spawnClaudeProcess(command, turnArgs(request, files), { cwd: processDirectory, env })
                  ├─▶ readCliEvents(stdout): AsyncIterable<CliEvent>                  src/claude-code-stream-json.ts
                  ├─▶ replayHistory(stdin, events, request): Promise<void>
                  │     Replayed Frames with shouldQuery: false; one Replay Acknowledgment per replayed
                  │     user frame; then the Query Frame; then stdin closes
                  ├─ relay onEvent ─▶ TurnEmitter.apply(event)                         src/claude-code-turn-emitter.ts
                  │     content_block_* → text_* / thinking_* / toolcall_* on the pi stream
                  ├─▶ collectTranscript(events, process): Promise<CliTranscript>
                  └─▶ settleTurn(transcript, relay.snapshot(), request.inventory): TurnOutcome   PURE
```

The pi stream is driven by the Captured Response as it arrives, not by the CLI's stdout `stream_event` lines. Hermes streams from stdout and reconciles against the capture at the end; driving from the capture removes that reconciliation. stdout still supplies Replay Acknowledgments, the CLI's own errors, the final `result`, and liveness for the idle timeout.

## Type flow

```text
Context (pi)                                    [existing]
  → Message[] (replayable)                      normalizeHistory
  → TurnRequest                                 toFrames, toToolInventory, toExtraBody
  → stdin NDJSON + turn files                   replayHistory, writeTurnFiles
  → Upstream Request bytes                      built by the Claude Code Process
  → pinned Upstream Request bytes               pinCacheBreakpoint
  → SseEvent × N                                ResponseCapture.feed
  → CapturedResponse                            complete at message_stop with a stop_reason and no pending tool input
  → AssistantMessage (live partial)             TurnEmitter.apply

stdout NDJSON → CliEvent × N → CliTranscript    readCliEvents, collectTranscript
CliTranscript + RelaySnapshot → TurnOutcome     settleTurn
TurnOutcome → done | error                      streamClaudeCode
```

## Type definitions

```ts
// src/claude-code-model-catalog.ts  [existing*]
type ModelRoute = string;                         // "claude-sonnet-5[1m]"; unpinned ids are routes already
type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

// src/claude-code-request.ts  [proposed]
type NativeToolName = `mcp__pi__${string}`;

type NativeBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: NativeToolName; input: JsonObject }
  | { type: "tool_result"; tool_use_id: string; content: string | (TextBlock | ImageBlock)[]; is_error?: boolean }
  | ImageBlock;                                   // { type: "image"; source: { type: "base64"; media_type; data } }

type UserFrame = { type: "user"; message: { role: "user"; content: NativeBlock[] } };
type AssistantFrame = { type: "assistant"; message: { role: "assistant"; content: NativeBlock[] } };
type InputFrame = UserFrame | AssistantFrame;     // Replayed user frames gain shouldQuery: false on write

interface InventoryEntry { name: string; description: string; inputSchema: JsonObject }
interface ToolInventory {
  entries: readonly InventoryEntry[];             // tools.json for the Inert Inventory Server
  names: ReadonlySet<string>;                     // Host Tool names allowed back from Claude
  skipped: readonly string[];                     // names Anthropic would reject
}

interface ExtraBody {                             // CLAUDE_CODE_EXTRA_BODY
  tools: { name: NativeToolName; description: string; input_schema: JsonObject }[];
  thinking?: { type: "adaptive" } | { type: "disabled" };
  context_management?: { edits: [] };             // required alongside thinking: disabled
  output_config?: { effort: ClaudeEffort };
  max_tokens?: number;
}

interface TurnRequest {
  modelRoute: ModelRoute;
  systemPrompt: string;                           // pi's prompt plus a short Native Tool Name note
  replayed: readonly InputFrame[];
  query: UserFrame;                               // also the relay's `queried` blocks for the pin
  inventory: ToolInventory;
  extraBody: ExtraBody;
}

type TurnRequestError =
  | { type: "EndsWithAssistant" }                 // assistant prefill is unsupported
  | { type: "EmptyQueryFrame" };

// src/claude-code-response-capture.ts  [proposed]
type SseEvent =
  | { type: "message_start"; message: AnthropicMessage }
  | { type: "content_block_start"; index: number; content_block: NativeBlock }
  | { type: "content_block_delta"; index: number; delta: BlockDelta }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string; stop_sequence?: string | null }; usage?: Partial<NativeUsage> }
  | { type: "message_stop" }
  | { type: "error"; error: { type: string; message: string } }
  | { type: "ping" };

type BlockDelta =
  | { type: "text_delta"; text: string }
  | { type: "thinking_delta"; thinking: string }
  | { type: "signature_delta"; signature: string }
  | { type: "input_json_delta"; partial_json: string }
  | { type: "citations_delta"; citation: JsonObject };

interface NativeUsage {
  input_tokens: number; output_tokens: number;
  cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
}
interface CapturedResponse { message: AnthropicMessage; complete: boolean; streamError?: string }

// src/claude-code-admission.ts  [proposed]
interface RelaySnapshot {
  used: boolean;                                  // the Admission happened
  denied: number;                                 // Denied Requests
  status?: number;
  requestId?: string;
  failure?: string;                               // transport failure name, never a header value
  errorText: string;                              // upstream error.message for non-200, bounded to 64 KiB
  captured?: CapturedResponse;
}

// src/claude-code-stream-json.ts  [proposed]
type CliEvent =
  | { type: "result"; subtype?: string; is_error?: boolean; num_turns?: number; usage?: NativeUsage }
  | { type: "assistant"; message: { content?: NativeBlock[] }; error?: string }   // error set by the CLI itself
  | { type: "control_response"; response: JsonObject }
  | { type: "stream_event" | "system" | "user" | string };                        // liveness only

interface CliTranscript {
  results: CliEvent[];                            // results after the Query Frame; replay acks excluded
  cliError?: { code?: string; text: string };
  exitCode: number | null;
}

// src/claude-code-turn.ts  [proposed]
type TurnOutcome =
  | { kind: "completed"; stopReason: "stop" | "length" | "toolUse"; usage: Usage; responseId?: string; responseModel?: string }
  | { kind: "failed"; failure: TurnFailure };

type TurnFailure =
  | { type: "CliMissing" }
  | { type: "ConflictingOverride"; names: string[] }
  | { type: "LoggedOut"; cliText: string }
  | { type: "InvalidRequest"; cause: TurnRequestError }
  | { type: "ReplayRejected" }
  | { type: "UpstreamRejected"; status: number; message: string }
  | { type: "IncompleteResponse"; status?: number; denied: number; failure?: string; cliText?: string }
  | { type: "UnknownTool"; name: string }
  | { type: "CliFailed"; subtype?: string; exitCode: number | null; cliText?: string }
  | { type: "InvalidCliOutput"; line: string }    // first 300 characters of the offending line
  | { type: "IdleTimeout"; ms: number }
  | { type: "Aborted" };
```

`settleTurn` keeps Hermes's rules:

- Success needs `relay.used`, status 200, a complete Captured Response, and exactly one `result` after the Query Frame.
- A Tool Boundary is `toolUse` calls plus `result.subtype === "error_max_turns"` plus exit code 1.
- A CLI error is handled, not a failure, when a Denied Request happened or the stop reason is `refusal`.
- Token usage comes from the Captured Response. pi `input` excludes cache reads and writes. Cost is 0.
- Stop reason `max_tokens` or `model_context_window_exceeded` maps to `length`.

## Error flow

```text
no `claude` on PATH or PI_CLAUDE_CODE_COMMAND
  → CliMissing → errorMessage: install hint                         → pi shows it; no retry

a Conflicting Override is set in pi's environment
  → ConflictingOverride → errorMessage names every offending variable → no retry

CLI prints assistant error "authentication_failed" and relay.used is false
  → LoggedOut → errorMessage: login hint + CLI text                 → no retry

history ends in an assistant message
  → TurnRequestError.EndsWithAssistant → InvalidRequest             → no retry

replayed user frame gets no zero-turn result
  → ReplayRejected ("history replay not supported by this CLI")     → no retry

Admission answered 400 "prompt is too long: N tokens > M maximum"
  → UpstreamRejected → "Claude API error (400): prompt is too long…"
  → pi isContextOverflow matches /prompt is too long/                → pi compacts and retries

Admission answered 429 / 529 / 5xx
  → UpstreamRejected → "Claude API error (429): …"
  → pi isRetryableAssistantError matches 429/overloaded/5xx          → pi backs off and retries   [?] usage caps

Admission stream ended early, or the relay socket failed
  → IncompleteResponse (status, capture state, relay failure, Denied Request count, CLI text)

tool_use outside the Tool Inventory
  → UnknownTool

non-JSON stdout line (shim banner, stray print)
  → InvalidCliOutput

no stdout line and no SSE chunk for idleTimeoutMs (default 180 000)
  → kill process group → IdleTimeout

options.signal aborts
  → relay.abort() + kill process group → Aborted → error event with reason "aborted"

Denied Request after a complete Captured Response
  → not a failure: normally the Tool Boundary
```

Every failure becomes an `AssistantMessage` with `stopReason: "error"` or `"aborted"` and an `errorMessage`, pushed as the stream's `error` event. Nothing throws past `streamClaudeCode`. Messages never include request headers, the relay route token, or stderr.

## Implementation outline

### Signatures

```ts
// src/index.ts
export default function claudeCodeExtension(pi: ClaudeCodeExtensionApi): void;

// src/claude-code-provider-lazy.ts / src/claude-code-provider.ts
export function streamClaudeCodeLazy(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
export function streamClaudeCode(model: Model<Api>, context: Context, options?: SimpleStreamOptions, runtime?: ClaudeCodeRuntime): AssistantMessageEventStream;

// src/claude-code-runtime.ts
export interface ClaudeCodeRuntime {
  env: NodeJS.ProcessEnv;                        // source env; Conflicting Overrides handled here
  upstream: URL;                                 // https://api.anthropic.com; tests inject a loopback fixture
  idleTimeoutMs: number;
  processDirectory: () => Promise<string>;
}
export function defaultRuntime(): ClaudeCodeRuntime;

// src/claude-code-request.ts
export function buildTurnRequest(model: Model<Api>, context: Context, options?: SimpleStreamOptions): TurnRequest;

// src/claude-code-turn.ts
export function runTurn(request: TurnRequest, runtime: ClaudeCodeRuntime, emitter: TurnEmitter, signal?: AbortSignal): Promise<TurnOutcome>;
export function settleTurn(transcript: CliTranscript, relay: RelaySnapshot, inventory: ToolInventory): TurnOutcome;

// src/claude-code-admission.ts
export class AdmissionRelay {
  static start(options: { upstream: URL; idleTimeoutMs: number; queried?: readonly NativeBlock[]; onEvent?: (event: SseEvent) => void }): Promise<AdmissionRelay>;
  readonly url: string;                          // http://127.0.0.1:<port>/admit/<token>
  snapshot(): RelaySnapshot;
  abort(): void;
  close(): Promise<void>;
}

// src/claude-code-cache-breakpoint.ts
export function pinCacheBreakpoint(payload: Buffer, queried: readonly NativeBlock[] | undefined): Buffer;

// src/claude-code-setup.ts
export function readAuthStatus(runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<AuthStatus>;
export function readPicker(runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<readonly NativePickerRow[] | undefined>;
```

### Ownership

| Module | Owns | Kind |
| --- | --- | --- |
| `claude-code-model-catalog.ts` | Pinned Catalog, Model Route, Effort mapping, Picker mapping | pure |
| `claude-code-request.ts` | History normalization, frames, Tool Inventory, extra body | pure |
| `claude-code-response-capture.ts` | SSE parsing and the Captured Response | pure |
| `claude-code-cache-breakpoint.ts` | Stable Prefix detection and the Cache Breakpoint move | pure |
| `claude-code-stream-json.ts` | stdout line parsing into `CliEvent` | pure |
| `claude-code-turn-emitter.ts` | Captured Response events into pi stream events | pure state machine |
| `claude-code-admission.ts` | Loopback server, the Admission, Denied Requests | I/O |
| `claude-code-cli.ts` | Command resolution, process env, spawn, process-group kill | I/O |
| `claude-code-turn-files.ts` | Per-Turn temp files | I/O |
| `claude-code-turn.ts` | Turn orchestration and `settleTurn` | I/O + pure |
| `claude-code-setup.ts` | Auth status and the Picker handshake | I/O |
| `claude-code-model-refresh.ts` | pi `refreshModels` with store and 24 h freshness | I/O |
| `claude-code-runtime.ts` | Runtime defaults from env | composition |
| `bin/inert-mcp.mjs` | Inert Inventory Server | standalone Node script |

### Existing code that changes

- Root `package.json`: `pi.extensions` gains `./packages/pi-claude-code/src/index.ts`. [existing*]
- Root `package-lock.json`: gains the workspace link through `npm install`.

### Deviations from Hermes

- The pi stream is driven by the Captured Response, not stdout `stream_event` lines.
- `--mcp-config` receives a file path instead of inline JSON, which keeps quoting out of the argument list.
- Host Tools whose Native Tool Name breaks Anthropic's `^[a-zA-Z0-9_-]{1,64}$` rule are left out of the Tool Inventory instead of failing the Turn.

## Resolved decisions

- **Conflicting Overrides refuse the Turn**, as in Hermes. The error names every offending variable. Users who keep `ANTHROPIC_API_KEY` for pi's built-in `anthropic` provider must unset it, or scope it to that provider, before using this one.
- **Invalid Host Tool names are skipped**, not fatal.
- **pi runs every Host Tool**: [ADR 0001](../packages/pi-claude-code/docs/adr/0001-pi-runs-every-host-tool.md).
- **One Upstream Request per Turn, with the Cache Breakpoint pin**: [ADR 0002](../packages/pi-claude-code/docs/adr/0002-admission-relay-with-cache-breakpoint-pin.md). The pin stays after the correction that Hermes's cache-read recovery came mostly from disabling the token reminder.
- **Runtime: drive the user's Claude Code CLI directly**, not the Claude Agent SDK. The comparison that decided it follows.
- **Package name: `@iurysza/pi-claude-code`**, because the package does not use the Agent SDK.
- **No CLI version check.** A CLI change that breaks the protocol surfaces as a Turn failure, such as `ReplayRejected` or `InvalidCliOutput`.

### Runtime comparison

Facts checked against `@anthropic-ai/claude-agent-sdk@0.3.282` and `@anthropic-ai/claude-code@2.1.282`:

   | | Direct CLI (this plan) | Agent SDK `query()` | Direct CLI + pinned `@anthropic-ai/claude-code` |
   | --- | --- | --- | --- |
   | Install size added | none | about 240 MB native binary per platform | about 240 MB |
   | CLI version | user's installed `claude`, which auto-updates | pinned by the SDK | pinned |
   | History Replay of assistant messages | stdin frames, as Hermes qualified | input type is `SDKUserMessage` only [?] | stdin frames |
   | Replayed user frames (`shouldQuery: false`) | yes | yes, typed | yes |
   | Inert Inventory Server | `bin/inert-mcp.mjs` subprocess | in-process `createSdkMcpServer` | subprocess |
   | Process-group kill, exact flags, relay env | full control | through `spawnClaudeCodeProcess`, `extraArgs`, `env` | full control |
   | License of the dependency | none | Anthropic Commercial Terms | Anthropic Commercial Terms |

   Anthropic's Agent SDK overview says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK." Its branding guidance also rules out calling an SDK-built product "Claude Code". Every option here routes the user's own subscription through pi, so the README must state that plainly whichever runtime is chosen.

## Unresolved questions

1. **Home repository.** Proposed: a new private repository installed with `pi install git:git@github.com:iurysza/pi-claude-code`, instead of this public monorepo. The layout would match `packages/pi-claude-code`, so a later `git subtree add` can bring it back with history.
2. **Usage caps.** pi retries 429 responses automatically. A five-hour or weekly subscription cap will not clear during pi's backoff, but the exact upstream wording for caps is not known, so the provider cannot tell a cap from a short rate limit yet. Default: leave retries to pi.
3. **Same model through pi's `anthropic` provider.** An assistant message from `anthropic/claude-sonnet-5` is a Foreign Message here, so its Signed Thinking replays as text. This is safe but loses thinking continuity after a provider switch. Default: keep it Foreign.
