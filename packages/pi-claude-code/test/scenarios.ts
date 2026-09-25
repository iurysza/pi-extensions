import { readdirSync } from "node:fs";
import { expect } from "vitest";
import type { ClaudeCodeRuntime } from "../src/claude-code-runtime.js";
import { streamClaudeCode } from "../src/claude-code-provider.js";
import { sse, startFakeUpstream, type FakeUpstream, type ScriptedResponse } from "./fixtures/fake-upstream.js";
import { assistant, collect, readTool, testModel, toolCall, toolResult, user, type FakeScenario, type TestRuntime } from "./helpers.js";

/**
 * Scenarios that hold for both the fake CLI and a real Claude Code binary.
 * Assertions only look at what pi and the upstream observe, never at fake-only records.
 */
export interface Scenario {
	readonly name: string;
	readonly script: ScriptedResponse[];
	readonly loggedOut?: boolean;
	/** Honored by the fake CLI only; the real binary ignores it. */
	readonly fake?: FakeScenario;
	run(runtime: ClaudeCodeRuntime, upstream: FakeUpstream): Promise<void>;
}

export type Lane = (upstream: FakeUpstream, scenario: Scenario) => TestRuntime;

export async function runScenario(lane: Lane, scenario: Scenario): Promise<void> {
	const upstream = await startFakeUpstream(scenario.script);
	try {
		const runtime = lane(upstream, scenario);
		await scenario.run(runtime, upstream);
		expect(readdirSync(runtime.cwd)).toEqual([]);
	} finally {
		await upstream.close();
	}
}

function markers(upstream: FakeUpstream): Array<Array<[number, string]>> {
	return upstream.messages().map((request) =>
		request.body.messages.flatMap((entry: any, index: number) =>
			Array.isArray(entry.content) ? entry.content.flatMap((block: any) => (block.cache_control ? [[index, entry.role]] : [])) : [],
		),
	);
}

export const scenarios: Scenario[] = [
	{
		name: "text answer from one Admission",
		script: [sse.text("hello there")],
		async run(runtime, upstream) {
			const { events, message } = await collect(streamClaudeCode(testModel(), { systemPrompt: "You are pi.", messages: [user("hi")] }, {}, runtime));
			expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
			expect(message).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "hello there" }] });
			expect(upstream.messages()).toHaveLength(1);
			const request = upstream.messages()[0]!;
			expect(request.url).toBe("/v1/messages?beta=true");
			expect(request.headers.authorization).toMatch(/^Bearer sk-ant-oat01-/);
			expect(request.body.system.map((block: any) => block.text).join("\n")).toContain("You are pi.");
			expect(request.body.tools).toEqual([]);
		},
	},
	{
		name: "logged-out CLI never contacts Anthropic",
		script: [],
		loggedOut: true,
		fake: { loggedOut: true },
		async run(runtime, upstream) {
			const { events, message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
			expect(events.map((event) => event.type)).toEqual(["error"]);
			expect(message.errorMessage).toContain("claude auth login");
			expect(upstream.messages()).toHaveLength(0);
		},
	},
	{
		name: "Tool Boundary ends the Turn with the Host Tool name",
		script: [sse.tool("toolu_1", "mcp__pi__read", { path: "a.txt" }, "Reading.")],
		async run(runtime, upstream) {
			const { events, message } = await collect(streamClaudeCode(testModel(), { messages: [user("read a.txt")], tools: [readTool] }, {}, runtime));
			expect(events.at(-1)).toMatchObject({ type: "done", reason: "toolUse" });
			expect(message.content).toEqual([
				{ type: "text", text: "Reading." },
				{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "a.txt" } },
			]);
			expect(upstream.messages()).toHaveLength(1);
			expect(upstream.messages()[0]!.body.tools).toEqual([{ name: "mcp__pi__read", description: "Read a file", input_schema: readTool.parameters }]);
		},
	},
	{
		name: "history replays in order with the CLI's system messages",
		script: [sse.text("done")],
		fake: { ackDelayMs: 40 },
		async run(runtime, upstream) {
			const context = {
				messages: [
					user("read a.txt"),
					assistant([{ type: "text", text: "Reading." }, toolCall("toolu_1", "read", { path: "a.txt" })]),
					toolResult("toolu_1", "file body"),
					assistant([{ type: "text", text: "It says file body." }]),
					user("thanks"),
				],
				tools: [readTool],
			};
			const { message } = await collect(streamClaudeCode(testModel(), context, {}, runtime));
			expect(message.stopReason).toBe("stop");
			const sent = upstream.messages()[0]!.body.messages;
			expect(sent.map((entry: any) => entry.role)).toEqual(["user", "system", "assistant", "user", "assistant", "user", "system"]);
			expect(sent[3].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
		},
	},
	{
		name: "Signed Thinking carries into the next Turn of the same model",
		script: [sse.thinking("secret plan", "SIG_1", "first"), sse.text("second")],
		async run(runtime, upstream) {
			const model = testModel("claude-sonnet-5");
			const first = await collect(streamClaudeCode(model, { messages: [user("one")] }, { reasoning: "high" }, runtime));
			expect(first.message.content[0]).toEqual({ type: "thinking", thinking: "secret plan", thinkingSignature: "SIG_1" });
			await collect(streamClaudeCode(model, { messages: [user("one"), first.message, user("two")] }, { reasoning: "high" }, runtime));
			const replayed = upstream.messages()[1]!.body.messages.find((entry: any) => entry.role === "assistant");
			expect(replayed.content).toEqual([
				{ type: "thinking", thinking: "secret plan", signature: "SIG_1" },
				{ type: "redacted_thinking", data: "REDACTED_blob" },
				{ type: "text", text: "first" },
			]);
			expect(upstream.messages()[1]!.body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
		},
	},
	{
		name: "Cache Breakpoint is pinned onto the Query Frame",
		script: [sse.text("a"), sse.text("b")],
		async run(runtime, upstream) {
			await collect(streamClaudeCode(testModel(), { messages: [user("one")] }, {}, runtime));
			await collect(streamClaudeCode(testModel(), { messages: [user("one"), assistant([{ type: "text", text: "a" }]), user("two")] }, {}, runtime));
			expect(markers(upstream)).toEqual([[[0, "user"]], [[3, "user"]]]);
		},
	},
];
