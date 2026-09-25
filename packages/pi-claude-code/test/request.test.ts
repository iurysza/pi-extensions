import { describe, expect, it } from "vitest";
import { buildTurnRequest, nativeToolId, toToolInventory } from "../src/claude-code-request.js";
import { assistant, readTool, testModel, thinking, toolCall, toolResult, user } from "./helpers.js";

function build(messages: any[], options: { tools?: any[]; model?: string; reasoning?: any; systemPrompt?: string } = {}) {
	return buildTurnRequest(
		testModel(options.model ?? "claude-sonnet-5"),
		{ systemPrompt: options.systemPrompt ?? "You are pi.", messages, tools: options.tools },
		{ reasoning: options.reasoning },
	);
}

function request(messages: any[], options?: Parameters<typeof build>[1]) {
	const result = build(messages, options);
	if (!result.ok) throw new Error(`unexpected ${result.error.type}`);
	return result.request;
}

describe("buildTurnRequest", () => {
	it("turns a single user message into the Query Frame", () => {
		const turn = request([user("hi")]);
		expect(turn.replayed).toEqual([]);
		expect(turn.query).toEqual({ type: "user", message: { role: "user", content: [{ type: "text", text: "hi" }] } });
		expect(turn.route).toBe("claude-sonnet-5");
		expect(turn.systemPrompt).toBe("You are pi.");
		expect(turn.extraBody).toEqual({ tools: [], thinking: { type: "disabled" }, context_management: { edits: [] } });
	});

	it("rejects history that ends with an assistant message or is empty", () => {
		expect(build([user("hi"), assistant([{ type: "text", text: "hello" }])])).toMatchObject({ ok: false, error: { type: "EndsWithAssistant" } });
		expect(build([])).toMatchObject({ ok: false, error: { type: "EmptyQueryFrame" } });
		expect(build([user("")])).toMatchObject({ ok: false, error: { type: "EmptyQueryFrame" } });
	});

	it("replays same-route signed thinking with the producing model", () => {
		const turn = request([
			user("read a.txt"),
			assistant([thinking("plan", "SIG"), thinking("", "BLOB", true), toolCall("toolu_1", "read", { path: "a.txt" })], { model: "claude-opus-5-5-1m" }),
			toolResult("toolu_1", "body"),
		]);
		expect(turn.replayed[1]).toEqual({
			type: "assistant",
			message: {
				role: "assistant",
				model: "claude-opus-5-5",
				content: [
					{ type: "thinking", thinking: "plan", signature: "SIG" },
					{ type: "redacted_thinking", data: "BLOB" },
					{ type: "tool_use", id: "toolu_1", name: "mcp__pi__read", input: { path: "a.txt" } },
				],
			},
		});
		expect(turn.query.message.content).toEqual([{ type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "body" }] }]);
	});

	it("replays foreign thinking as text, drops redacted thinking, and rewrites foreign tool ids", () => {
		const foreignId = "call_abc|fc_123";
		const turn = request(
			[
				user("go"),
				assistant([thinking("foreign plan", "OTHER"), thinking("", "X", true), toolCall(foreignId, "read")], { provider: "openai", model: "gpt-5" }),
				toolResult(foreignId, "ok"),
			],
			{ model: "claude-sonnet-5" },
		);
		const replayed = turn.replayed[1]!;
		expect(replayed.message).toMatchObject({ model: "claude-sonnet-5" });
		expect(replayed.message.content[0]).toEqual({ type: "text", text: "foreign plan" });
		const id = nativeToolId(foreignId);
		expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
		expect(replayed.message.content[1]).toMatchObject({ type: "tool_use", id });
		expect(turn.query.message.content[0]).toMatchObject({ type: "tool_result", tool_use_id: id });
	});

	it("drops errored assistant messages with their tool results, and completes orphaned calls", () => {
		const turn = request([
			user("one"),
			assistant([toolCall("toolu_err", "read")], { stopReason: "error" }),
			toolResult("toolu_err", "stale"),
			user("two"),
			assistant([toolCall("toolu_a", "read"), toolCall("toolu_b", "read")]),
			toolResult("toolu_a", "a"),
			user("three"),
		]);
		expect(turn.replayed.map((frame) => frame.type)).toEqual(["user", "assistant"]);
		expect(turn.replayed[0]!.message.content).toEqual([
			{ type: "text", text: "one" },
			{ type: "text", text: "two" },
		]);
		expect(turn.query.message.content).toEqual([
			{ type: "tool_result", tool_use_id: "toolu_a", content: [{ type: "text", text: "a" }] },
			{ type: "tool_result", tool_use_id: "toolu_b", content: [{ type: "text", text: "Tool call was not completed." }], is_error: true },
			{ type: "text", text: "three" },
		]);
	});

	it("merges parallel tool results into one frame in call order and keeps images", () => {
		const turn = request([
			user("go"),
			assistant([toolCall("toolu_a", "read"), toolCall("toolu_b", "read")]),
			toolResult("toolu_a", "a", "read", true),
			{ ...toolResult("toolu_b", "b"), content: [{ type: "image", data: "AAAA", mimeType: "image/png" }] },
		]);
		expect(turn.query.message.content).toEqual([
			{ type: "tool_result", tool_use_id: "toolu_a", content: [{ type: "text", text: "a" }], is_error: true },
			{ type: "tool_result", tool_use_id: "toolu_b", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
		]);
	});

	it("advertises tools in the extra body and notes the prefix in the system prompt", () => {
		const turn = request([user("hi")], { tools: [readTool], reasoning: "high" });
		expect(turn.extraBody).toEqual({
			tools: [{ name: "mcp__pi__read", description: "Read a file", input_schema: readTool.parameters }],
			thinking: { type: "adaptive" },
			output_config: { effort: "high" },
		});
		expect(turn.systemPrompt).toContain("mcp__pi__read");
	});
});

describe("toToolInventory", () => {
	it("skips names Anthropic would reject and normalizes schemas", () => {
		const inventory = toToolInventory([
			readTool,
			{ name: "bad name!", description: "x", parameters: {} } as any,
			{ name: "x".repeat(60), description: "long", parameters: {} } as any,
			{ name: "union", description: "u", parameters: { anyOf: [{ type: "object" }], properties: { a: { type: "string" } } } } as any,
		]);
		expect(inventory.tools.map((tool) => tool.name)).toEqual(["mcp__pi__read", "mcp__pi__union"]);
		expect(inventory.skipped).toEqual(["bad name!", "x".repeat(60)]);
		expect(inventory.tools[1]!.input_schema).toEqual({ type: "object", properties: { a: { type: "string" } } });
		expect(inventory.hostNames.get("mcp__pi__union")).toBe("union");
	});
});
