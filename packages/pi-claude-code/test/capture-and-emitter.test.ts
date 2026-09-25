import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { toToolInventory } from "../src/claude-code-request.js";
import { ResponseCapture, type SseEvent } from "../src/claude-code-response-capture.js";
import { emptyUsage, TurnEmitter } from "../src/claude-code-turn-emitter.js";
import { sse } from "./fixtures/fake-upstream.js";
import { collect, readTool } from "./helpers.js";

function encode(events: object[]): string {
	return events.map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

function output(): AssistantMessage {
	return { role: "assistant", content: [], api: "claude-code-cli", provider: "claude-code", model: "claude-sonnet-5", usage: emptyUsage(), stopReason: "stop", timestamp: 0 };
}

describe("ResponseCapture", () => {
	it("reassembles a stream split at arbitrary byte boundaries", () => {
		const events: SseEvent[] = [];
		const capture = new ResponseCapture((event) => events.push(event));
		const bytes = Buffer.from(encode(sse.thinking("plan", "SIG", "answer").events!).replace(/\n/g, "\r\n"));
		for (let offset = 0; offset < bytes.length; offset += 7) capture.feed(bytes.subarray(offset, offset + 7));
		capture.end();
		const captured = capture.snapshot();
		expect(captured.complete).toBe(true);
		expect(captured.stopReason).toBe("end_turn");
		expect(captured.content).toEqual([
			{ type: "thinking", thinking: "plan", signature: "SIG" },
			{ type: "redacted_thinking", data: "REDACTED_blob" },
			{ type: "text", text: "answer" },
		]);
		expect(captured.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
		expect(events.at(-1)?.type).toBe("message_stop");
	});

	it("is incomplete when the stream stops early or reports an error", () => {
		const cut = new ResponseCapture();
		cut.feed(encode(sse.text("partial").events!.slice(0, 3)));
		expect(cut.snapshot().complete).toBe(false);
		const failed = new ResponseCapture();
		failed.feed(encode([...sse.text("x").events!, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]));
		expect(failed.snapshot()).toMatchObject({ complete: false, streamError: "Overloaded" });
	});
});

describe("TurnEmitter", () => {
	it("streams text, thinking, and tool calls as pi events", async () => {
		const stream = createAssistantMessageEventStream();
		const message = output();
		const emitter = new TurnEmitter(stream, message, toToolInventory([readTool]));
		const capture = new ResponseCapture((event) => emitter.apply(event));
		capture.feed(encode(sse.thinking("plan", "SIG", "answer").events!));
		capture.feed(encode(sse.tool("toolu_1", "mcp__pi__read", { path: "a.txt" }).events!.slice(1)));
		emitter.finish({ kind: "completed", stopReason: "toolUse" });
		const { events, message: final } = await collect(stream);
		expect(events.map((event) => event.type)).toEqual([
			"start",
			"thinking_start",
			"thinking_delta",
			"thinking_end",
			"thinking_start",
			"thinking_end",
			"text_start",
			"text_delta",
			"text_end",
			"toolcall_start",
			"toolcall_delta",
			"toolcall_delta",
			"toolcall_end",
			"done",
		]);
		expect(final.content).toEqual([
			{ type: "thinking", thinking: "plan", thinkingSignature: "SIG" },
			{ type: "thinking", thinking: "", thinkingSignature: "REDACTED_blob", redacted: true },
			{ type: "text", text: "answer" },
			{ type: "toolCall", id: "toolu_1", name: "read", arguments: { path: "a.txt" } },
		]);
		expect(final).toMatchObject({ stopReason: "toolUse", responseId: "msg_fake", responseModel: "claude-sonnet-5" });
	});

	it("projects usage with cache reads and writes separate from input", async () => {
		const stream = createAssistantMessageEventStream();
		const emitter = new TurnEmitter(stream, output(), toToolInventory([]));
		emitter.apply({
			type: "message_start",
			message: { id: "m", usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, cache_creation: { ephemeral_1h_input_tokens: 20 } } },
		});
		emitter.apply({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } });
		emitter.finish({ kind: "completed", stopReason: "stop" });
		const { message } = await collect(stream);
		expect(message.usage).toMatchObject({ input: 3, output: 7, cacheRead: 100, cacheWrite: 20, cacheWrite1h: 20, totalTokens: 130 });
		expect(message.usage.cost.total).toBe(0);
	});

	it("ends with one error event that keeps partial content", async () => {
		const stream = createAssistantMessageEventStream();
		const emitter = new TurnEmitter(stream, output(), toToolInventory([]));
		const capture = new ResponseCapture((event) => emitter.apply(event));
		capture.feed(encode(sse.text("partial").events!.slice(0, 3)));
		emitter.finish({ kind: "failed", failure: { type: "IncompleteResponse", denied: 0 } }, "cut");
		emitter.finish({ kind: "completed", stopReason: "stop" });
		const { events, message } = await collect(stream);
		expect(events.filter((event) => event.type === "error" || event.type === "done")).toHaveLength(1);
		expect(message).toMatchObject({ stopReason: "error", errorMessage: "cut", content: [{ type: "text", text: "partial" }] });
	});
});
