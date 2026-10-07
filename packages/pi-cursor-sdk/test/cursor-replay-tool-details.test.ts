import { describe, expect, it } from "vitest";
import { buildCursorPiToolDisplayFromSpec } from "../src/cursor-transcript-tool-specs.js";
import {
	CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE,
	parseCursorReplayToolDetails,
} from "../src/cursor-replay-tool-details.js";

describe("cursor replay tool details contract", () => {
	it("parses known nativeEdit, nativeWrite, activity, generateImage, and genericFallback detail variants", () => {
		const edit = parseCursorReplayToolDetails({
			variant: "nativeEdit",
			path: "src/a.ts",
			diffString: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
			linesAdded: 1,
		});
		const write = parseCursorReplayToolDetails({
			variant: "nativeWrite",
			path: "out.txt",
			linesCreated: 3,
		});
		const activity = parseCursorReplayToolDetails({
			variant: "activity",
			sourceToolName: "mcp",
			title: "Cursor MCP",
			summary: "git status",
			expandedText: "line one",
		});
		const image = parseCursorReplayToolDetails({
			variant: "generateImage",
			imagePath: "/tmp/out.png",
			summary: "saved /tmp/out.png",
		});
		const fallback = parseCursorReplayToolDetails({
			variant: "genericFallback",
			sourceToolName: "futureTool",
			summary: "done",
		});

		expect(edit).toMatchObject({ variant: "nativeEdit" });
		expect(write).toMatchObject({ variant: "nativeWrite" });
		expect(activity).toMatchObject({ variant: "activity", sourceToolName: "mcp", title: "Cursor MCP" });
		expect(image).toMatchObject({ variant: "generateImage" });
		expect(fallback).toMatchObject({ variant: "genericFallback", sourceToolName: "futureTool" });
	});

	it("does not upgrade payloads without current replay variants", () => {
		expect(parseCursorReplayToolDetails({ path: "src/a.ts" })).toBeUndefined();
		expect(parseCursorReplayToolDetails({ variant: "activity", title: "Cursor MCP" })).toMatchObject({
			variant: "activity",
			sourceToolName: "unregisteredActivity",
			title: "Cursor MCP",
		});
		expect(parseCursorReplayToolDetails({ variant: "edit", path: "src/a.ts" })).toBeUndefined();
	});

	it("parses activity details and ignores unknown fields at the boundary", () => {
		const parsed = parseCursorReplayToolDetails({
			variant: "activity",
			sourceToolName: "mcp",
			title: "Cursor MCP",
			summary: "git status",
			expandedText: "line one",
			untrusted: "drop-me",
		});
		expect(parsed).toMatchObject({
			variant: "activity",
			sourceToolName: "mcp",
			title: "Cursor MCP",
			summary: "git status",
			expandedText: "line one",
		});
		expect(parsed).not.toHaveProperty("untrusted");
	});

	it("parses explicit nativeEdit and nativeWrite variants without title reclassification", () => {
		const edit = parseCursorReplayToolDetails({
			variant: "nativeEdit",
			title: "Cursor edit",
			path: "src/a.ts",
			diffString: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
			linesAdded: 1,
		});
		const write = parseCursorReplayToolDetails({
			variant: "nativeWrite",
			title: "Cursor write",
			path: "out.txt",
			linesCreated: 3,
		});

		expect(edit).toMatchObject({ variant: "nativeEdit", path: "src/a.ts" });
		expect(edit).not.toHaveProperty("title");
		expect(write).toMatchObject({ variant: "nativeWrite", path: "out.txt" });
		expect(write).not.toHaveProperty("title");
	});

	it("keeps genericFallback strict instead of repairing known source names in render parsing", () => {
		const edit = parseCursorReplayToolDetails({
			variant: "genericFallback",
			sourceToolName: "edit",
			path: "src/a.ts",
			diffString: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old\n+new",
			linesAdded: 1,
		});
		const write = parseCursorReplayToolDetails({
			variant: "genericFallback",
			sourceToolName: "write",
			path: "out.txt",
			linesCreated: 2,
		});
		const image = parseCursorReplayToolDetails({
			variant: "genericFallback",
			sourceToolName: "generateImage",
			imagePath: "/tmp/out.png",
		});

		expect(edit).toMatchObject({ variant: "genericFallback", sourceToolName: "edit" });
		expect(write).toMatchObject({ variant: "genericFallback", sourceToolName: "write" });
		expect(image).toMatchObject({ variant: "genericFallback", sourceToolName: "generateImage" });
	});

	it("produces typed generateImage details from the display spec producer", () => {
		const display = buildCursorPiToolDisplayFromSpec({
			rawName: "generateImage",
			name: "generateImage",
			args: { prompt: "a red circle" },
			result: { status: "success", value: { filePath: "/tmp/generated.png" }, error: undefined },
			options: { cwd: "/tmp", maxChars: 4000 },
		});
		const details = parseCursorReplayToolDetails(display.result.details);
		expect(details).toMatchObject({
			variant: "generateImage",
			imagePath: "/tmp/generated.png",
		});
		expect(details).not.toHaveProperty("title");
	});

});
