# Claude Code provider: technical specification

Status: accepted. D1 (extra body only), D2 (separate `-1m` models), and D3 (this monorepo) are decided; see [Risks and Open Questions](#risks-and-open-questions). Where this spec and the [type breakdown](../plans/2026-09-25-claude-code-provider-type-breakdown.md) disagree, this spec wins. Terms follow [the context glossary](../packages/pi-claude-code/CONTEXT.md).

## Summary

`@iurysza/pi-claude-code` registers a pi provider, `claude-code`, that answers each Turn by starting the user's own Claude Code CLI once, with `--max-turns 1`, against the user's Claude Pro or Max login. pi keeps the Agent Loop, runs every Host Tool, and owns the session. Each Turn:

1. rebuilds pi's conversation as Claude Code `stream-json` input (History Replay);
2. points the CLI at a loopback Admission Relay that forwards exactly one Messages request to Anthropic, moves the Cache Breakpoint onto the Stable Prefix, and captures the streamed answer;
3. streams the Captured Response to pi and ends as Completed, Tool Boundary, Truncated, Failed, or Aborted.

The design ports Hermes DirectSDK (`hermes-plugin-claude-subscription-directsdk` at `602393b`). The CLI facts it relies on were re-checked against Claude Code 2.1.282, which changed some of them; see [CLI behavior verified on 2.1.282](#cli-behavior-verified-on-21282).

## Current State

### Repository

- `packages/pi-cursor-sdk` is the pattern for a pi provider package: `src/index.ts` registers the provider and commands, `cursor-provider-lazy.ts` defers the runtime import, and `streamSimple` returns an `AssistantMessageEventStream` that never throws.
- The provider's domain docs are committed: [context glossary](../packages/pi-claude-code/CONTEXT.md), [ADR 0001](../packages/pi-claude-code/docs/adr/0001-pi-runs-every-host-tool.md) (pi runs every Host Tool), [ADR 0002](../packages/pi-claude-code/docs/adr/0002-admission-relay-with-cache-breakpoint-pin.md) (Admission Relay and Cache Breakpoint pin), and the type breakdown.
- `packages/pi-claude-code` implements this spec. The fake lane and the contract lane (real CLI 2.1.282) both pass every shared scenario.

### pi contracts in use (0.80.x)

- `pi.registerProvider(id, ProviderConfig)` with `streamSimple(model, context, options) => AssistantMessageEventStream` and `refreshModels(RefreshModelsContext) => Promise<ProviderModelConfig[]>`.
- A provider with models needs `apiKey` or `oauth`, or pi's provider composer throws `no authentication method configured`. This provider passes a non-secret placeholder.
- `AssistantMessage.content` is `TextContent | ThinkingContent | ToolCall`. `ThinkingContent` carries `thinkingSignature` and `redacted`. Redacted thinking stores its opaque payload in `thinkingSignature`.
- Stream events: `start`, `text_start|delta|end`, `thinking_start|delta|end`, `toolcall_start|delta|end`, `done`, `error`.
- `Usage` has `input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h?`, `totalTokens`, and `cost`.
- `parseStreamingJson` is exported from `@earendil-works/pi-ai/compat`.
- pi detects context overflow from `/prompt is too long/` in `errorMessage` and compacts, then retries. It retries messages matching 429, overloaded, or 5xx.

### CLI behavior verified on 2.1.282

Probes ran the real `claude` 2.1.282 binary (`@anthropic-ai/claude-code-linux-x64`) against a loopback fake Anthropic server, first logged out and then with a dummy `CLAUDE_CODE_OAUTH_TOKEN`. The CLI sent its full Messages request to the fake server with the dummy token, so these facts are testable without an account.

| Fact | Observed | Consequence |
| --- | --- | --- |
| Flags | The argument list under [Boundaries](#claude-code-cli-adapter) is accepted. `--max-turns` and `--system-prompt-file` work but are hidden from `--help`. | Use the list as is. |
| Preflight | `HEAD <base>/api/hello` before anything else, also when logged out. | The relay answers it locally. |
| Logged out | stdout `assistant` event with `error: "authentication_failed"` and text `Not logged in · Please run /login`, then a `result` with `is_error: true`; exit 1. No Messages request. | `LoggedOut` needs no relay traffic. |
| `claude auth status` | JSON `{ loggedIn, authMethod, apiProvider, … }`; exit 1 when logged out. | Offline login check. |
| Request | `POST <base>/v1/messages?beta=true`, `user-agent: claude-cli/2.1.282 (external, sdk-cli)`, system blocks start with `x-anthropic-billing-header: cc_version=…; cc_entrypoint=sdk-cli;` and `You are a Claude agent, built on Anthropic's Claude Agent SDK.` | Anthropic sees this traffic as Agent SDK traffic whether or not the npm SDK is used. See R1. |
| Extra body | `CLAUDE_CODE_EXTRA_BODY` in the `--settings` file's `env` replaces `tools`, `thinking`, and `output_config` in the request body. The request's `tools` equals the extra body's list exactly, with or without an MCP server. | The Tool Inventory can travel in the extra body alone (D1). |
| Tool call | Model returns `tool_use` for `mcp__pi__read`. Without any MCP server, the CLI writes a local `No such tool available` result. With an inert MCP server, `dontAsk` denies it before `tools/call`. Both end with `result.subtype: "error_max_turns"`, `stop_reason: "tool_use"`, exit 1, and exactly one Messages request. | The Inert Inventory Server never runs a call; it only adds the tool to the CLI's own list (D1). |
| Replayed user frame | `shouldQuery: false` yields one `result` with `num_turns: 0`, `is_error: false`. Consecutive user messages merge into one, with `\n` appended to the earlier text. | Replay Acknowledgment. |
| Replay ordering | Writing every frame at once reorders history: an assistant frame lands before the preceding un-acknowledged user frame. Waiting for each user frame's acknowledgment before writing the next frame keeps order. Assistant frames get no acknowledgment. | Replay is sequential. |
| Signed Thinking | The CLI keeps `thinking` and `redacted_thinking` blocks in a replayed assistant frame only when `message.model` names the current model; the `[1m]` suffix is ignored. Without `model`, or with another model, it drops them. | Assistant frames carry the producing model. |
| Messages layout | The CLI inserts `role: "system"` messages: an environment reminder (working directory, platform, model identity) after the first user message, and a date reminder at the end. The only message-level `cache_control` sits on the trailing date reminder. | The Cache Breakpoint pin targets this layout. |
| Working directory | The environment reminder contains the CLI's working directory. The CLI wrote nothing into it. | A fixed, empty Process Directory keeps the prefix stable across Turns and restarts. |
| `initialize` handshake | Answers offline with `models[]`: `{ value, resolvedModel, displayName, description, supportsEffort?, supportedEffortLevels?, supportsAdaptiveThinking? }`. Logged out, it returns a generic list. | Picker source for model refresh. |
| Long context billing | With the dummy token, the `opus[1m]` row reads `Opus 5.5 with 1M context · Draws from usage credits · $4/$20 per Mtok`. `sonnet[1m]` carries no such note. | The 1M route can cost money on a subscription (D2). |
| Model routing | `--model claude-opus-5-5[1m]` sends `model: "claude-opus-5-5"`. | The suffix selects context size inside the CLI. |

## Goals

- G1. Every Claude answer in a `claude-code` Turn is produced by the official CLI with the user's Subscription Login. The provider never reads, stores, or forwards credentials itself.
- G2. pi owns the Agent Loop and runs every Host Tool through its normal approval, rendering, and session path.
- G3. At most one Upstream Request reaches Anthropic per Turn.
- G4. Follow-up Turns reuse the prompt cache for the replayed history.
- G5. Signed Thinking survives Tool Boundaries within the same model.
- G6. The model picker reflects the account's own Picker, with capabilities, and works offline from a cache.
- G7. Failures reach pi as `error` events with actionable text. pi's own overflow compaction and retry logic keep working.
- G8. Every behavior above is covered by tests that run without a Claude account. A contract suite keeps the fake CLI honest against a real binary.

## Non-Goals

- Claude Code's built-in tools, subagents, skills, hooks, plugins, slash commands, MCP servers, `CLAUDE.md`, and session persistence.
- API-key, Bedrock, Vertex, or Foundry billing. Those belong to pi's `anthropic` provider.
- Bundling or pinning a Claude Code binary at runtime, or checking its version.
- Native Windows. Resolving `claude.cmd` shims needs its own design. `PI_CLAUDE_CODE_COMMAND` pointing at `claude.exe` may work but is untested.
- Pricing. Cost is reported as 0; usage is subscription allowance, not dollars.
- Telling a subscription usage cap from a short rate limit (open question Q2).

## Invariants and Constraints

- I1. One Turn runs exactly one Claude Code Process and admits at most one Upstream Request. Later requests are Denied Requests and never leave the machine.
- I2. The Captured Response is the source of truth for content, stop reason, and usage. CLI stdout supplies only acknowledgments, CLI-side errors, the final `result`, and liveness.
- I3. The relay changes nothing in a request except the position of the single message-level Cache Breakpoint. A body it cannot parse is forwarded unchanged.
- I4. No log, error message, or stream event includes request headers, bodies, the relay route token, or stderr.
- I5. `streamClaudeCode` never throws. Every failure becomes an `AssistantMessage` with `stopReason: "error"` or `"aborted"`.
- I6. A Conflicting Override in pi's environment refuses the Turn before any process starts.
- I7. The Claude Code Process's working directory is the same empty directory for every Turn of every pi process on the machine.
- I8. Replayed user frames are written one at a time. Each waits for its Replay Acknowledgment before the next frame is written.
- I9. Assistant frames carry `message.model` = the upstream model id that produced them. Signed Thinking is replayed only in Same-Route Messages.
- I10. A Host Tool whose Native Tool Name breaks `^[a-zA-Z0-9_-]{1,64}$` is left out of the Tool Inventory. A tool call outside the Tool Inventory fails the Turn.
- I11. Loading the extension spawns nothing and imports no runtime module. The runtime loads on the first Turn or refresh.
- I12. The package ships without dependencies beyond pi peers. Node ≥ 22.19.

## Alternatives

Four runtime topologies were compared. The sub-choices inside A follow them.

### A. One CLI process per Turn, pi runs tools, Admission Relay (recommended)

- **Types:** `TurnRequest` (frames, inventory, extra body), `RelaySnapshot`, `CliTranscript`, `TurnOutcome`, all defined below.
- **Interfaces:** `streamClaudeCode(model, context, options, runtime?)`, `runTurn(request, runtime, emitter, signal)`, and `AdmissionRelay.start(options)`.
- **Ownership:** Pure modules own the model catalog, request building, SSE capture, the cache pin, stdout parsing, the pi event emitter, and settling. I/O modules own the relay, the CLI adapter, turn files, and setup.
- **Call stack:** `streamSimple → buildTurnRequest → runTurn → (relay + spawn + replay) → settleTurn → done | error`.
- **Failure and cancellation:** Every Turn is independent. Abort kills the process group and the relay socket; no state survives.
- **Persistence:** None beyond pi's session and pi's model store. Per-Turn files are deleted when the Turn ends.
- **Testing seams:** `ClaudeCodeRuntime` injects the upstream URL, command, environment, and timeouts. A fake CLI and a fake upstream exercise the whole Turn; the same scenarios run against the real CLI.
- **Costs:** A process start per Turn (about 0.3–0.7 s observed) and a full History Replay per Turn, offset by prompt caching. Built-in Claude Code tools are unavailable.

### B. Claude Agent SDK `query()` per Turn

- **Types:** `SDKUserMessage` input only; assistant history cannot be replayed as frames, so Signed Thinking across Tool Boundaries is lost or needs `resume` with an SDK session.
- **Interfaces:** `query({ prompt: AsyncIterable<SDKUserMessage>, options })`, with the tool list from `createSdkMcpServer`.
- **Ownership:** The SDK owns spawning, flags, and process lifetime. The relay still needs `env.ANTHROPIC_BASE_URL`.
- **Call stack:** `streamSimple → query() → SDK child → relay`.
- **Failure and cancellation:** `AbortController` through the SDK; no process-group control over grandchildren.
- **Persistence:** SDK session files unless disabled.
- **Testing seams:** Mock `query()` only; the protocol stays opaque.
- **Costs:** About 240 MB native binary per platform; a CLI pinned by the SDK version; the same `sdk-cli` identification on the wire as A.

### C. Live bridge: Claude Code runs the loop and calls pi tools over MCP

- **Types:** A bridge server exposing Host Tools; pi-side tool-call events synthesized from bridge calls, as in `pi-cursor-sdk`.
- **Interfaces:** `startBridge(tools, onCall)`; the CLI runs with `--max-turns N` and a live MCP server.
- **Ownership:** Claude Code owns the Agent Loop; pi gets tool calls as side effects.
- **Call stack:** `streamSimple → CLI loop → MCP tools/call → bridge → pi tool executor → MCP result → CLI → …`.
- **Failure and cancellation:** Aborting must unwind a live tool call in both processes. Approvals need a parallel path.
- **Persistence:** The CLI session is the source of truth mid-Turn; pi reconstructs the transcript afterward.
- **Testing seams:** A bridge protocol and a CLI loop, both hard to fake.
- **Costs:** Rejected by ADR 0001. pi's permission prompts, tool rendering, and compaction leave their normal path.

### D. One long-lived CLI session per pi session

- **Types:** A `SessionProcess` keyed by pi session id; only new messages are written each Turn.
- **Interfaces:** `session.send(delta)`; `session.fork()` for pi branch navigation.
- **Ownership:** Claude Code holds a second copy of history that must track pi's.
- **Call stack:** `streamSimple → diff(pi history, CLI history) → stdin delta → relay`.
- **Failure and cancellation:** Any pi-side edit (compaction, `/tree` navigation, message edits, model switch) diverges the two histories and forces a restart with full replay anyway.
- **Persistence:** Process state outlives Turns; crash recovery needs replay.
- **Testing seams:** Diffing and divergence detection on top of everything in A.
- **Costs:** Saves process starts, but keeps two sources of truth. Hermes rejected parked native sessions for the same reason.

### Sub-choice inside A: how Claude learns the Tool Inventory

| | A1. Inert Inventory Server + extra body (Hermes) | A2. Extra body only (recommended) | A3. Relay rewrites `tools` |
| --- | --- | --- | --- |
| Upstream `tools` | extra body | extra body | relay |
| Extra process per Turn | yes, a Node MCP server | no | no |
| Tool call outcome on 2.1.282 | `dontAsk` denial, `error_max_turns` | local `No such tool`, `error_max_turns` | same as A2 |
| Keeps I3 (relay changes only the marker) | yes | yes | no |
| Files | `bin/inert-mcp.mjs`, `tools.json`, `mcp.json` | none | none |
| Risk | MCP startup latency and failure modes | a future CLI that validates tool names against its own list | same as A2, plus broken I3 |

A2 removes a component that verification showed does nothing on 2.1.282. If a later CLI rejects tool calls outside its own list, the failure is loud (`CliFailed` with the CLI's text), and A1 can return without other changes.

### Sub-choice inside A: long-context routes

| | R1. Every pinned model uses its `[1m]` route (Hermes, current scaffold) | R2. `[1m]` routes are separate pi models (recommended) |
| --- | --- | --- |
| Pi Model IDs | `claude-opus-5-5` → `claude-opus-5-5[1m]` | `claude-opus-5-5` → `claude-opus-5-5`; `claude-opus-5-5-1m` → `claude-opus-5-5[1m]` |
| Billing surprise | Opus turns may draw paid usage credits silently | The user picks the 1M model; its name carries the Picker's billing note |
| Offline catalog | 1M windows | 200K base routes only; 1M variants appear after the first Picker refresh |
| Shell quoting | n/a | `-1m` avoids `[…]`, which zsh treats as a glob in `--model claude-code/…` |

## Recommendation

Build A with A2 and R2. This keeps ADR 0001 and ADR 0002 except for one mechanism: the Tool Inventory reaches Claude through the extra body instead of the Inert Inventory Server. If D1 is approved, record that in ADR 0003 and drop the Inert Inventory Server from the glossary.

## Domain Model and Types

```ts
// claude-code-model-catalog.ts — pure
type PiModelId = string;                          // "claude-sonnet-5", "claude-sonnet-5-1m"
type ModelRoute = string;                         // "claude-sonnet-5", "claude-sonnet-5[1m]"
type UpstreamModelId = string;                    // "claude-sonnet-5"; what Anthropic sees and what frames carry
type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

interface ModelCapabilities {
  effortLevels: readonly ClaudeEffort[];          // empty: no output_config.effort
  adaptiveThinking: boolean;                      // false: never send thinking: adaptive
  thinkingDisable: boolean;                       // false for claude-fable-*: never send thinking: disabled
}

interface CatalogModel {
  id: PiModelId;
  name: string;                                   // Picker displayName plus billing note, or the pinned name
  route: ModelRoute;
  upstreamId: UpstreamModelId;
  contextWindow: number;                          // 1_000_000 for [1m] routes, else 200_000
  maxTokens: number;                              // 32_000
  capabilities: ModelCapabilities;
}

interface PickerRow {                             // parsed from the initialize control_response
  value: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  supportsAdaptiveThinking?: boolean;
}
```

Rules:

- A Picker row with no `resolvedModel` is an alias row (`default`) and is skipped.
- `resolvedModel` `X[1m]` maps to Pi Model ID `X'-1m`, where `X'` is the pinned id for `X` (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`).
- A description containing `usage credits` appends ` · usage credits` to the name.
- Capabilities come from the row when it reports them, else from the pinned table. `thinkingDisable` always comes from the pinned table.
- A model with no effort levels and no adaptive thinking (Haiku 4.5 on 2.1.282) gets `reasoning: false` (Q3).
- `thinkingLevelMap`: `off` → `"disabled"` when `thinkingDisable`, else `null`. `minimal` → `low`. Other levels map to themselves when listed in `effortLevels`, else `null`.

```ts
// claude-code-request.ts — pure
type NativeToolName = `mcp__pi__${string}`;

type NativeBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: NativeToolName; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string | Array<TextBlock | ImageBlock>; is_error?: boolean };

type UserFrame = { type: "user"; message: { role: "user"; content: NativeBlock[] } };
type AssistantFrame = { type: "assistant"; message: { role: "assistant"; model: UpstreamModelId; content: NativeBlock[] } };
type InputFrame = UserFrame | AssistantFrame;

interface ToolInventory {
  tools: ReadonlyArray<{ name: NativeToolName; description: string; input_schema: Record<string, unknown> }>;
  hostNames: ReadonlyMap<NativeToolName, string>; // Native Tool Name → Host Tool name
  skipped: readonly string[];                     // Host Tools left out by I10
}

interface ExtraBody {                             // serialized into CLAUDE_CODE_EXTRA_BODY
  tools: ToolInventory["tools"];                  // always present; [] clears the CLI's list
  thinking?: { type: "adaptive" } | { type: "disabled" };
  context_management?: { edits: [] };             // only alongside thinking: disabled
  output_config?: { effort: ClaudeEffort };
  max_tokens?: number;                            // min(options.maxTokens, model.maxTokens) when pi passes one
}

interface TurnRequest {
  model: CatalogModel;
  systemPrompt: string;                           // pi's system prompt + one Native Tool Name paragraph when tools exist
  replayed: readonly InputFrame[];
  query: UserFrame;
  inventory: ToolInventory;
  extraBody: ExtraBody;
}

type TurnRequestError =
  | { type: "EndsWithAssistant" }
  | { type: "EmptyQueryFrame" };
```

History normalization (`normalizeHistory`), in order:

1. Drop assistant messages with `stopReason` `error` or `aborted`.
2. A Same-Route Message is an assistant message with `provider === "claude-code"`. Its thinking replays as signed blocks, and its frame carries `model` = the upstream id of `message.model`. When that model differs from the current one, the CLI drops the signed blocks itself (verified).
3. In a Foreign Message, thinking becomes a `text` block; redacted thinking is dropped; tool-call ids outside `^[A-Za-z0-9_-]{1,64}$` are rewritten deterministically, and their results are remapped. The frame's `model` is the current upstream id.
4. A tool call without a result gets a synthetic `is_error` result: `Tool call was not completed.`
5. Consecutive tool results merge into one user frame in tool-call order. Text and images in a user message become `text` and `image` blocks.
6. The last message becomes the Query Frame. It must be a user or tool-result message (`EndsWithAssistant`) and must have content (`EmptyQueryFrame`).

Tool schemas: `toToolInventory` drops top-level `oneOf`, `allOf`, and `anyOf`, and forces `type: "object"`.

```ts
// claude-code-response-capture.ts — pure
type SseEvent =
  | { type: "message_start"; message: { id: string; model: string; usage: NativeUsage } }
  | { type: "content_block_start"; index: number; content_block: NativeBlock }
  | { type: "content_block_delta"; index: number; delta:
      | { type: "text_delta"; text: string }
      | { type: "thinking_delta"; thinking: string }
      | { type: "signature_delta"; signature: string }
      | { type: "input_json_delta"; partial_json: string }
      | { type: "citations_delta"; citation: unknown } }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta: { stop_reason?: string | null }; usage?: Partial<NativeUsage> }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error: { type: string; message: string } };

interface NativeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}

interface CapturedResponse {
  id?: string;
  model?: string;
  content: NativeBlock[];
  stopReason?: string;
  usage: NativeUsage;
  complete: boolean;                              // message_stop seen, stopReason set, no open block
  streamError?: string;                           // SSE `error` event message
}

// claude-code-admission.ts — I/O
interface RelaySnapshot {
  admitted: boolean;
  denied: number;
  status?: number;
  requestId?: string;                             // upstream `request-id` header value
  transportFailure?: string;                      // error name only (ECONNRESET, AbortError)
  errorText?: string;                             // upstream error.message for non-200, ≤ 64 KiB
  captured?: CapturedResponse;
}

// claude-code-stream-json.ts — pure
type CliEvent =
  | { type: "result"; subtype: string; is_error: boolean; num_turns: number; result?: string; stop_reason?: string | null }
  | { type: "assistant"; error?: string; message: { content: NativeBlock[] } }
  | { type: "control_response"; response: { subtype: string; request_id: string; response?: unknown; error?: string } }
  | { type: "other"; raw: string };               // system, user, rate_limit_event, stream_event: liveness only

type CliLine = { ok: true; event: CliEvent } | { ok: false; line: string };

interface CliTranscript {
  acknowledgments: number;
  result?: Extract<CliEvent, { type: "result" }>;    // first result after the Query Frame
  extraResults: number;
  cliError?: { code: string; text: string };          // from an assistant event with `error`
  exitCode: number | null;
}

// claude-code-turn.ts
type TurnOutcome =
  | { kind: "completed"; stopReason: "stop" | "length" | "toolUse" }
  | { kind: "failed"; failure: TurnFailure };

type TurnFailure =
  | { type: "CliMissing"; command?: string }
  | { type: "ConflictingOverride"; names: string[] }
  | { type: "InvalidRequest"; cause: TurnRequestError }
  | { type: "LoggedOut"; cliText: string }
  | { type: "ReplayRejected"; cliText?: string }
  | { type: "UpstreamRejected"; status: number; message: string }
  | { type: "IncompleteResponse"; status?: number; denied: number; transportFailure?: string; cliText?: string }
  | { type: "UnknownTool"; name: string }
  | { type: "CliFailed"; subtype?: string; exitCode: number | null; cliText?: string }
  | { type: "InvalidCliOutput"; line: string }     // first 300 characters
  | { type: "IdleTimeout"; ms: number }
  | { type: "Aborted" };
```

`settleTurn(transcript, relay, inventory)`:

| Condition, checked in order | Outcome |
| --- | --- |
| aborted | `Aborted` |
| `cliError.code === "authentication_failed"` and not `admitted` | `LoggedOut` |
| admitted, status ≠ 200 | `UpstreamRejected(status, errorText)` |
| not admitted | `CliFailed` with the CLI's text |
| `captured` incomplete, or `streamError` | `IncompleteResponse` |
| a `tool_use` name missing from `inventory.hostNames` | `UnknownTool` |
| captured `tool_use`, `result.subtype === "error_max_turns"`, exit 1 | `completed / toolUse` (Tool Boundary) |
| captured `max_tokens` or `model_context_window_exceeded` | `completed / length` (Truncated) |
| captured `end_turn`, `stop_sequence`, `pause_turn`, or `refusal`; `result.is_error` false, or a Denied Request explains it | `completed / stop` |
| anything else | `CliFailed(result.subtype, exitCode, result.result)` |

`extraResults > 0` never fails a Turn; it is counted for diagnostics.

## Interfaces and APIs

```ts
// src/index.ts
export default function claudeCodeExtension(pi: Pick<ExtensionAPI, "registerProvider" | "registerCommand" | "on">): void;

// src/claude-code-provider-lazy.ts
export function streamClaudeCodeLazy(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream;
export function refreshClaudeCodeModelsLazy(context: RefreshModelsContext): Promise<ProviderModelConfig[]>;

// src/claude-code-provider.ts
export function streamClaudeCode(model: Model<Api>, context: Context, options?: SimpleStreamOptions, runtime?: ClaudeCodeRuntime): AssistantMessageEventStream;

// src/claude-code-runtime.ts
export interface ClaudeCodeRuntime {
  env: Readonly<Record<string, string | undefined>>;
  command?: string;                               // PI_CLAUDE_CODE_COMMAND
  upstream: URL;                                  // https://api.anthropic.com
  idleTimeoutMs: number;                          // PI_CLAUDE_CODE_IDLE_TIMEOUT_MS, default 180_000
  processDirectory(): Promise<string>;            // I7
  turnDirectory(): Promise<{ path: string; dispose(): Promise<void> }>;
}
export function defaultRuntime(env?: NodeJS.ProcessEnv): ClaudeCodeRuntime;

// src/claude-code-model-catalog.ts
export function pinnedCatalog(): CatalogModel[];
export function catalogFromPicker(rows: readonly PickerRow[]): CatalogModel[];
export function catalogModel(modelId: PiModelId): CatalogModel;   // unknown ids: route = id, pinned defaults
export function toProviderModelConfig(model: CatalogModel): ProviderModelConfig;

// src/claude-code-request.ts
export function buildTurnRequest(model: CatalogModel, context: Context, options?: SimpleStreamOptions):
  { ok: true; request: TurnRequest } | { ok: false; error: TurnRequestError };

// src/claude-code-turn.ts
export function runTurn(request: TurnRequest, runtime: ClaudeCodeRuntime, sink: TurnSink, signal?: AbortSignal): Promise<TurnReport>;
// TurnReport = { outcome: TurnOutcome; relay: RelaySnapshot; transcript: CliTranscript }

// src/claude-code-turn-outcome.ts — pure
export function settleTurn(transcript: CliTranscript, relay: RelaySnapshot, inventory: ToolInventory, aborted: boolean): TurnOutcome;

// src/claude-code-turn-emitter.ts — pure state machine over the Captured Response
export interface TurnSink { apply(event: SseEvent): void }
export class TurnEmitter implements TurnSink {
  constructor(stream: AssistantMessageEventStream, output: AssistantMessage, inventory: ToolInventory);
  apply(event: SseEvent): void;
  finish(outcome: TurnOutcome, failureText?: string): void;       // pushes done or error, then ends
}

// src/claude-code-model-refresh.ts
export function refreshClaudeCodeModels(context: RefreshModelsContext, runtime?: ClaudeCodeRuntime, consumeForce?: () => boolean, now?: () => number): Promise<ProviderModelConfig[]>;
```

Registration:

```ts
pi.registerProvider("claude-code", {
  name: "Claude Code",                            // wording is Q1
  api: "claude-code-cli",
  baseUrl: "process://claude-code",
  apiKey: "claude-code-cli-login",                // placeholder; the CLI owns the login
  models: pinnedCatalog().map(toProviderModelConfig),
  streamSimple: streamClaudeCodeLazy,
  refreshModels: refreshClaudeCodeModelsLazy,
});
pi.registerCommand("claude-code-status", …);      // CLI path, version, auth status, last Turn diagnostics
pi.registerCommand("claude-code-refresh-models", …); // sets the one-shot force flag, then refreshes
pi.on("session_shutdown", …);                     // closes open relays; Process Directory is kept (I7)
```

Command output wording and layout are Q1.

## Boundaries and Adapters

### Claude Code CLI adapter

`claude-code-cli.ts` owns command resolution, the environment, spawning, and killing.

- **Resolve:** `PI_CLAUDE_CODE_COMMAND` if set, else `claude` on `PATH`. A missing or non-executable file is `CliMissing`. Nothing spawns.
- **Refuse:** If pi's environment sets any of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, or `CLAUDE_CODE_USE_FOUNDRY` to a non-empty value, the result is `ConflictingOverride` with every name.
- **Environment:** pi's environment plus:

  ```text
  ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/admit/<token>
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
  CLAUDE_CODE_MAX_RETRIES=0
  CLAUDE_CODE_TOTAL_TOKENS_REMINDER=off
  DISABLE_AUTO_COMPACT=1
  DISABLE_COMPACT=1
  ENABLE_TOOL_SEARCH=false
  ```

- **Arguments** for a Turn, with cwd = Process Directory:

  ```text
  -p --model <route>
  --input-format stream-json --output-format stream-json --verbose
  --tools ""
  --system-prompt-file <turnDir>/system.md
  --settings <turnDir>/settings.json        {"env":{"CLAUDE_CODE_EXTRA_BODY":"<ExtraBody JSON>"}}
  --setting-sources ""
  --strict-mcp-config
  --disable-slash-commands
  --max-turns 1
  --permission-mode dontAsk
  --no-session-persistence
  ```

  `--include-partial-messages` is omitted because I2 makes stdout stream events unnecessary. `--mcp-config` is omitted by A2.

- **Spawn:** `detached: true` gives the child its own process group; stdio is `pipe`. stderr is drained and discarded (I4), keeping only its byte count for diagnostics.
- **Kill:** `SIGTERM` to `-pid`, then `SIGKILL` after 2 s if the group is still alive.
- **Process Directory:** `<XDG_CACHE_HOME or ~/.cache>/pi-claude-code/cwd`, created empty with mode 0700 if missing. A non-empty directory is used as is: the CLI does not list its contents, and emptying it is out of scope.
- **Turn directory:** `mkdtemp(<os.tmpdir()>/pi-claude-code-turn-)` holding `system.md` and `settings.json`, mode 0600, deleted in `finally`.

### Admission Relay

`claude-code-admission.ts` owns the loopback server and the one Admission.

- **Listen:** `127.0.0.1:0`. The route token is 32 random bytes, base64url.
- **Routing** (only paths under `/admit/<token>`; anything else gets 404 and is never forwarded):

  | Request | Response |
  | --- | --- |
  | `HEAD /api/hello` | 200, empty, local |
  | first `POST /v1/messages[?query]` | the Admission: forwarded to `upstream/v1/messages[?query]` |
  | any later `POST /v1/messages[?query]` | 400 `{"type":"error","error":{"type":"invalid_request_error","message":"PI_MODEL_ADMISSION_CONSUMED"}}`; `denied += 1` |
  | anything else | 404 `PI_RELAY_UNSUPPORTED`, local |

- **Forwarding:** Copy method and headers except hop-by-hop headers, `host`, and `content-length`, which is recomputed. The body is `pinCacheBreakpoint(body)` (I3). The upstream response goes back to the CLI byte for byte. Each chunk also feeds `ResponseCapture` (status 200) or a bounded error buffer (other statuses). Each chunk reports activity for the idle timer.
- **Modes:** `admit: false` makes the first `POST` a Denied Request too. The Picker handshake uses that mode.
- **Close:** Destroys the upstream request and every socket.

### Cache Breakpoint pin

`pinCacheBreakpoint(body: Buffer): Buffer`, pure:

1. If the body does not parse as JSON, or `messages` is not an array, return the input bytes.
2. Find message blocks with `cache_control`. If none, return the input bytes.
3. The target is the last content block of the last message whose role is not `system`. String content becomes a one-element `text` array first.
4. Move the last message-level `cache_control` object onto the target and delete the moved one. Leave system-prompt, tool, and any other message markers alone.
5. If the target already holds the marker, return the input bytes. Otherwise return the re-serialized body.

On 2.1.282 this moves the marker from the trailing date reminder onto the Query Frame's last block. The next Turn's request contains that block unchanged at the same position, so the previous write is found.

### Picker handshake

`claude-code-setup.ts`:

- `readAuthStatus`: `claude auth status` with the adapter's environment, 10 s timeout. It parses JSON `loggedIn` and `authMethod`. Exit 1 with `loggedIn: false` is logged out, not an error.
- `readPicker`: a relay with `admit: false` and the CLI started with `-p --input-format stream-json --output-format stream-json --verbose --tools "" --setting-sources "" --strict-mcp-config --no-session-persistence`. It writes `{"type":"control_request","request_id":"pi-init","request":{"subtype":"initialize"}}`, reads until the matching `control_response`, then closes stdin and kills the group. The result is `undefined` on any denied request, timeout (15 s), non-JSON line, or error subtype.

## Call Stacks and Data Flow

### Extension load

```text
pi loads ./src/index.ts
  -> claudeCodeExtension(pi)
  -> pi.registerProvider("claude-code", { models: pinnedCatalog() … })   pure, no I/O
  -> pi.registerCommand × 2, pi.on("session_shutdown")
```

### Model refresh

```text
ModelRuntime.refresh({ allowNetwork, force?, signal? })
  -> refreshClaudeCodeModelsLazy -> import("./claude-code-model-refresh.js")
  -> store.read()
  -> return cached ?? pinned        when !allowNetwork, or cache < 24 h old and no force
  -> readAuthStatus()               not logged in: return cached ?? pinned, write nothing
  -> readPicker()                   undefined: return cached ?? pinned, write nothing
  -> catalogFromPicker(rows)
  -> store.write({ models, checkedAt: now })
  -> ProviderModelConfig[]
```

### Turn: text answer

```text
Agent Loop -> streamSimple(model, context, options)
  -> streamClaudeCodeLazy: returns stream now; imports runtime in a microtask
  -> streamClaudeCode
     -> catalogModel(model.id)
     -> buildTurnRequest                           InvalidRequest on failure
     -> runTurn(request, runtime, emitter, signal)
        -> resolveCommand / refuseOverrides        CliMissing, ConflictingOverride
        -> turnDirectory(): write system.md, settings.json
        -> AdmissionRelay.start({ upstream, onEvent: emitter.apply })
        -> spawn claude (cwd = Process Directory, env + relay URL)
        -> start idle timer: reset on stdout line or relay chunk
        -> replay: for each frame in request.replayed:
             write frame (user frames with shouldQuery: false)
             user frame: await one result { num_turns: 0, is_error: false }    else ReplayRejected
        -> write request.query; end stdin
        -> CLI  POST /admit/<t>/v1/messages?beta=true
           -> relay: pinCacheBreakpoint -> upstream
           <- SSE -> CLI and ResponseCapture
              -> emitter.apply(event) -> start, text_start, text_delta…, text_end
        -> stdout: assistant, result { subtype: success, num_turns: 1 }; exit 0
        -> settleTurn -> completed / stop
     -> emitter.finish -> done(output)
  -> finally: relay.close(), kill group if alive, dispose turn directory
```

### Turn: Tool Boundary

```text
… as above, SSE content_block_start { tool_use, name: mcp__pi__read }
  -> emitter: toolcall_start { name: "read" } -> toolcall_delta (parseStreamingJson) -> toolcall_end
CLI: local "No such tool available" result; result { subtype: error_max_turns, stop_reason: tool_use }; exit 1
  -> settleTurn -> completed / toolUse -> done(output with stopReason "toolUse")
Agent Loop runs the Host Tool, appends ToolResultMessage, calls streamSimple again
  -> next Turn replays [..., assistant(model, thinking + tool_use), user(tool_result)] and queries
```

### Turn: failures

```text
Conflicting Override    -> no spawn                       -> error "Unset ANTHROPIC_API_KEY … to use claude-code"
CLI missing             -> no spawn                       -> error with install hint and PI_CLAUDE_CODE_COMMAND
logged out              -> stdout authentication_failed, no Admission -> LoggedOut -> error with `claude auth login`
replay refused          -> ack missing or is_error        -> ReplayRejected; the query frame is never written
400 prompt too long     -> relay status 400, errorText    -> UpstreamRejected -> "Claude API error (400): prompt is too long…"
                                                          -> pi overflow detection compacts and retries
429 / 529 / 5xx         -> UpstreamRejected               -> "Claude API error (429): …" -> pi retries with backoff
stream cut              -> captured incomplete            -> IncompleteResponse
second POST             -> 400 PI_MODEL_ADMISSION_CONSUMED -> not forwarded; the Turn settles on the Captured Response
tool name not in inventory -> UnknownTool
non-JSON stdout         -> kill group                     -> InvalidCliOutput
no activity for idleTimeoutMs -> kill group               -> IdleTimeout
signal abort            -> relay.close(), kill group      -> Aborted -> error event, reason "aborted"
```

Every failure path runs `emitter.finish(outcome)`. That pushes one `error` event whose `AssistantMessage` keeps any partial content already streamed, then ends the stream.

### Usage and stop reason projection

```text
NativeUsage -> Usage
  input      = input_tokens
  output     = output_tokens
  cacheRead  = cache_read_input_tokens ?? 0
  cacheWrite = cache_creation_input_tokens ?? 0
  cacheWrite1h = cache_creation.ephemeral_1h_input_tokens
  totalTokens = input + output + cacheRead + cacheWrite
  cost = zeros

stop_reason -> pi: end_turn | stop_sequence | pause_turn | refusal -> "stop"; tool_use -> "toolUse";
                   max_tokens | model_context_window_exceeded -> "length"
redacted_thinking block -> ThinkingContent { thinking: "", thinkingSignature: data, redacted: true }
```

## Files to Add, Change, or Delete

Paths are relative to the package root, `packages/pi-claude-code/` in this monorepo (D3).

| File | Responsibility |
| --- | --- |
| **Add** `src/index.ts` | Registration, commands, shutdown handler |
| **Add** `src/claude-code-provider-lazy.ts` | Deferred imports for `streamSimple` and `refreshModels` (I11) |
| **Add** `src/claude-code-provider.ts` | `streamClaudeCode`: model lookup, request build, `runTurn`, finish |
| **Add** `src/claude-code-runtime.ts` | `ClaudeCodeRuntime` defaults, Process Directory, turn directories |
| **Add** `src/claude-code-request.ts` | History normalization, frames, Tool Inventory, extra body |
| **Add** `src/claude-code-response-capture.ts` | SSE parsing into `CapturedResponse` |
| **Add** `src/claude-code-cache-breakpoint.ts` | `pinCacheBreakpoint` |
| **Add** `src/claude-code-stream-json.ts` | stdout line parsing into `CliLine` |
| **Add** `src/claude-code-turn-emitter.ts` | `TurnEmitter`: SSE to pi events, usage and stop-reason projection, finish |
| **Add** `src/claude-code-admission.ts` | `AdmissionRelay` |
| **Add** `src/claude-code-cli.ts` | Resolve, refuse, environment, arguments, spawn, kill |
| **Add** `src/claude-code-turn.ts` | `runTurn`, replay sequencing, idle timer, cleanup |
| **Add** `src/claude-code-turn-outcome.ts` | `TurnOutcome`, `TurnFailure`, `RelaySnapshot`, `CliTranscript`, `settleTurn` |
| **Add** `src/claude-code-active-turns.ts` | Open Turns for `session_shutdown`; last-Turn diagnostics for status |
| **Add** `src/claude-code-setup.ts` | `readAuthStatus`, `readCliVersion`, `readPicker` |
| **Add** `src/claude-code-model-refresh.ts` | `refreshModels` with store and 24 h freshness |
| **Add** `src/claude-code-status.ts` | `/claude-code-status` text |
| **Add** `src/claude-code-errors.ts` | `TurnFailure` → user-facing text (Q1) |
| **Change** `src/claude-code-model-catalog.ts` | `CatalogModel`, capabilities, R2 routes, Picker mapping with billing note |
| **Add** `test/fixtures/fake-claude.mjs` | Fake CLI implementing the verified protocol, driven by a scenario file |
| **Add** `test/fixtures/fake-upstream.ts` | Loopback Messages API that records requests and plays scripted SSE |
| **Add** `test/fixtures/cli-2.1.282-request.json` | Recorded request body from the probe, for the pin |
| **Add** `test/scenarios.ts` | Shared scenario table for the fake and contract lanes |
| **Add** `test/*.test.ts` | One file per slice below |
| **Add** `test/contract/*.contract.test.ts` | Real-CLI lane; skipped unless `PI_CLAUDE_CODE_CONTRACT_CLI` is set |
| **Add** `scripts/fetch-contract-cli.mjs` | Downloads `@anthropic-ai/claude-code-<platform>@2.1.282` into `.cache/` for the contract lane |
| **Add** `scripts/live-smoke.mjs` | Manual smoke test against a real login |
| **Add** `README.md`, `CHANGELOG.md`, `.gitignore` (`.cache/`) | Package docs; README states the subscription and policy position (R1) |
| **Change** `package.json` (package) | Drop `bin` from `files` (A2); add `test:contract` |
| **Change** `ai-artifacts/packages/pi-claude-code/CONTEXT.md` | Drop Inert Inventory Server (D1); add Process Directory rule, Pi Model ID `-1m` form |
| **Add** `ai-artifacts/packages/pi-claude-code/docs/adr/0003-tool-inventory-in-extra-body.md` | Supersedes ADR 0001's inventory mechanism (D1) |
| **Change** `ai-artifacts/plans/2026-09-25-claude-code-provider-type-breakdown.md` | Point to this spec |
| **Change** root `package.json`, `package-lock.json`, `README.md` | Workspace link, catalog entry, package row |

No files are deleted. `bin/inert-mcp.mjs` from the type breakdown is not created.

## Red-Green Test Plan

Three seams:

- **Pure:** request building, capture, pin, stdout parsing, emitter, settling, and the catalog, called directly.
- **Fake lane:** `streamClaudeCode` with a runtime whose `command` is `node test/fixtures/fake-claude.mjs` and whose `upstream` is the fake server. The fake CLI follows the verified 2.1.282 behavior: preflight, acknowledgments, merged users, model-gated thinking, date reminder with marker, `error_max_turns`, and `authentication_failed`.
- **Contract lane:** the same scenario table against the real binary with `CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-contract` and the fake upstream. This lane decides whether the fake is still honest. It runs in `npm run test:contract`, not in `npm run check`.

Each slice starts with one failing test at the public seam and adds only the code that makes it pass.

1. **Text Turn.** Fake lane: a one-message context yields `start`, `text_*`, and `done` with usage; the fake upstream saw one POST. This builds the minimal request, turn files, relay forwarding and capture, emitter text, settle, provider, lazy loader, and registration.
2. **Logged out.** Fake lane: `LoggedOut` error with the login hint; the fake upstream saw zero POSTs.
3. **CLI missing and Conflicting Override.** No process spawned; the messages name the command or every variable.
4. **Tool Boundary.** Scripted `tool_use` yields `toolcall_*` with the Host Tool name and `stopReason: "toolUse"`. The upstream `tools` equals the inventory. A second test covers `UnknownTool`, and a third covers invalid names being skipped.
5. **History Replay.** Pure: normalization cases (errored assistant dropped, orphan call, foreign ids, merged tool results, images). Fake lane: upstream messages keep order. A fake CLI that answers acknowledgments late proves I8. A refused acknowledgment gives `ReplayRejected` and zero POSTs.
6. **Signed Thinking.** Turn 1 captures thinking with its signature. Turn 2 replays it and the upstream request carries it. A Foreign Message replays thinking as text. A model switch drops the signed blocks.
7. **Denied Request.** Fake CLI posts twice. The second POST gets 400 `PI_MODEL_ADMISSION_CONSUMED`, is not forwarded, and the Turn completes from the capture.
8. **Cache pin.** Pure: the recorded 2.1.282 body has its marker moved to the Query Frame's last block. Unparseable bodies, no marker, and an already-pinned target are left unchanged. Fake lane: two consecutive Turns place the marker on the same block position.
9. **Upstream failures.** 400 `prompt is too long` yields an `errorMessage` that pi's `isContextOverflow` accepts. 429 and 529 yield messages pi's retry check accepts. A cut stream yields `IncompleteResponse`.
10. **Thinking and effort.** Pure: extra body for each level × {Sonnet, Fable, Haiku}; Fable never gets `disabled`; Haiku gets neither thinking nor effort. Fake lane: the upstream body carries it.
11. **Abort and idle timeout.** A fake CLI that forks a sleeping grandchild. Abort and idle timeout both kill the whole group; the stream ends `aborted` or `error`; no process remains.
12. **Invalid stdout.** A banner line yields `InvalidCliOutput` with the line truncated.
13. **Model refresh.** Offline returns cache or pinned; a fresh cache skips spawning; force refreshes. Logged out writes nothing. Picker rows map to R2 models with the billing note and capabilities. The handshake relay sees zero forwarded requests.
14. **Commands.** Status reports path, version, and login without secrets. The refresh command forces one refresh.
15. **Contract lane.** Slices 1, 2, 4, 5, 6, and 8 against the real CLI 2.1.282, from `test/scenarios.ts`. `test/scenarios.test.ts` runs the same table on the fake CLI. Every scenario also asserts that the Process Directory stays empty (R5).
16. **Packaging.** `npm run check` passes: catalog, typecheck, tests, and packs.

## Risks and Open Questions

### Decisions

- **D1. Drop the Inert Inventory Server (A2).** Decided: [ADR 0003](../packages/pi-claude-code/docs/adr/0003-tool-inventory-in-extra-body.md). This changes the mechanism in ADR 0001, not its decision.
- **D2. Long-context routes as separate `-1m` models (R2).** Decided. Opus Turns never draw usage credits unless the user picks a `-1m` model.
- **D3. Home repository.** Decided: this monorepo, `packages/pi-claude-code`.

### Risks

- **R1. Policy.** The CLI identifies this traffic as `cc_entrypoint=sdk-cli` running the Claude Agent SDK prompt, whichever runtime is chosen. Anthropic's Agent SDK terms say third parties may not offer claude.ai login or rate limits without approval. The package runs only the user's own CLI and login on the user's machine, and the README must say so plainly. The runtime choice (A over B) rests on the technical reasons above, not on policy.
- **R2. Protocol drift.** There is no version check. Replay acknowledgments, message layout, marker placement, and extra-body override are all 2.1.282 behavior. Drift surfaces as `ReplayRejected`, `CliFailed`, or a pin no-op (cache misses, no failure). The contract lane, re-run on new CLI releases, is the early warning.
- **R3. Extra body size.** The whole Tool Inventory sits in one settings value. It is read from a file, not passed through `exec`, so the 128 KiB per-argument limit does not apply; untested beyond a few tools.
- **R4. Role `system` messages.** The pin assumes Claude Code's `role: "system"` messages hold the per-request context. If a later CLI moves the marker elsewhere, the pin leaves the body unchanged (I3) and caching degrades.
- **R5. Shared working directory.** A fixed Process Directory is shared by every pi process. It is never written to by the CLI in the probes; the contract lane asserts it stays empty.

### Open questions (defaults apply unless changed)

- **Q1. User-facing text.** Provider display name, error wording, and `/claude-code-status` layout. Default: review at the design checkpoint before slice 2.
- **Q2. Usage caps.** A five-hour or weekly cap returns 429 and pi keeps retrying. Default: leave retries to pi until the cap wording is known.
- **Q3. Haiku thinking.** The Picker reports no effort and no adaptive thinking for Haiku 4.5. Default: `reasoning: false`. Budgeted thinking (`{ type: "enabled", budget_tokens }`) is a later addition.
- **Q4. Same model through pi's `anthropic` provider.** Messages from it are Foreign, so their thinking replays as text. Default: keep Foreign.
