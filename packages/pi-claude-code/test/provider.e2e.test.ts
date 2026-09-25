import { afterEach, describe, expect, it } from "vitest";
import { ADMISSION_CONSUMED } from "../src/claude-code-admission.js";
import { streamClaudeCode } from "../src/claude-code-provider.js";
import { sse, startFakeUpstream, type FakeUpstream, type ScriptedResponse } from "./fixtures/fake-upstream.js";
import {
	assistant,
	collect,
	isAlive,
	readTool,
	testModel,
	testRuntime,
	thinking,
	toolCall,
	toolResult,
	user,
	type FakeScenario,
} from "./helpers.js";

let upstream: FakeUpstream | undefined;
afterEach(async () => {
	await upstream?.close();
	upstream = undefined;
});

async function setup(script: ScriptedResponse[] = [], scenario: FakeScenario = {}, extra: Parameters<typeof testRuntime>[0] = {}) {
	upstream = await startFakeUpstream(script);
	return testRuntime({ upstream: upstream.url, scenario, ...extra });
}

describe("claude-code turns through the fake CLI", () => {
	it("streams a text answer from one Admission", async () => {
		const runtime = await setup([sse.text("hello there")]);
		const { events, message } = await collect(streamClaudeCode(testModel(), { systemPrompt: "You are pi.", messages: [user("hi")] }, {}, runtime));
		expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
		expect(message).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "hello there" }], provider: "claude-code", model: "claude-sonnet-5" });
		expect(message.usage).toMatchObject({ input: 10, output: 5 });
		expect(upstream!.messages()).toHaveLength(1);
		const request = upstream!.messages()[0]!;
		expect(request.url).toBe("/v1/messages?beta=true");
		expect(request.headers.authorization).toBe("Bearer sk-ant-oat01-fake");
		expect(request.headers.host).toBe(upstream!.url.host);
		const start = runtime.records().find((entry) => entry.kind === "start");
		expect(start.cwd).toBe(runtime.cwd);
		expect(start.args).toEqual(expect.arrayContaining(["--max-turns", "1", "--permission-mode", "dontAsk", "--strict-mcp-config", "--no-session-persistence"]));
		expect(start.args).not.toContain("--mcp-config");
		expect(start.env).toMatchObject({ CLAUDE_CODE_MAX_RETRIES: "0", CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off", ENABLE_TOOL_SEARCH: "false" });
		expect(start.env.ANTHROPIC_BASE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/admit\/[A-Za-z0-9_-]{43}$/);
	});

	it("reports a logged-out CLI without contacting Anthropic", async () => {
		const runtime = await setup([], { loggedOut: true });
		const { events, message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(events.map((event) => event.type)).toEqual(["error"]);
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("claude auth login");
		expect(message.errorMessage).toContain("Not logged in");
		expect(upstream!.messages()).toHaveLength(0);
	});

	it("refuses before spawning when the CLI is missing or an override is set", async () => {
		const missing = await setup([], {}, { command: "/nonexistent/claude" });
		const first = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, missing));
		expect(first.message.errorMessage).toContain("not found at /nonexistent/claude");
		const overridden = testRuntime({ upstream: upstream!.url, env: { ANTHROPIC_API_KEY: "sk-ant-api", CLAUDE_CODE_USE_VERTEX: "1" } });
		const second = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, overridden));
		expect(second.message.errorMessage).toContain("ANTHROPIC_API_KEY, CLAUDE_CODE_USE_VERTEX are set");
		expect(overridden.records()).toEqual([]);
		expect(upstream!.messages()).toHaveLength(0);
	});

	it("ends at the Tool Boundary with the Host Tool name", async () => {
		const runtime = await setup([sse.tool("toolu_1", "mcp__pi__read", { path: "a.txt" }, "Reading.")]);
		const { events, message } = await collect(streamClaudeCode(testModel(), { messages: [user("read a.txt")], tools: [readTool] }, {}, runtime));
		expect(events.at(-1)).toMatchObject({ type: "done", reason: "toolUse" });
		expect(message.content).toEqual([
			{ type: "text", text: "Reading." },
			{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "a.txt" } },
		]);
		expect(upstream!.messages()[0]!.body.tools).toEqual([{ name: "mcp__pi__read", description: "Read a file", input_schema: readTool.parameters }]);
	});

	it("fails a tool call outside the Tool Inventory", async () => {
		const runtime = await setup([sse.tool("toolu_1", "mcp__pi__bash", { command: "ls" })]);
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("ls")], tools: [readTool] }, {}, runtime));
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("mcp__pi__bash");
	});

	it("replays history in order, waiting for each acknowledgment", async () => {
		const runtime = await setup([sse.text("done")], { ackDelayMs: 40 });
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
		const roles = upstream!.messages()[0]!.body.messages.map((entry: any) => entry.role);
		expect(roles).toEqual(["user", "system", "assistant", "user", "assistant", "user", "system"]);
		const frames = runtime.records().filter((entry) => entry.kind === "frame").map((entry) => entry.frame);
		expect(frames.map((frame) => [frame.type, frame.shouldQuery])).toEqual([
			["user", false],
			["assistant", undefined],
			["user", false],
			["assistant", undefined],
			["user", undefined],
		]);
	});

	it("stops before the query when the CLI rejects the replay", async () => {
		const runtime = await setup([], { rejectReplay: true });
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("one"), assistant([{ type: "text", text: "two" }]), user("three")] }, {}, runtime));
		expect(message.errorMessage).toContain("rejected the replayed conversation history");
		expect(upstream!.messages()).toHaveLength(0);
	});

	it("carries Signed Thinking into the next Turn of the same model", async () => {
		const runtime = await setup([sse.thinking("secret plan", "SIG_1", "first"), sse.text("second")]);
		const model = testModel("claude-sonnet-5");
		const first = await collect(streamClaudeCode(model, { messages: [user("one")] }, { reasoning: "high" }, runtime));
		expect(first.message.content[0]).toEqual({ type: "thinking", thinking: "secret plan", thinkingSignature: "SIG_1" });
		await collect(streamClaudeCode(model, { messages: [user("one"), first.message, user("two")] }, { reasoning: "high" }, runtime));
		const replayed = upstream!.messages()[1]!.body.messages.find((entry: any) => entry.role === "assistant");
		expect(replayed.content).toEqual([
			{ type: "thinking", thinking: "secret plan", signature: "SIG_1" },
			{ type: "redacted_thinking", data: "REDACTED_blob" },
			{ type: "text", text: "first" },
		]);
		expect(upstream!.messages()[1]!.body).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
	});

	it("does not carry Signed Thinking across models", async () => {
		const runtime = await setup([sse.text("ok")]);
		const earlier = assistant([thinking("opus plan", "SIG_OPUS"), { type: "text", text: "answer" }], { model: "claude-opus-5-5" });
		await collect(streamClaudeCode(testModel("claude-sonnet-5"), { messages: [user("one"), earlier, user("two")] }, {}, runtime));
		const replayed = upstream!.messages()[0]!.body.messages.find((entry: any) => entry.role === "assistant");
		expect(replayed.content).toEqual([{ type: "text", text: "answer" }]);
	});

	it("denies a second Upstream Request without forwarding it", async () => {
		const runtime = await setup([sse.text("only once"), sse.text("never sent")], { secondRequest: true });
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(message).toMatchObject({ stopReason: "stop", content: [{ type: "text", text: "only once" }] });
		expect(upstream!.messages()).toHaveLength(1);
		expect(runtime.records().find((entry) => entry.kind === "second-request")).toEqual({ kind: "second-request", status: 400 });
		expect(ADMISSION_CONSUMED).toBe("PI_MODEL_ADMISSION_CONSUMED");
	});

	it("pins the Cache Breakpoint onto the Query Frame", async () => {
		const runtime = await setup([sse.text("a"), sse.text("b")]);
		await collect(streamClaudeCode(testModel(), { messages: [user("one")] }, {}, runtime));
		await collect(streamClaudeCode(testModel(), { messages: [user("one"), assistant([{ type: "text", text: "a" }]), user("two")] }, {}, runtime));
		const markers = upstream!.messages().map((request) =>
			request.body.messages.flatMap((entry: any, index: number) =>
				Array.isArray(entry.content) ? entry.content.flatMap((block: any) => (block.cache_control ? [[index, entry.role, block.text]] : [])) : [],
			),
		);
		expect(markers).toEqual([[[0, "user", "one"]], [[3, "user", "two"]]]);
		const firstQuery = upstream!.messages()[0]!.body.messages[0].content[0];
		const secondPrefix = upstream!.messages()[1]!.body.messages[0].content[0];
		expect({ ...secondPrefix, cache_control: firstQuery.cache_control }).toEqual(firstQuery);
	});

	it("passes upstream errors to pi's overflow and retry handling", async () => {
		const runtime = await setup([sse.error(400, "prompt is too long: 1200000 tokens > 1000000 maximum"), sse.error(529, "Overloaded", "overloaded_error")]);
		const overflow = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(overflow.message.errorMessage).toBe("Claude API error (400): prompt is too long: 1200000 tokens > 1000000 maximum");
		const overloaded = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(overloaded.message.errorMessage).toBe("Claude API error (529): Overloaded");
	});

	it("reports a stream cut short as incomplete", async () => {
		const runtime = await setup([{ ...sse.text("partial"), cutAfter: 3 }]);
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(message.stopReason).toBe("error");
		expect(message.errorMessage).toContain("ended before it was complete");
		expect(message.content).toEqual([{ type: "text", text: "partial" }]);
	});

	it("kills the whole process group on abort", async () => {
		const runtime = await setup([], { hang: true });
		const controller = new AbortController();
		const pending = collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, { signal: controller.signal }, runtime));
		await waitFor(() => runtime.records().some((entry) => entry.kind === "grandchild"));
		const { pid } = runtime.records().find((entry) => entry.kind === "grandchild");
		controller.abort();
		const { events, message } = await pending;
		expect(events.at(-1)).toMatchObject({ type: "error", reason: "aborted" });
		expect(message.stopReason).toBe("aborted");
		await waitFor(() => !isAlive(pid));
	});

	it("stops a silent CLI after the idle timeout", async () => {
		const runtime = await setup([], { hang: true }, { idleTimeoutMs: 300 });
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(message.errorMessage).toBe("Claude Code produced no output for 0 s and was stopped.");
		const { pid } = runtime.records().find((entry) => entry.kind === "grandchild");
		await waitFor(() => !isAlive(pid));
	});

	it("rejects output that is not stream-json", async () => {
		const runtime = await setup([sse.text("never")], { banner: "Welcome to Claude Code!" });
		const { message } = await collect(streamClaudeCode(testModel(), { messages: [user("hi")] }, {}, runtime));
		expect(message.errorMessage).toBe("Claude Code printed output that is not stream-json: Welcome to Claude Code!");
	});

	it("sends thinking and effort choices in the extra body", async () => {
		const runtime = await setup([sse.text("a"), sse.text("b"), sse.text("c")]);
		await collect(streamClaudeCode(testModel("claude-sonnet-5"), { messages: [user("hi")] }, {}, runtime));
		await collect(streamClaudeCode(testModel("claude-fable-5-1"), { messages: [user("hi")] }, {}, runtime));
		await collect(streamClaudeCode(testModel("claude-sonnet-5-1m"), { messages: [user("hi")] }, { reasoning: "xhigh", maxTokens: 8000 }, runtime));
		const [off, fable, long] = upstream!.messages().map((request) => request.body);
		expect(off).toMatchObject({ thinking: { type: "disabled" }, context_management: { edits: [] } });
		expect(fable.thinking).toEqual({ type: "adaptive" });
		expect(long).toMatchObject({ model: "claude-sonnet-5", thinking: { type: "adaptive" }, output_config: { effort: "xhigh" }, max_tokens: 8000 });
		const routes = runtime.records().filter((entry) => entry.kind === "start").map((entry) => entry.args[entry.args.indexOf("--model") + 1]);
		expect(routes).toEqual(["claude-sonnet-5", "claude-fable-5-1", "claude-sonnet-5[1m]"]);
	});
});

async function waitFor(check: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("timed out waiting for condition");
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
}
