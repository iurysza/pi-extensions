import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type RefreshModelsContext,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

let forceNextRefresh = false;

export function requestForcedRefresh(): void {
	forceNextRefresh = true;
}

function consumeForcedRefresh(): boolean {
	const force = forceNextRefresh;
	forceNextRefresh = false;
	return force;
}

function loadErrorMessage(model: Model<Api>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		timestamp: Date.now(),
		errorMessage: `Failed to load Claude Code provider runtime: ${error instanceof Error ? error.message : String(error)}`,
	};
}

export function streamClaudeCodeLazy(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
	const outer = createAssistantMessageEventStream();
	queueMicrotask(async () => {
		try {
			const { streamClaudeCode } = await import("./claude-code-provider.js");
			for await (const event of streamClaudeCode(model, context, options)) outer.push(event);
			outer.end();
		} catch (error) {
			const message = loadErrorMessage(model, error);
			outer.push({ type: "error", reason: "error", error: message });
			outer.end(message);
		}
	});
	return outer;
}

export async function refreshClaudeCodeModelsLazy(context: RefreshModelsContext): Promise<ProviderModelConfig[]> {
	const [{ refreshClaudeCodeModels }, { defaultRuntime }] = await Promise.all([
		import("./claude-code-model-refresh.js"),
		import("./claude-code-runtime.js"),
	]);
	return refreshClaudeCodeModels(context, defaultRuntime(), consumeForcedRefresh);
}
