// Generated from Cursor SDK checkpoint tokenDetails.maxTokens on 2026-05-18.
// Refresh with: npm run refresh:cursor-snapshots -- --write --context-windows ~/.pi/agent/cursor-sdk-context-windows.json
// These are default/non-Max-mode SDK context windows for Cursor models that do not
// expose a catalog `context` parameter. Do not replace them with Max Mode values
// unless the Cursor SDK exposes an exact Max Mode model selection and the extension
// uses that selection for matching pi model IDs.
export const BUNDLED_CONTEXT_WINDOWS = {
	"default": 200000,
	"claude-haiku-4-5": 200000,
	"claude-opus-4-5": 200000,
	"composer-1.5": 200000,
	"composer-2": 200000,
	"composer-2.5": 200000,
	"gemini-2.5-flash": 200000,
	"gemini-3-flash": 200000,
	"gemini-3.1-pro": 200000,
	"gpt-5-mini": 272000,
	"gpt-5.1": 272000,
	"gpt-5.1-codex-max": 272000,
	"gpt-5.1-codex-mini": 272000,
	"gpt-5.2": 272000,
	"gpt-5.2-codex": 272000,
	"gpt-5.3-codex": 272000,
	"gpt-5.3-codex-spark": 128000,
	"gpt-5.4-mini": 272000,
	"gpt-5.4-nano": 272000,
	"gpt-5.5@272k": 272000,
	"grok-4-20": 200000,
	"kimi-k2.5": 262000,
} as const satisfies Record<string, number>;
