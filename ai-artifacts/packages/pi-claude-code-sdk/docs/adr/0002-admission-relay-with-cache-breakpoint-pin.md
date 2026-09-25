---
status: accepted
---

# One Upstream Request per Turn, through an Admission Relay that pins the Cache Breakpoint

Hermes observed Claude Code sending extra Upstream Requests even with `--max-turns 1`. Each one uses subscription allowance and produces output pi never asked for. For every Turn, the Claude Code Process's Anthropic base URL points at a loopback Admission Relay. The relay forwards only the first `/v1/messages` request (the Admission), refuses every later one, and reassembles the streamed answer as the Captured Response that drives pi's stream.

The relay also moves the single Cache Breakpoint back onto the Stable Prefix. Claude Code attaches per-request context, such as today's date and an account-email reminder, to the message it answers and puts the marker on or after it. The next Turn replays that message without the context, so the marked prefix never recurs and every tool round rewrites the cache.

Hermes found two causes of poor cache reuse. The larger one was Claude Code's token-count reminder: disabling it (`CLAUDE_CODE_TOTAL_TOKENS_REMINDER=off`, which this provider also sets) took a long Sonnet 5 session from 3.66% to about 98% cache reads on follow-up requests. The marker move fixes the second cause. Hermes publishes no separate measurement for it.

```text
Claude Code Process ──POST /v1/messages──▶ Admission Relay ──first request only──▶ api.anthropic.com
                    ◀──────── SSE ───────── (captured)     ◀──────────────────────
                    ──any later request──▶ 400, nothing forwarded (Denied Request)
```

## Considered options

- **Rely on `--max-turns 1` alone.** Rejected: Hermes saw extra requests anyway.
- **Gate requests without modifying them.** Rejected: date and account annotations would keep moving the cached prefix on every tool round.

## Consequences

- The relay handles the CLI's authorization header in memory. It must never log headers, bodies, or its route token.
- The Captured Response, not the CLI's stdout, is the source of truth for content, stop reason, and token usage.
- The Cache Breakpoint only ever moves earlier. Request content is never changed, and a payload the relay cannot parse is forwarded as is.
