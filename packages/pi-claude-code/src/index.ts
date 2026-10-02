import type { ExtensionAPI, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { stopActiveTurns } from "./claude-code-active-turns.js";
import {
	CLAUDE_CODE_API,
	CLAUDE_CODE_BASE_URL,
	CLAUDE_CODE_PROVIDER_ID,
	pinnedCatalog,
	toProviderModelConfig,
} from "./claude-code-model-catalog.js";
import { refreshClaudeCodeModelsLazy, requestForcedRefresh, streamClaudeCodeLazy } from "./claude-code-provider-lazy.js";

/** pi requires an auth method for a provider with models; the CLI owns the real login. */
export const CLAUDE_CODE_API_KEY_PLACEHOLDER = "claude-code-cli-login";

export type ClaudeCodeExtensionApi = Pick<ExtensionAPI, "registerProvider" | "registerCommand" | "on">;

export function createClaudeCodeProviderConfig(): ProviderConfig {
	return {
		name: "Claude Code",
		baseUrl: CLAUDE_CODE_BASE_URL,
		apiKey: CLAUDE_CODE_API_KEY_PLACEHOLDER,
		api: CLAUDE_CODE_API,
		models: pinnedCatalog().map(toProviderModelConfig),
		streamSimple: streamClaudeCodeLazy,
		refreshModels: refreshClaudeCodeModelsLazy,
	};
}

export default function claudeCodeExtension(pi: ClaudeCodeExtensionApi): void {
	pi.registerProvider(CLAUDE_CODE_PROVIDER_ID, createClaudeCodeProviderConfig());

	pi.registerCommand("claude-code-status", {
		description: "Show the Claude Code CLI, its login, and the last claude-code turn",
		handler: async (_args, ctx) => {
			const { claudeCodeStatus } = await import("./claude-code-status.js");
			const text = await claudeCodeStatus();
			if (ctx.hasUI) ctx.ui.notify(text, "info");
		},
	});

	pi.registerCommand("claude-code-refresh-models", {
		description: "Reload the Claude Code model list from your account",
		handler: async (_args, ctx) => {
			requestForcedRefresh();
			await ctx.modelRegistry.refresh();
			const count = ctx.modelRegistry.getAll().filter((model) => model.provider === CLAUDE_CODE_PROVIDER_ID).length;
			if (ctx.hasUI) ctx.ui.notify(`Claude Code models refreshed: ${count} model${count === 1 ? "" : "s"}.`, "info");
		},
	});

	pi.on("session_shutdown", () => {
		stopActiveTurns();
	});
}
