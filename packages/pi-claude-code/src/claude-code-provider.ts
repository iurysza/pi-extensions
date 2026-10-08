import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
} from "@earendil-works/pi-ai/compat";
import { failureMessage } from "./claude-code-errors.js";
import { buildTurnRequest } from "./claude-code-request.js";
import { defaultRuntime, type ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { runTurn } from "./claude-code-turn.js";
import { emptyUsage, TurnEmitter } from "./claude-code-turn-emitter.js";
import type { TurnOutcome } from "./claude-code-turn-outcome.js";

function initialOutput(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

export function streamClaudeCode(
	model: Model<Api>,
	context: Context,
	options?: SimpleStreamOptions,
	runtime: ClaudeCodeRuntime = defaultRuntime(),
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();
	const output = initialOutput(model);
	void (async () => {
		const built = buildTurnRequest(model, context, options);
		const emitter = new TurnEmitter(stream, output, built.ok ? built.request.inventory : built.inventory);
		if (!built.ok) {
			const outcome: TurnOutcome = { kind: "failed", failure: { type: "InvalidRequest", cause: built.error } };
			emitter.finish(outcome, failureMessage(outcome.failure));
			return;
		}
		let outcome: TurnOutcome;
		try {
			outcome = (await runTurn(built.request, runtime, emitter, options?.signal)).outcome;
		} catch (error) {
			outcome = {
				kind: "failed",
				failure: { type: "CliFailed", exitCode: null, cliText: error instanceof Error ? error.message : String(error) },
			};
		}
		emitter.finish(outcome, outcome.kind === "failed" ? failureMessage(outcome.failure) : undefined);
	})();
	return stream;
}
