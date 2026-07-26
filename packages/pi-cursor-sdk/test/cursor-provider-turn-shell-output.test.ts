import { describe, expect, it } from "vitest";
import type { InteractionUpdate } from "@cursor/sdk";
import {
	CursorShellOutputTracker,
	formatCursorShellOutputProgressText,
	getCursorShellOutputDelta,
	mergeShellOutputDeltasIntoCursorToolCall,
} from "../src/cursor-provider-turn-shell-output.js";

describe("CursorShellOutputTracker", () => {
	it("buffers stdout/stderr for a single active shell call", () => {
		const tracker = new CursorShellOutputTracker();
		tracker.onShellToolStarted("shell-1");
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "line one\n" })).toEqual({
			callId: "shell-1",
			stream: "stdout",
			data: "line one\n",
		});
		expect(tracker.appendShellOutputDelta({ stream: "stderr", data: "warn\n" })).toEqual({
			callId: "shell-1",
			stream: "stderr",
			data: "warn\n",
		});

		expect(tracker.takeDeltasForCall("shell-1")).toEqual({
			stdout: ["line one\n"],
			stderr: ["warn\n"],
		});
	});

	it("bounds user-visible shell output progress per call", () => {
		const tracker = new CursorShellOutputTracker();
		tracker.onShellToolStarted("shell-1");

		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "one\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "two\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "three\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "four\n" })).toBeUndefined();
		expect(tracker.takeDeltasForCall("shell-1")?.stdout.join("")).toBe("one\ntwo\nthree\nfour\n");
	});

	it("does not count blank shell output chunks against the visible progress budget", () => {
		const tracker = new CursorShellOutputTracker();
		tracker.onShellToolStarted("shell-1");

		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "\n\n" })).toBeUndefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: " \t \n" })).toBeUndefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "one\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "two\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "three\n" })).toBeDefined();
		expect(tracker.appendShellOutputDelta({ stream: "stdout", data: "four\n" })).toBeUndefined();
		expect(tracker.takeDeltasForCall("shell-1")?.stdout.join("")).toBe("\n\n \t \none\ntwo\nthree\nfour\n");
	});

	it("drops buffered deltas when multiple shell calls overlap", () => {
		const tracker = new CursorShellOutputTracker();
		tracker.onShellToolStarted("shell-1");
		tracker.appendShellOutputDelta({ stream: "stdout", data: "first\n" });
		tracker.onShellToolStarted("shell-2");
		tracker.appendShellOutputDelta({ stream: "stdout", data: "ambiguous\n" });

		expect(tracker.takeDeltasForCall("shell-1")).toBeUndefined();
		expect(tracker.takeDeltasForCall("shell-2")).toBeUndefined();
	});
});

describe("mergeShellOutputDeltasIntoCursorToolCall", () => {
	it("fills empty completed stdout from buffered deltas", () => {
		const merged = mergeShellOutputDeltasIntoCursorToolCall(
			{
				name: "shell",
				result: { status: "success", value: { stdout: "", stderr: "", exitCode: 0 } },
			},
			{ stdout: ["delta output\n"], stderr: [] },
		);
		expect(merged).toMatchObject({
			result: { status: "success", value: { stdout: "delta output\n", stderr: "" } },
		});
	});

	it("keeps completed stdout when already present", () => {
		const toolCall = {
			name: "shell",
			result: { status: "success", value: { stdout: "completed\n", stderr: "" } },
		};
		expect(
			mergeShellOutputDeltasIntoCursorToolCall(toolCall, {
				stdout: ["delta\n"],
				stderr: [],
			}),
		).toBe(toolCall);
	});
});

describe("getCursorShellOutputDelta", () => {
	it("parses stdout shell-output-delta updates", () => {
		const update = {
			type: "shell-output-delta",
			event: { case: "stdout", value: { data: "ok\n" } },
		} as InteractionUpdate;

		expect(getCursorShellOutputDelta(update)).toEqual({ stream: "stdout", data: "ok\n" });
	});
});

describe("formatCursorShellOutputProgressText", () => {
	it("formats a compact shell output preview", () => {
		expect(formatCursorShellOutputProgressText({ callId: "shell-1", stream: "stdout", data: "\nready\n" })).toBe(
			"Cursor shell stdout: ready\n",
		);
	});

	it("scrubs API keys from shell output progress", () => {
		expect(
			formatCursorShellOutputProgressText(
				{ callId: "shell-1", stream: "stderr", data: "Bearer secret-key\n" },
				"secret-key",
			),
		).not.toContain("secret-key");
	});
});
