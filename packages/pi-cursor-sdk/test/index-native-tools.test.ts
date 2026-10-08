import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetCapabilitiesCache, setCapabilities } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createBuiltinToolInfo,
	createExtensionTestContext,
	getHarnessRegisteredTool,
	makeHarnessModel,
	makeModel,
} from "./helpers/pi-harness.js";
import { createExtensionPi, resetIndexExtensionTestState } from "./helpers/index-extension-test-kit.js";
import { createRenderContext, createRenderOptions, createRenderTheme } from "./helpers/render-fixtures.js";

vi.mock("../src/model-discovery.js", () => ({
	discoverModels: vi.fn(),
	getCursorModelMetadata: vi.fn(),
}));

vi.mock("../src/cursor-provider.js", () => ({
	streamCursor: vi.fn(),
}));

import extensionFactory from "../src/index.js";
import { discoverModels } from "../src/model-discovery.js";

const mockedDiscover = vi.mocked(discoverModels);
import {
	canRenderCursorToolNatively,
	recordCursorNativeToolDisplay,
} from "../src/cursor-native-tool-display-state.js";
import { CURSOR_ASK_QUESTION_TOOL_NAME } from "../src/cursor-question-tool.js";
import { CURSOR_ACTIVATE_SKILL_TOOL_NAME } from "../src/cursor-skill-tool.js";

describe("extension native Cursor tool replay", () => {
	beforeEach(resetIndexExtensionTestState);

	it("defers native Cursor tool wrapper registration until session_start", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		pi.getAllTools.mockImplementation(() => {
			throw new Error("runtime tool actions are unavailable during extension load");
		});

		await extensionFactory(pi);

		expect(pi._tools.map((tool) => tool.name)).toEqual([CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME]);
		expect(canRenderCursorToolNatively("grep")).toBe(false);
	});

	it("registers native Cursor tool wrappers with the pi session cwd", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const dir = mkdtempSync(join(tmpdir(), "pi-cursor-native-cwd-"));
		try {
			writeFileSync(join(dir, "session-file.txt"), "from session cwd\n");
			const pi = createExtensionPi();
			await extensionFactory(pi);
			await pi.runSessionStart({ cwd: dir });

			const readTool = getHarnessRegisteredTool(pi._tools, "read");
			expect(readTool).toBeDefined();
			const result = await readTool!.execute(
				"ordinary-read",
				{ path: "session-file.txt" },
				undefined,
				undefined,
				createExtensionTestContext({ cwd: dir }),
			);

			expect(result.content).toEqual([{ type: "text", text: "from session cwd\n" }]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("updates registered native Cursor tool wrappers to the latest pi session cwd", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const firstDir = mkdtempSync(join(tmpdir(), "pi-cursor-native-cwd-first-"));
		const secondDir = mkdtempSync(join(tmpdir(), "pi-cursor-native-cwd-second-"));
		try {
			writeFileSync(join(firstDir, "session-file.txt"), "from first cwd\n");
			writeFileSync(join(secondDir, "session-file.txt"), "from second cwd\n");
			const pi = createExtensionPi();
			await extensionFactory(pi);
			await pi.runSessionStart({ cwd: firstDir });
			await pi.runSessionStart({ cwd: secondDir });

			const readTool = getHarnessRegisteredTool(pi._tools, "read");
			expect(readTool).toBeDefined();
			const result = await readTool!.execute(
				"ordinary-read",
				{ path: "session-file.txt" },
				undefined,
				undefined,
				createExtensionTestContext({ cwd: secondDir }),
			);

			expect(pi.registerTool).toHaveBeenCalledTimes(10);
			expect(result.content).toEqual([{ type: "text", text: "from second cwd\n" }]);
		} finally {
			rmSync(firstDir, { recursive: true, force: true });
			rmSync(secondDir, { recursive: true, force: true });
		}
	});

	it("registered native Cursor tool wrappers return recorded Cursor results without executing built-ins", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		recordCursorNativeToolDisplay({
			id: "cursor-tool-1",
			toolName: "read",
			args: { path: "README.md" },
			result: { content: [{ type: "text", text: "# pi-cursor-sdk" }] },
			isError: false,
		});

		const readTool = getHarnessRegisteredTool(pi._tools, "read");
		expect(readTool).toBeDefined();
		const result = await readTool!.execute(
			"cursor-tool-1",
			{ path: "README.md" },
			undefined,
			undefined,
			createExtensionTestContext(),
		);

		expect(result).toEqual({
			content: [{ type: "text", text: "# pi-cursor-sdk" }],
			details: undefined,
			terminate: true,
		});
	});

	it("registered native Cursor tool wrappers replay recorded Cursor errors as tool errors", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		recordCursorNativeToolDisplay({
			id: "cursor-tool-error",
			toolName: "bash",
			args: { command: "exit 7" },
			result: { content: [{ type: "text", text: "Command exited with code 7" }] },
			isError: true,
		});

		const bashTool = getHarnessRegisteredTool(pi._tools, "bash");
		await expect(
			bashTool.execute("cursor-tool-error", { command: "exit 7" }, undefined, undefined, createExtensionTestContext()),
		).rejects.toThrow(
			"Command exited with code 7",
		);
	});

	it("does not register native Cursor tool wrappers on non-Cursor models", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart({
			model: makeHarnessModel("openai-codex", "openai-codex-responses", "gpt-5.5"),
		});

		expect(pi._tools.map((tool) => tool.name)).toEqual([CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME]);
		expect(canRenderCursorToolNatively("cursor")).toBe(false);
		expect(canRenderCursorToolNatively("edit")).toBe(false);
		expect(canRenderCursorToolNatively("write")).toBe(false);
		expect(pi.registerTool).toHaveBeenCalledTimes(2);
	});

	it("leaves ordinary pi edit rendering untouched on non-Cursor models", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart({
			model: makeHarnessModel("openai-codex", "openai-codex-responses", "gpt-5.5"),
		});

		const wrappedEdit = pi._tools.find((tool) => tool.name === "edit");
		expect(wrappedEdit).toBeUndefined();
		expect(pi._activeToolNames()).toEqual(["read", "bash", "edit", "write"]);
	});

	it("registers native Cursor tool wrappers on first Cursor model transition", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart({
			model: makeHarnessModel("openai-codex", "openai-codex-responses", "gpt-5.5"),
		});

		expect(pi._tools.map((tool) => tool.name)).toEqual([CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME]);

		await pi.runModelSelect(makeModel("composer-2.5"));

		expect(pi._tools.map((tool) => tool.name)).toContain("cursor");
		expect(pi._tools.map((tool) => tool.name)).toContain("read");
		expect(pi._activeToolNames()).toContain("cursor");
		expect(pi._activeToolNames()).toContain("read");
		expect(canRenderCursorToolNatively("cursor")).toBe(true);
		expect(canRenderCursorToolNatively("read")).toBe(true);
	});

	it("core native Cursor wrappers delegate ordinary non-Cursor execution and rendering after model switch", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const dir = mkdtempSync(join(tmpdir(), "pi-cursor-native-cross-model-"));
		try {
			writeFileSync(join(dir, "input.txt"), "before\n");
			const pi = createExtensionPi();
			await extensionFactory(pi);
			await pi.runSessionStart({ cwd: dir, model: makeModel("composer-2.5") });
			await pi.runModelSelect(makeHarnessModel("openai-codex", "openai-codex-responses", "gpt-5.5"), { cwd: dir });

			expect(pi._activeToolNames()).toEqual(["read", "bash", "edit", "write"]);
			expect(pi._activeToolNames()).not.toContain("cursor");
			expect(canRenderCursorToolNatively("read")).toBe(true);

			const context = createExtensionTestContext({ cwd: dir, model: makeHarnessModel("openai-codex", "openai-codex-responses", "gpt-5.5") });
			const readTool = getHarnessRegisteredTool(pi._tools, "read");
			const bashTool = getHarnessRegisteredTool(pi._tools, "bash");
			const editTool = getHarnessRegisteredTool(pi._tools, "edit");
			const writeTool = getHarnessRegisteredTool(pi._tools, "write");

			await expect(readTool.execute("ordinary-read", { path: "input.txt" }, undefined, undefined, context)).resolves.toMatchObject({
				content: [{ type: "text", text: "before\n" }],
			});
			const bashResult = await bashTool.execute("ordinary-bash", { command: "printf ok" }, undefined, undefined, context);
			expect(bashResult.content.map((entry) => (entry.type === "text" ? entry.text : "")).join("\n")).toContain("ok");
			await writeTool.execute("ordinary-write", { path: "created.txt", content: "created\n" }, undefined, undefined, context);
			expect(readFileSync(join(dir, "created.txt"), "utf8")).toBe("created\n");
			await editTool.execute(
				"ordinary-edit",
				{ path: "input.txt", edits: [{ oldText: "before\n", newText: "after\n" }] },
				undefined,
				undefined,
				context,
			);
			expect(readFileSync(join(dir, "input.txt"), "utf8")).toBe("after\n");

			const theme = createRenderTheme({ bg: (_style: string, text: string) => text });
			const renderCall = (tool: { renderCall?: (...args: any[]) => { render(width: number): string[] } }, args: Record<string, unknown>) =>
				stripVTControlCharacters(
					tool.renderCall?.(
						args,
						theme,
						createRenderContext({ isPartial: false, toolCallId: "ordinary-tool-call", state: {}, args }),
					)?.render(120).join("\n") ?? "",
				);
			expect(renderCall(readTool, { path: "input.txt" })).toBe(renderCall(createReadToolDefinition(dir), { path: "input.txt" }));
			const editArgs = { path: "input.txt", edits: [{ oldText: "after\n", newText: "again\n" }] };
			expect(renderCall(editTool, editArgs)).toBe(renderCall(createEditToolDefinition(dir), editArgs));
			expect(renderCall(writeTool, { path: "created.txt", content: "created\n" })).toBe(
				renderCall(createWriteToolDefinition(dir), { path: "created.txt", content: "created\n" }),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("warns once for conflicting native Cursor tool wrappers across turn lifecycle hooks", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const notify = vi.fn();
		const ui = { notify, setStatus: vi.fn() };
		const pi = createExtensionPi([
			{
				name: "read",
				description: "hashline read",
				parameters: Type.Object({}),
				exposure: "direct",
				sourceInfo: {
					source: "package",
					path: "/opt/homebrew/lib/node_modules/pi-hashline-edit/index.ts",
					scope: "user",
					origin: "package",
				},
			},
			createBuiltinToolInfo("bash"),
			createBuiltinToolInfo("grep"),
			createBuiltinToolInfo("find"),
			createBuiltinToolInfo("ls"),
			createBuiltinToolInfo("edit"),
			createBuiltinToolInfo("write"),
		]);
		await extensionFactory(pi);

		await pi.runSessionStart({ ui });
		await pi.runBeforeAgentStart({ ui });
		await pi.runTurnStart({ ui });
		await pi.runModelSelect(makeModel("composer-2.5"), { ui });

		expect(notify).toHaveBeenCalledTimes(1);
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Cursor native tool replay skipped for read"), "warning");
	});

	it("does not register native Cursor tool wrappers when native display is disabled", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "0";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		expect(pi._tools.map((tool) => tool.name)).toEqual([CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME]);
		expect(canRenderCursorToolNatively("read")).toBe(false);
	});

	it("does not register native Cursor tool wrappers when native tool registration is disabled", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		process.env.PI_CURSOR_REGISTER_NATIVE_TOOLS = "0";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi();
		await extensionFactory(pi);
		await pi.runSessionStart();

		expect(pi._tools.map((tool) => tool.name)).toEqual([CURSOR_ASK_QUESTION_TOOL_NAME, CURSOR_ACTIVATE_SKILL_TOOL_NAME]);
		expect(canRenderCursorToolNatively("read")).toBe(false);
	});

	it("skips only native Cursor tool wrappers owned by another extension", async () => {
		process.env.PI_CURSOR_NATIVE_TOOL_DISPLAY = "1";
		mockedDiscover.mockResolvedValueOnce([]);
		const pi = createExtensionPi([
			{
				name: "read",
				description: "hashline read",
				parameters: Type.Object({}),
				exposure: "direct",
				sourceInfo: {
					source: "package",
					path: "/opt/homebrew/lib/node_modules/pi-hashline-edit/index.ts",
					scope: "user",
					origin: "package",
				},
			},
			createBuiltinToolInfo("bash"),
			createBuiltinToolInfo("grep"),
			createBuiltinToolInfo("find"),
			createBuiltinToolInfo("ls"),
		]);
		await extensionFactory(pi);
		await pi.runSessionStart();

		expect(pi._tools.map((tool) => tool.name)).toEqual([
			CURSOR_ASK_QUESTION_TOOL_NAME,
			CURSOR_ACTIVATE_SKILL_TOOL_NAME,
			"grep",
			"find",
			"ls",
			"cursor",
			"bash",
			"edit",
			"write",
		]);
		expect(canRenderCursorToolNatively("read")).toBe(false);
		expect(canRenderCursorToolNatively("bash")).toBe(true);
		expect(canRenderCursorToolNatively("edit")).toBe(true);
		expect(canRenderCursorToolNatively("write")).toBe(true);
		expect(canRenderCursorToolNatively("grep")).toBe(true);
		expect(canRenderCursorToolNatively("find")).toBe(true);
		expect(canRenderCursorToolNatively("cursor")).toBe(true);
		expect(canRenderCursorToolNatively("ls")).toBe(true);
	});
});
