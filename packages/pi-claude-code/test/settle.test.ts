import { isContextOverflow, isRetryableAssistantError, type AssistantMessage } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import { failureMessage } from "../src/claude-code-errors.js";
import { toToolInventory } from "../src/claude-code-request.js";
import { parseCliLine } from "../src/claude-code-stream-json.js";
import { settleTurn, type CliTranscript, type RelaySnapshot } from "../src/claude-code-turn-outcome.js";
import { readTool } from "./helpers.js";

const inventory = toToolInventory([readTool]);
const complete = (stopReason: string, content: any[] = [{ type: "text", text: "hi" }]) => ({ content, stopReason, usage: {}, complete: true });
const relay = (overrides: Partial<RelaySnapshot> = {}): RelaySnapshot => ({ admitted: true, denied: 0, status: 200, captured: complete("end_turn"), ...overrides });
const transcript = (overrides: Partial<CliTranscript> = {}): CliTranscript => ({
	acknowledgments: 0,
	extraResults: 0,
	exitCode: 0,
	result: { type: "result", subtype: "success", is_error: false, num_turns: 1 },
	...overrides,
});

function asMessage(errorMessage: string): AssistantMessage {
	return { role: "assistant", content: [], api: "x", provider: "claude-code", model: "m", usage: {} as any, stopReason: "error", errorMessage, timestamp: 0 };
}

describe("settleTurn", () => {
	it("completes a normal answer", () => {
		expect(settleTurn(transcript(), relay(), inventory, false)).toEqual({ kind: "completed", stopReason: "stop" });
	});

	it("treats tool_use plus error_max_turns as the Tool Boundary", () => {
		const outcome = settleTurn(
			transcript({ exitCode: 1, result: { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2 } }),
			relay({ captured: complete("tool_use", [{ type: "tool_use", id: "t", name: "mcp__pi__read", input: {} }]) }),
			inventory,
			false,
		);
		expect(outcome).toEqual({ kind: "completed", stopReason: "toolUse" });
	});

	it("fails a tool call outside the Tool Inventory", () => {
		const outcome = settleTurn(transcript(), relay({ captured: complete("tool_use", [{ type: "tool_use", id: "t", name: "mcp__pi__bash", input: {} }]) }), inventory, false);
		expect(outcome).toEqual({ kind: "failed", failure: { type: "UnknownTool", name: "mcp__pi__bash" } });
	});

	it("maps max_tokens and context exhaustion to Truncated", () => {
		expect(settleTurn(transcript(), relay({ captured: complete("max_tokens") }), inventory, false)).toEqual({ kind: "completed", stopReason: "length" });
		expect(settleTurn(transcript(), relay({ captured: complete("model_context_window_exceeded") }), inventory, false)).toEqual({ kind: "completed", stopReason: "length" });
	});

	it("accepts a CLI error caused by a Denied Request", () => {
		const outcome = settleTurn(transcript({ exitCode: 1, result: { type: "result", subtype: "success", is_error: true, num_turns: 1 } }), relay({ denied: 1 }), inventory, false);
		expect(outcome).toEqual({ kind: "completed", stopReason: "stop" });
	});

	it("reports login, upstream, incomplete, and CLI failures", () => {
		expect(settleTurn(transcript({ cliError: { code: "authentication_failed", text: "Not logged in" } }), { admitted: false, denied: 0 }, inventory, false)).toEqual({
			kind: "failed",
			failure: { type: "LoggedOut", cliText: "Not logged in" },
		});
		expect(settleTurn(transcript(), relay({ status: 429, errorText: "rate limited", captured: undefined }), inventory, false)).toMatchObject({
			failure: { type: "UpstreamRejected", status: 429, message: "rate limited" },
		});
		expect(settleTurn(transcript(), relay({ captured: { ...complete("end_turn"), complete: false } }), inventory, false)).toMatchObject({ failure: { type: "IncompleteResponse" } });
		expect(settleTurn(transcript({ result: undefined, exitCode: 2 }), { admitted: false, denied: 0 }, inventory, false)).toMatchObject({ failure: { type: "CliFailed", exitCode: 2 } });
		expect(settleTurn(transcript(), relay(), inventory, true)).toEqual({ kind: "failed", failure: { type: "Aborted" } });
	});
});

describe("failure text", () => {
	it("lets pi detect overflow and retryable errors", () => {
		const overflow = failureMessage({ type: "UpstreamRejected", status: 400, message: "prompt is too long: 1200000 tokens > 1000000 maximum" });
		expect(isContextOverflow(asMessage(overflow))).toBe(true);
		expect(isRetryableAssistantError(asMessage(failureMessage({ type: "UpstreamRejected", status: 529, message: "Overloaded" })))).toBe(true);
		expect(isRetryableAssistantError(asMessage(failureMessage({ type: "UpstreamRejected", status: 429, message: "Rate limited" })))).toBe(true);
		expect(isRetryableAssistantError(asMessage(failureMessage({ type: "LoggedOut", cliText: "Not logged in" })))).toBe(false);
	});

	it("names every conflicting override", () => {
		expect(failureMessage({ type: "ConflictingOverride", names: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK"] })).toContain("ANTHROPIC_API_KEY, CLAUDE_CODE_USE_BEDROCK are set");
	});
});

describe("parseCliLine", () => {
	it("parses events and flags non-JSON output", () => {
		expect(parseCliLine("")).toBeUndefined();
		expect(parseCliLine('{"type":"result","subtype":"success","num_turns":0}')).toEqual({ ok: true, event: { type: "result", subtype: "success", num_turns: 0 } });
		expect(parseCliLine('{"type":"stream_event"}')).toEqual({ ok: true, event: { type: "other" } });
		expect(parseCliLine("Welcome to Claude!")).toEqual({ ok: false, line: "Welcome to Claude!" });
	});
});
