import { describe, expect, it } from "vitest";
import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME } from "../src/cursor-tool-presentation-registry.js";
import { buildCursorPiToolDisplay, formatCursorToolTranscript } from "../src/cursor-tool-transcript.js";
import { readMcpDisplayResult } from "../src/cursor-tool-result-display-readers.js";
import { getCursorDisplayDetailSummary } from "./helpers/cursor-display-details.js";


describe("formatCursorToolTranscript MCP and web", () => {

	it("scrubs secrets from Cursor MCP collapsed summaries", () => {
		const secret = "super-secret-key-12345";
		const display = buildCursorPiToolDisplay({
			name: "mcp",
			args: { toolName: "auth" },
			result: {
				status: "success",
				value: {
					content: [{ text: { text: `apiKey=${secret}\nBearer bearer-token-value` } }],
				},
			},
		});

		expect(display.args.activitySummary).toContain("auth · apiKey=[redacted]");
		expect(display.args.activitySummary).not.toContain(secret);
		expect(display.args.activitySummary).not.toContain("bearer-token-value");
		expect(getCursorDisplayDetailSummary(display)).toContain("[redacted]");
		expect(getCursorDisplayDetailSummary(display)).not.toContain(secret);
		expect(getCursorDisplayDetailSummary(display)).not.toContain("bearer-token-value");
	});

	it("prefers text MCP summary over earlier non-text blocks", () => {
		const display = buildCursorPiToolDisplay({
			name: "mcp",
			args: { toolName: "image_service" },
			result: {
				status: "success",
				value: {
					content: [
						{ type: "image", mimeType: "image/png", data: "base64-image-data" },
						{ text: { text: "useful text preview" } },
					],
				},
			},
		});

		expect(display.args.activitySummary).toBe("image_service · useful text preview");
	});

	it("summarizes Cursor MCP non-text content without dumping raw payloads", () => {
		const display = buildCursorPiToolDisplay({
			name: "mcp",
			args: { toolName: "image_service" },
			result: {
				status: "success",
				value: {
					content: [
						{ type: "image", mimeType: "image/png", data: "base64-image-data" },
						{ type: "resource", uri: "file:///secret.txt", blob: "raw-resource-payload" },
					],
				},
			},
		});
		const transcript = formatCursorToolTranscript({
			name: "mcp",
			args: { toolName: "image_service" },
			result: {
				status: "success",
				value: {
					content: [
						{ type: "image", mimeType: "image/png", data: "base64-image-data" },
						{ type: "resource", uri: "file:///secret.txt", blob: "raw-resource-payload" },
					],
				},
			},
		});

		expect(display.result.content[0].text).toContain("[image image/png omitted]");
		expect(display.result.content[0].text).toContain("[resource omitted]");
		expect(display.result.content[0].text).not.toContain("base64-image-data");
		expect(display.result.content[0].text).not.toContain("raw-resource-payload");
		expect(transcript).toContain("[image image/png omitted]");
		expect(transcript).not.toContain("base64-image-data");
	});

	it("uses one MCP display model for mixed text and non-text body/preview", () => {
		const result = {
			status: "success" as const,
			value: {
				content: [
					{ type: "image", mimeType: "image/png", data: "raw-image" },
					{ text: { text: "first line\nsecond line" } },
				],
			},
		};

		expect(readMcpDisplayResult(result)).toMatchObject({
			isToolError: false,
			text: "first line\nsecond line",
			nonTextSummary: "[image image/png omitted]",
			body: "first line\nsecond line",
			preview: "first line",
		});
		expect(formatCursorToolTranscript({ name: "mcp", args: { toolName: "mixed" }, result })).toContain("first line\nsecond line");
	});

	it("uses one MCP display model for empty content fallback", () => {
		const result = { status: "success" as const, value: { content: [] } };

		expect(readMcpDisplayResult(result)).toMatchObject({
			isToolError: false,
			text: "",
			nonTextSummary: "",
			body: '{"content":[]}',
		});
		expect(readMcpDisplayResult(result).preview).toBeUndefined();
		expect(formatCursorToolTranscript({ name: "mcp", args: { toolName: "empty" }, result })).toContain('{"content":[]}');
	});

	it("uses one MCP display model for tool-level isError", () => {
		const result = { status: "success" as const, value: { isError: true, content: [{ text: "failed remotely" }] } };

		expect(readMcpDisplayResult(result)).toMatchObject({
			isToolError: true,
			body: "[tool error]\nfailed remotely",
			preview: "failed remotely",
		});
		expect(formatCursorToolTranscript({ name: "mcp", args: { toolName: "remote" }, result })).toContain("[tool error]\nfailed remotely");
	});

	it("labels completed Cursor web search MCP activity instead of generic Cursor MCP", () => {
		const toolCall = {
			name: "mcp",
			args: { toolName: "WebSearch", args: { search_term: "pi extension" } },
			result: { status: "success", value: { content: [{ text: { text: "result snippet" } }], isError: false } },
		};
		const display = buildCursorPiToolDisplay(toolCall);
		const transcript = formatCursorToolTranscript(toolCall);

		expect(display).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { query: "pi extension", activityTitle: "Cursor web search", activitySummary: "pi extension" },
			result: { details: { variant: "activity", sourceToolName: "webSearch", title: "Cursor web search" } },
		});
		expect(display.args.activityTitle).not.toBe("Cursor MCP");
		expect(transcript).toContain("web search pi extension");
		expect(transcript).not.toContain("WebSearch\n");
	});

	it("labels completed Cursor web fetch host activity with bounded URL summary", () => {
		const toolCall = {
			name: "web_fetch",
			args: { url: "https://example.com/docs" },
			result: { status: "success", value: { content: [{ text: { text: "docs page" } }], isError: false } },
		};
		const display = buildCursorPiToolDisplay(toolCall);

		expect(display).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { url: "https://example.com/docs", activityTitle: "Cursor web fetch", activitySummary: "https://example.com/docs" },
			result: { details: { variant: "activity", sourceToolName: "webFetch", title: "Cursor web fetch" } },
		});
	});

	it("formats completed semSearch activity with bounded results text", () => {
		const results = "src/index.ts:42 — export function main()\nsrc/util.ts:10 — helper";
		const display = buildCursorPiToolDisplay({
			name: "semSearch",
			args: { query: "main entrypoint", targetDirectories: ["src"], explanation: "find bootstrap" },
			result: { status: "success", value: { results } },
		});
		const transcript = formatCursorToolTranscript({
			name: "semSearch",
			args: { query: "main entrypoint", targetDirectories: ["src"], explanation: "find bootstrap" },
			result: { status: "success", value: { results } },
		});

		expect(display).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { query: "main entrypoint", activityTitle: "Cursor semantic search", activitySummary: "main entrypoint (1 dir)" },
			result: { details: { variant: "activity", sourceToolName: "semSearch", title: "Cursor semantic search", summary: "main entrypoint (1 dir)" } },
			isError: false,
		});
		expect(display.result.content[0].text).toContain(results);
		expect(display.result.content[0].text).not.toContain('"results"');
		expect(transcript).toContain("semSearch main entrypoint");
		expect(transcript).toContain(results);
		expect(transcript).not.toContain('"results"');
	});

	it("formats semSearch errors without dumping raw payloads", () => {
		const transcript = formatCursorToolTranscript({
			name: "semSearch",
			args: { query: "missing index" },
			result: { status: "error", error: { message: "semantic index unavailable" } },
		});

		expect(transcript).toContain("semSearch missing index");
		expect(transcript).toContain("semantic index unavailable");
		expect(transcript).not.toContain('"query"');
	});

	it("formats completed recordScreen activity with mode, path, and duration", () => {
		const display = buildCursorPiToolDisplay(
			{
				name: "recordScreen",
				args: { mode: "SAVE_RECORDING" },
				result: {
					status: "success",
					value: { path: "/repo/.cursor/recordings/demo.webm", recordingDurationMs: 4200, wasPriorRecordingCancelled: false },
				},
			},
			{ cwd: "/repo" },
		);
		const transcript = formatCursorToolTranscript(
			{
				name: "recordScreen",
				args: { mode: "SAVE_RECORDING" },
				result: {
					status: "success",
					value: { path: "/repo/.cursor/recordings/demo.webm", recordingDurationMs: 4200 },
				},
			},
			{ cwd: "/repo" },
		);

		expect(display).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: {
				mode: "SAVE_RECORDING",
				path: ".cursor/recordings/demo.webm",
				activityTitle: "Cursor screen recording",
				activitySummary: ".cursor/recordings/demo.webm · 4.2s",
			},
			result: {
				details: {
					variant: "activity",
					sourceToolName: "recordScreen",
					title: "Cursor screen recording",
					summary: ".cursor/recordings/demo.webm · 4.2s",
				},
			},
			isError: false,
		});
		expect(display.result.content[0].text).toContain("Recording: .cursor/recordings/demo.webm");
		expect(display.result.content[0].text).toContain("Duration: 4.2s");
		expect(transcript).toContain("recordScreen save recording");
		expect(transcript).not.toContain('"recordingDurationMs"');
	});

	it("formats recordScreen errors without dumping raw payloads", () => {
		const transcript = formatCursorToolTranscript({
			name: "recordScreen",
			args: { mode: "START_RECORDING" },
			result: { status: "error", error: { message: "screen capture unavailable" } },
		});

		expect(transcript).toContain("recordScreen start recording");
		expect(transcript).toContain("screen capture unavailable");
		expect(transcript).not.toContain('"mode"');
	});

	it("shows Cursor generateImage output paths without dumping image data", () => {
		const display = buildCursorPiToolDisplay(
			{
				name: "generateImage",
				args: { description: "Small badge", filePath: "assets/badge.png" },
				result: {
					status: "success",
					value: { filePath: "/Users/example/.cursor/projects/repo/assets/badge.png", imageData: "base64-image-data" },
				},
			},
			{ cwd: "/repo" },
		);

		expect(display).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { prompt: "Small badge", activityTitle: "Cursor image generation", activitySummary: "/Users/example/.cursor/projects/repo/assets/badge.png" },
			result: {
				details: {
					variant: "generateImage",
					summary: "/Users/example/.cursor/projects/repo/assets/badge.png",
					imagePath: "/Users/example/.cursor/projects/repo/assets/badge.png",
					imageDisplayPath: "/Users/example/.cursor/projects/repo/assets/badge.png",
					imageMimeType: "image/png",
				},
			},
			isError: false,
		});
		expect(display.result.content[0].text).toContain("Saved image: /Users/example/.cursor/projects/repo/assets/badge.png");
		expect(display.result.content[0].text).not.toContain("base64-image-data");
	});
});
