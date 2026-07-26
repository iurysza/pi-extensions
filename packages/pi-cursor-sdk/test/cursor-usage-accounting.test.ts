import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { InteractionUpdateSchema, TurnEndedUpdateSchema } from "@cursor/sdk";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai/compat";
import { calculateContextTokens } from "@earendil-works/pi-coding-agent";
import {
	applyCursorApproximateUsage,
	applyCursorUsage,
	estimateCursorAssistantSessionOutputTokens,
	estimateCursorContextTotalTokens,
	isCursorSdkUsageSafeForPiMessage,
	readCursorSdkTurnUsage,
	readCursorSdkTurnUsageFromUpdate,
} from "../src/cursor-usage-accounting.js";
import { makeModel } from "./helpers/pi-harness.js";

function makeAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "cursor-sdk",
		provider: "cursor",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

describe("cursor usage accounting", () => {
	it("counts assistant session output from text, thinking, and tool calls", () => {
		const textOnly = makeAssistantMessage([{ type: "text", text: "Done." }]);
		const withThinking = makeAssistantMessage([
			{ type: "thinking", thinking: "Inspecting the repository." },
			{ type: "text", text: "Done." },
		]);
		const withToolCall = makeAssistantMessage([
			{ type: "text", text: "I will inspect it." },
			{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } },
		]);

		expect(estimateCursorAssistantSessionOutputTokens(textOnly)).toBeGreaterThan(0);
		expect(estimateCursorAssistantSessionOutputTokens(withThinking)).toBeGreaterThan(estimateCursorAssistantSessionOutputTokens(textOnly));
		expect(estimateCursorAssistantSessionOutputTokens(withToolCall)).toBeGreaterThan(estimateCursorAssistantSessionOutputTokens(textOnly));
	});

	it("applies real SDK usage when a turn reports usage within the model window", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);

		applyCursorUsage(partial, model, context, 7, {
			turn: { inputTokens: 25_432, outputTokens: 612, cacheReadTokens: 24_000, cacheWriteTokens: 123 },
		});

		expect(partial.usage.input).toBe(25_432);
		expect(partial.usage.output).toBe(612);
		expect(partial.usage.cacheRead).toBe(24_000);
		expect(partial.usage.cacheWrite).toBe(123);
		expect(partial.usage.totalTokens).toBe(25_432 + 612 + 24_000 + 123);
	});

	it("rejects SDK usage whose full SDK total would exceed the selected model window", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);
		const overWindowUsage = {
			inputTokens: model.contextWindow - 10,
			outputTokens: 1,
			cacheReadTokens: 9,
			cacheWriteTokens: 1,
		};

		expect(isCursorSdkUsageSafeForPiMessage(overWindowUsage, model)).toBe(false);
		expect(isCursorSdkUsageSafeForPiMessage({ ...overWindowUsage, inputTokens: -1 }, model)).toBe(false);
		expect(isCursorSdkUsageSafeForPiMessage({ ...overWindowUsage, inputTokens: Number.NaN }, model)).toBe(false);

		applyCursorUsage(partial, model, context, 7, { turn: overWindowUsage });

		expect(partial.usage.input).toBe(7);
		expect(partial.usage.totalTokens).toBeLessThan(model.contextWindow);
	});

	it("rejects full-run-sized SDK usage before it can poison compaction totals", () => {
		const fixturePath = new URL("./fixtures/cursor-run-usage-compaction-poison.jsonl", import.meta.url);
		const poisonedMessage = readFileSync(fixturePath, "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line) as { message?: { usage?: { input: number; output: number; cacheRead: number; cacheWrite: number } } })
			.find((entry) => entry.message?.usage)?.message?.usage;
		expect(poisonedMessage).toMatchObject({ input: 1_125_429, cacheRead: 1_015_493 });

		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);
		const poisonedSdkUsage = {
			inputTokens: poisonedMessage!.input,
			outputTokens: poisonedMessage!.output,
			cacheReadTokens: poisonedMessage!.cacheRead,
			cacheWriteTokens: poisonedMessage!.cacheWrite,
		};

		expect(isCursorSdkUsageSafeForPiMessage(poisonedSdkUsage, model)).toBe(false);

		applyCursorUsage(partial, model, context, 7, { turn: poisonedSdkUsage });

		expect(partial.usage.cacheRead).toBe(0);
		expect(partial.usage.cacheWrite).toBe(0);
		expect(partial.usage.input).toBe(7);
		expect(partial.usage.totalTokens).toBeLessThan(model.contextWindow);
	});

	it("reads the installed Cursor SDK turn-ended usage update contract", () => {
		const update = {
			type: "turn-ended",
			usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, reasoningTokens: 5 },
		};

		expect(TurnEndedUpdateSchema.safeParse(update).success).toBe(true);
		expect(InteractionUpdateSchema.safeParse(update).success).toBe(true);
		expect(readCursorSdkTurnUsageFromUpdate(update)).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 });
		const sdkBundle = readFileSync(createRequire(import.meta.url).resolve("@cursor/sdk"), "utf8");
		expect(sdkBundle).toMatch(/totalTokens:\w\+\w\+\w\+\w/);
		expect(calculateContextTokens({
			input: 1,
			output: 2,
			cacheRead: 3,
			cacheWrite: 4,
			totalTokens: 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		})).toBe(10);
		expect(readCursorSdkTurnUsage({ inputTokens: -1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBeUndefined();
		expect(readCursorSdkTurnUsage({ inputTokens: 1, outputTokens: Number.POSITIVE_INFINITY, cacheReadTokens: 3, cacheWriteTokens: 4 })).toBeUndefined();
		expect(InteractionUpdateSchema.safeParse({
			type: "usage",
			usage: { inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8, totalTokens: 11 },
		}).success).toBe(false);
	});

	it("ignores returned RunResult usage for pi context totals when turn usage is absent", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);

		applyCursorUsage(partial, model, context, 7);

		expect(partial.usage.input).toBe(7);
		expect(partial.usage.cacheRead).toBe(0);
		expect(partial.usage.cacheWrite).toBe(0);
		expect(partial.usage.totalTokens).toBe(estimateCursorContextTotalTokens(partial, model, context));
		expect(partial.usage.totalTokens).toBeLessThan(1_125_429);
	});

	it("uses turn-ended usage when present", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([{ type: "text", text: "Hello back." }]);

		applyCursorUsage(partial, model, context, 7, {
			turn: { inputTokens: 25, outputTokens: 6, cacheReadTokens: 24, cacheWriteTokens: 1 },
		});

		expect(partial.usage).toMatchObject({ input: 25, output: 6, cacheRead: 24, cacheWrite: 1, totalTokens: 56 });
	});

	it("keeps the prompt/output estimate fallback when SDK usage is absent", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Hello", timestamp: 1 }],
		};
		const partial = makeAssistantMessage([
			{ type: "thinking", thinking: "Need a concise answer." },
			{ type: "text", text: "Hello back." },
		]);
		const sessionInputTokens = 7;

		applyCursorApproximateUsage(partial, model, context, sessionInputTokens);

		expect(partial.usage.output).toBe(estimateCursorAssistantSessionOutputTokens(partial));
		expect(partial.usage.cacheRead).toBe(0);
		expect(partial.usage.cacheWrite).toBe(0);
		expect(partial.usage.input).toBe(sessionInputTokens);
		expect(partial.usage.totalTokens).toBe(estimateCursorContextTotalTokens(partial, model, context));
		expect(partial.usage.totalTokens).toBeGreaterThan(partial.usage.input + partial.usage.output);
	});
});
