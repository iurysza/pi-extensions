import { describe, it, expect, beforeEach } from "vitest";
import type { Context } from "@earendil-works/pi-ai";
import { __testUtils as nativeToolDisplayTestUtils } from "../src/cursor-native-tool-display-state.js";
import { toCursorContext } from "../src/cursor-context-adapter.js";
import { contextForbidsTools } from "../src/cursor-context-tools.js";
import {
	isNativeToolActiveInContext,
	partitionNativeToolsByActiveContext,
	resolveCursorShellProgressMode,
	resolveNativeReplayDisposition,
} from "../src/cursor-native-replay-routing.js";

describe("cursor-native-replay-routing", () => {
	beforeEach(() => {
		nativeToolDisplayTestUtils.reset();
		nativeToolDisplayTestUtils.registerNativeToolNameForTests("grep");
		nativeToolDisplayTestUtils.registerNativeToolNameForTests("bash");
	});
	it("queues replay when tool is active in context and live run exists", () => {
		expect(
			resolveNativeReplayDisposition({
				toolName: "grep",
				useNativeToolReplay: true,
				activeToolNames: new Set(["grep", "read"]),
				hasLiveRun: true,
			}),
		).toBe("queue_replay");
	});

	it("returns inactive_trace when tool is missing from context snapshot", () => {
		expect(
			resolveNativeReplayDisposition({
				toolName: "grep",
				useNativeToolReplay: true,
				activeToolNames: new Set(["read"]),
				hasLiveRun: true,
			}),
		).toBe("inactive_trace");
	});

	it("returns transcript_trace when native replay is disabled", () => {
		expect(
			resolveNativeReplayDisposition({
				toolName: "grep",
				useNativeToolReplay: false,
				activeToolNames: new Set(["grep"]),
				hasLiveRun: true,
			}),
		).toBe("transcript_trace");
	});

	it("uses card-only shell progress when bash replay will be queued", () => {
		expect(
			resolveCursorShellProgressMode({
				useNativeToolReplay: true,
				activeToolNames: new Set(["bash"]),
				hasLiveRun: true,
			}),
		).toBe("card-only");
	});

	it.each([
		["native replay is disabled", false, new Set(["bash"]), true],
		["bash is inactive", true, new Set(["read"]), true],
		["there is no live run", true, new Set(["bash"]), false],
	] as const)("uses transcript shell progress when %s", (_label, useNativeToolReplay, activeToolNames, hasLiveRun) => {
		expect(resolveCursorShellProgressMode({ useNativeToolReplay, activeToolNames, hasLiveRun })).toBe("transcript");
	});

	it("uses transcript shell progress when bash has no native renderer", () => {
		nativeToolDisplayTestUtils.reset();
		nativeToolDisplayTestUtils.registerNativeToolNameForTests("grep");

		expect(
			resolveCursorShellProgressMode({
				useNativeToolReplay: true,
				activeToolNames: new Set(["bash"]),
				hasLiveRun: true,
			}),
		).toBe("transcript");
	});

	it("treats undefined activeToolNames as all tools active", () => {
		expect(isNativeToolActiveInContext("grep", undefined)).toBe(true);
	});

	it("partitions native tools by context.tools snapshot", () => {
		const context = {
			systemPrompt: "",
			messages: [],
			tools: [{ name: "read", description: "read", parameters: {} }],
		} as unknown as Context;
		const { active, inactive } = partitionNativeToolsByActiveContext(context, [
			{ toolName: "read", id: "1" },
			{ toolName: "grep", id: "2" },
		]);
		expect(active.map((t) => t.toolName)).toEqual(["read"]);
		expect(inactive.map((t) => t.toolName)).toEqual(["grep"]);
	});

	it("forbids tools only when the request states an empty tool list", () => {
		const base = { systemPrompt: "", messages: [] };
		expect(contextForbidsTools({ ...base, tools: [] } as unknown as Context)).toBe(true);
		expect(contextForbidsTools(base as unknown as Context)).toBe(false);
		expect(
			contextForbidsTools({ ...base, tools: [{ name: "read", description: "read", parameters: {} }] } as unknown as Context),
		).toBe(false);
	});

	it("keeps the empty tool list of a pi summary transcript", () => {
		const context = toCursorContext({
			messages: [
				{ role: "system", content: "Summarize.", timestamp: 1 },
				{ role: "user", content: [{ type: "text", text: "<conversation/>" }], timestamp: 2 },
			],
		} as unknown as Parameters<typeof toCursorContext>[0]);
		expect(context.tools).toEqual([]);
		expect(contextForbidsTools(context)).toBe(true);
	});
});
