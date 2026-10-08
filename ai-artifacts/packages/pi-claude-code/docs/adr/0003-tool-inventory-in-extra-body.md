---
status: accepted
---

# The Tool Inventory travels in the extra body; no MCP server

Hermes advertised Host Tools twice: in `CLAUDE_CODE_EXTRA_BODY.tools` and through an MCP server that listed them to the Claude Code Process and refused every call. On Claude Code 2.1.282 the extra body alone decides the request's `tools`, and a tool call ends the Turn at the Tool Boundary either way: without an MCP server the CLI writes a local `No such tool available` result, with one `dontAsk` denies the call before `tools/call`. Both end with `error_max_turns` after one Upstream Request.

We advertise the Tool Inventory only in the extra body. This supersedes the inventory mechanism in [ADR 0001](./0001-pi-runs-every-host-tool.md); its decision, that pi runs every Host Tool, stands.

## Considered options

- **Keep the inert MCP server.** Rejected: an extra Node process and handshake per Turn that changes nothing on 2.1.282.
- **Let the Admission Relay write `tools`.** Rejected: the relay would change request content, which [ADR 0002](./0002-admission-relay-with-cache-breakpoint-pin.md) rules out.

## Consequences

- The CLI runs with `--strict-mcp-config` and no `--mcp-config`, so no MCP server starts.
- A future CLI that rejects tool calls missing from its own list fails the Turn loudly with its own text. Restoring the inert server would then be a local change to the CLI adapter.
