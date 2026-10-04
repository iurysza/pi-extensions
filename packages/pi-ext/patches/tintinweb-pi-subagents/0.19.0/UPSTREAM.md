# Upstream suggestion

Both tools return `textResult(msg)` with no `details`, so a renderer can only parse the text header.
Proposal for `@tintinweb/pi-subagents`:

1. Return structured `details` from `get_subagent_result` and `steer_subagent`, for example
   `{ kind: "result" | "steered" | "queued" | "not_running" | "not_found" | "failed", agentId, status,
   type, description, toolUses, tokens, contextPercent, duration }`. `details` is never sent to the model,
   so model-facing text stays identical.
2. Ship `renderCall`/`renderResult` for both, built on those fields instead of regexes.
3. Keep the text header stable meanwhile; the patch's fallback parser depends on its shape.

This patch already adds the `kind/agentId/status/type` subset. No upstream PR has been opened.
