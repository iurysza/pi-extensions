import { describe, expect, it } from "vitest";
import {
	buildCursorPiToolDisplayFromSpec,
	CURSOR_TOOL_DISPLAY_SPEC_KEYS,
	type ToolDisplayContext,
} from "../src/cursor-transcript-tool-specs.js";
import {
	CURSOR_KNOWN_NORMALIZED_TOOL_NAMES,
	CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
	CURSOR_TOOL_PRESENTATION_SPECS,
	classifyCursorWebToolKind,
	getCursorReplayActivityTitle,
	getCursorToolActivityTitle,
	getCursorReplayCallSummary,
	getCursorToolLifecycleLabelKind,
	getCursorToolPresentationSpec,
	getCursorToolVisibilityPolicy,
	isExcludedFromCursorBridgeExposure,
	isCursorReplayToolName,
	normalizeCursorToolName,
	type CursorNormalizedToolName,
} from "../src/cursor-tool-presentation-registry.js";
import { classifyCursorToolVisibility } from "../src/cursor-tool-visibility.js";
import { normalizeCursorToolName as normalizeToolName } from "../src/cursor-tool-presentation-registry.js";

const NEUTRAL_ACTIVITY_SOURCE_NAMES = [
	"edit",
	"write",
	"delete",
	"readLints",
	"updateTodos",
	"createPlan",
	"task",
	"generateImage",
	"mcp",
	"semSearch",
	"recordScreen",
	"webSearch",
	"webFetch",
] as const satisfies readonly CursorNormalizedToolName[];

describe("cursor tool presentation registry", () => {
	it("lists every known normalized tool exactly once", () => {
		expect(CURSOR_KNOWN_NORMALIZED_TOOL_NAMES).toHaveLength(CURSOR_TOOL_PRESENTATION_SPECS.length);
		expect(new Set(CURSOR_KNOWN_NORMALIZED_TOOL_NAMES).size).toBe(CURSOR_TOOL_PRESENTATION_SPECS.length);
	});

	it("matches transcript display spec keys exactly to registry entries", () => {
		expect(new Set(CURSOR_TOOL_DISPLAY_SPEC_KEYS)).toEqual(new Set(CURSOR_KNOWN_NORMALIZED_TOOL_NAMES));
		expect(CURSOR_TOOL_DISPLAY_SPEC_KEYS).toHaveLength(CURSOR_KNOWN_NORMALIZED_TOOL_NAMES.length);
		for (const key of CURSOR_TOOL_DISPLAY_SPEC_KEYS) {
			expect(getCursorToolPresentationSpec(key)?.normalizedName).toBe(key);
		}
	});

	it("excludes only the canonical neutral replay tool from bridge exposure", () => {
		expect(isCursorReplayToolName(CURSOR_REPLAY_ACTIVITY_TOOL_NAME)).toBe(true);
		expect(isExcludedFromCursorBridgeExposure(CURSOR_REPLAY_ACTIVITY_TOOL_NAME)).toBe(true);
		for (const toolName of ["oldCursorEdit", "oldCursorWrite", "oldCursorMcp", "oldCursorSearch"]) {
			expect(isCursorReplayToolName(toolName)).toBe(false);
			expect(isExcludedFromCursorBridgeExposure(toolName)).toBe(false);
		}
		expect(isExcludedFromCursorBridgeExposure("read")).toBe(false);
		expect(isExcludedFromCursorBridgeExposure("edit")).toBe(false);
		expect(isExcludedFromCursorBridgeExposure("write")).toBe(false);
	});

	it("derives neutral activity titles from current source tool names", () => {
		for (const normalizedName of NEUTRAL_ACTIVITY_SOURCE_NAMES) {
			expect(getCursorReplayActivityTitle(normalizedName)).toBe(getCursorToolPresentationSpec(normalizedName)?.displayLabel);
			expect(getCursorToolActivityTitle(normalizedName)).toBe(getCursorReplayActivityTitle(normalizedName));
			expect(classifyCursorToolVisibility({ name: normalizedName }).activityTitle).toBe(getCursorReplayActivityTitle(normalizedName));
		}
		expect(getCursorReplayActivityTitle("read")).toBeUndefined();
		expect(getCursorReplayActivityTitle("grep")).toBeUndefined();
		expect(getCursorReplayActivityTitle("shell")).toBeUndefined();
		expect(getCursorToolActivityTitle("read")).toBe("Cursor read");
		expect(getCursorToolActivityTitle("unknown")).toBe("Cursor tool");
		expect(getCursorToolActivityTitle("futureSemSearchWidget")).toBe("Cursor futureSemSearchWidget");
	});

	it("sanitizes and truncates fallback activity titles for unknown tools", () => {
		const longName = "x".repeat(200);
		const truncatedSegment = `${"x".repeat(119)}…`;
		expect(getCursorToolActivityTitle(longName)).toBe(`Cursor ${truncatedSegment}`);
		expect(getCursorToolActivityTitle("foo\nbar\tbaz")).toBe("Cursor foo bar baz");
	});

	it("normalizes aliases from the registry", () => {
		expect(normalizeCursorToolName("read_file")).toBe("read");
		expect(normalizeCursorToolName("run_terminal_cmd")).toBe("shell");
		expect(normalizeCursorToolName("web_search")).toBe("webSearch");
		expect(normalizeToolName("str_replace")).toBe("edit");
	});

	it("classifies web tools from current registry patterns", () => {
		expect(classifyCursorWebToolKind("web-search")).toBe("webSearch");
		expect(classifyCursorWebToolKind("WebFetch")).toBe("webFetch");
		expect(classifyCursorWebToolKind("oldCursorWebFetch")).toBeUndefined();
		expect(classifyCursorWebToolKind("grep")).toBeUndefined();
	});

	it("exposes visibility and lifecycle policy for every registry entry", () => {
		for (const spec of CURSOR_TOOL_PRESENTATION_SPECS) {
			const key = spec.normalizedName.toLowerCase();
			expect(getCursorToolVisibilityPolicy(key)).toEqual(spec.visibility);
			if ("lifecycleLabelKind" in spec && spec.lifecycleLabelKind) {
				expect(getCursorToolLifecycleLabelKind(key)).toBe(spec.lifecycleLabelKind);
			}
		}
	});

	it("derives replay call summaries from registry display policy", () => {
		expect(getCursorReplayCallSummary(CURSOR_REPLAY_ACTIVITY_TOOL_NAME, { activitySummary: "summary" })).toBe("summary");
		expect(getCursorReplayCallSummary(CURSOR_REPLAY_ACTIVITY_TOOL_NAME, { toolName: "custom" })).toBe("custom");
		expect(getCursorReplayCallSummary("semSearch", { query: "main", targetDirectories: ["src"] })).toBe("main (1 dir)");
		expect(getCursorReplayCallSummary("mcp", { toolName: "git", preview: "status" })).toBe("git · status");
	});

	it("builds transcript displays for every registry-backed spec key", () => {
		const context: ToolDisplayContext = {
			rawName: "read",
			name: "read",
			args: { path: "src/index.ts" },
			result: { status: "success", value: { content: "ok" }, error: undefined },
			options: {},
		};
		for (const key of CURSOR_TOOL_DISPLAY_SPEC_KEYS) {
			expect(() =>
				buildCursorPiToolDisplayFromSpec({
					...context,
					rawName: key,
					name: key,
				}),
			).not.toThrow();
		}
	});
});
