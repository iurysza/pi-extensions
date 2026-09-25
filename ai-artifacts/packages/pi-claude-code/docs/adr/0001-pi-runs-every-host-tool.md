---
status: accepted
---

# pi runs every Host Tool; each Turn ends at a Tool Boundary

Claude Code could run pi's tools inside its own loop through a live MCP bridge, the way the Cursor SDK provider does. We chose instead to run one Claude Code Process per Turn with `--max-turns 1`, show Host Tools to Claude without letting the CLI run them, and let pi execute them after the Turn ends. [ADR 0003](./0003-tool-inventory-in-extra-body.md) replaced the original inert MCP server with the extra body. This keeps pi's permission checks, tool rendering, session log, and compaction on their normal path, and it is the model Hermes DirectSDK tested.

```mermaid
sequenceDiagram
  participant Loop as Agent Loop (pi)
  participant Turn
  participant CC as Claude Code Process
  Loop->>Turn: ask for a response
  Turn->>CC: History Replay + Query Frame
  CC-->>Turn: tool_use for mcp__pi__read
  Turn-->>Loop: Tool Boundary
  Loop->>Loop: run the Host Tool
  Loop->>Turn: ask again, with the tool result
```

## Considered options

- **Live bridge, as in the Cursor SDK provider.** Rejected: tool calls would run inside a Claude Code run instead of through pi's own tool-call flow, so pi's permission prompts and tool events would need a parallel path.

## Consequences

- Every Turn replays the whole conversation and pays for a process start.
- Prompt caching is what keeps that replay affordable; see [ADR 0002](./0002-admission-relay-with-cache-breakpoint-pin.md).
- Claude Code's built-in tools, subagents, and skills are unavailable by design.
