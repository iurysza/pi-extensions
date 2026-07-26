import { describe, expect, it, vi } from "vitest";
import { registerCursorModelLifecycle } from "../src/cursor-model-lifecycle.js";
import { createHarnessEventApi } from "./helpers/event-harness.js";
import { makeModel } from "./helpers/model-fixtures.js";

describe("registerCursorModelLifecycle", () => {
	it("runs one sync handler for effective model lifecycle phases", async () => {
		const events = createHarnessEventApi();
		const sync = vi.fn();
		registerCursorModelLifecycle(events, sync);

		const sessionModel = makeModel("session-model");
		const selectedModel = makeModel("selected-model");
		await events.runSessionStart({ model: sessionModel });
		await events.invokeEvent(
			"model_select",
			{ type: "model_select", model: selectedModel, previousModel: sessionModel, source: "set" },
			{ model: sessionModel },
		);
		await events.runTurnStart({ model: selectedModel });
		await events.runBeforeAgentStart({ model: selectedModel });

		expect(sync).toHaveBeenCalledTimes(4);
		expect(sync.mock.calls.map(([ctx]) => ctx.model?.id)).toEqual([
			"session-model",
			"selected-model",
			"selected-model",
			"selected-model",
		]);
	});

	it("runs phase-specific session and before-agent handlers through the same registration", async () => {
		const events = createHarnessEventApi();
		const calls: string[] = [];
		registerCursorModelLifecycle(events, {
			sessionStart: (_event, ctx) => {
				calls.push(`session:${ctx.model?.id}`);
			},
			sync: (ctx) => {
				calls.push(`sync:${ctx.model?.id}`);
			},
			beforeAgentStart: (event, ctx) => {
				calls.push(`before:${ctx.model?.id}:${event.systemPrompt}`);
				return { systemPrompt: `${event.systemPrompt} updated` };
			},
		});

		const model = makeModel("cursor-model");
		await events.runSessionStart({ model });
		const result = await events.runBeforeAgentStart({ model });

		expect(calls).toEqual([
			"session:cursor-model",
			"sync:cursor-model",
			"sync:cursor-model",
			"before:cursor-model:",
		]);
		expect(result).toEqual({ systemPrompt: " updated" });
	});

	it("runs explicit model-select and turn-start handlers without raw event hooks", async () => {
		const events = createHarnessEventApi();
		const calls: string[] = [];
		registerCursorModelLifecycle(events, {
			modelSelect: (_event, ctx) => {
				calls.push(`select:${ctx.model?.id}`);
			},
			turnStart: (_event, ctx) => {
				calls.push(`turn:${ctx.model?.id}`);
			},
			beforeAgentStart: (event, ctx) => {
				calls.push(`before:${ctx.model?.id}`);
				return { systemPrompt: event.systemPrompt };
			},
		});

		const sessionModel = makeModel("session-model");
		const selectedModel = makeModel("selected-model");
		await events.invokeEvent(
			"model_select",
			{ type: "model_select", model: selectedModel, previousModel: sessionModel, source: "set" },
			{ model: sessionModel },
		);
		await events.runTurnStart({ model: selectedModel });
		await events.runBeforeAgentStart({ model: selectedModel });

		expect(calls).toEqual(["select:selected-model", "turn:selected-model", "before:selected-model"]);
	});
});
