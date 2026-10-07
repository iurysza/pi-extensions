// Generated from Cursor SDK checkpoint tokenDetails.maxTokens on 2026-08-02.
// Refresh with: npm run refresh:cursor-snapshots -- --write --context-windows ~/.pi/agent/cursor-sdk-context-windows.json
// Keys are current selectable model IDs. Equivalent default :fast/:slow selections
// collapse to one key; stale and ambiguous aliases are omitted. Values are observed
// or conservative default/non-Max-mode limits and may override a catalog context
// label when the completed SDK checkpoint reports a different effective limit.
// Pruned to the keys reachable in the bundled fallback catalog (refreshed 2026-09-01).
export const BUNDLED_CONTEXT_WINDOWS = {
	"default": 200000,
	"claude-fable-5@300k": 300000,
	"claude-haiku-4-5": 200000,
	"composer-2.5": 200000,
	"gemini-3.1-pro": 200000,
	"glm-5.2": 200000,
	"gpt-5.3-codex": 272000,
	"gpt-5.4-mini": 272000,
	"gpt-5.4-nano": 272000,
	"gpt-5.6@1m": 272000,
	"grok-4.5": 256000,
	"grok-4.5:slow": 256000,
	"kimi-k2.7-code": 200000,
	"kimi-k3": 200000,
	"opus-4.8@300k": 300000,
} as const satisfies Record<string, number>;
