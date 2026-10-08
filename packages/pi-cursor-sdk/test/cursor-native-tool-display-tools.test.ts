import { describe, expect, it, vi } from "vitest";
import { Text } from "@earendil-works/pi-tui";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as replay from "../src/cursor-native-tool-display-replay.js";
import { wrapNativeCursorTool } from "../src/cursor-native-tool-display-tools.js";
import {
	__testUtils,
	recordCursorNativeToolDisplay,
} from "../src/cursor-native-tool-display-state.js";
import { BUILTIN_NATIVE_CURSOR_TOOL_NAMES } from "../src/cursor-native-tool-names.js";
import { createRenderContext, createRenderOptions, createRenderTheme } from "./helpers/render-fixtures.js";

describe("wrapNativeCursorTool", () => {
	it.each(BUILTIN_NATIVE_CURSOR_TOOL_NAMES)("fails closed when %s replay state is missing", async (toolName) => {
		__testUtils.reset();
		const parameters = Type.Object({});
		const execute = vi.fn(async () => ({ content: [], details: undefined }));
		const definition = {
			name: toolName,
			label: toolName,
			description: toolName,
			parameters,
			execute,
		} satisfies ToolDefinition<typeof parameters, unknown, unknown>;
		const wrapped = wrapNativeCursorTool(definition, () => definition);

		await expect(wrapped.execute(
			`cursor-replay-${toolName}-missing`,
			{},
			new AbortController().signal,
			undefined,
			{} as never,
		)).rejects.toThrow(`No recorded Cursor ${toolName} result`);
		expect(execute).not.toHaveBeenCalled();
	});

	it("consumes standalone replay state once", async () => {
		__testUtils.reset();
		__testUtils.registerNativeToolNameForTests("read");
		recordCursorNativeToolDisplay({
			id: "cursor-replay-read-once",
			toolName: "read",
			args: { path: "README.md" },
			result: { content: [{ type: "text", text: "recorded" }], details: { source: "Cursor" } },
			isError: false,
		});
		const parameters = Type.Object({});
		const execute = vi.fn(async () => ({ content: [], details: undefined }));
		const definition = {
			name: "read",
			label: "read",
			description: "read",
			parameters,
			execute,
		} satisfies ToolDefinition<typeof parameters, unknown, unknown>;
		const wrapped = wrapNativeCursorTool(definition, () => definition);

		await expect(wrapped.execute(
			"cursor-replay-read-once",
			{},
			new AbortController().signal,
			undefined,
			{} as never,
		)).resolves.toMatchObject({ content: [{ type: "text", text: "recorded" }] });
		await expect(wrapped.execute(
			"cursor-replay-read-once",
			{},
			new AbortController().signal,
			undefined,
			{} as never,
		)).rejects.toThrow("No recorded Cursor read result");
		expect(execute).not.toHaveBeenCalled();
	});
});
