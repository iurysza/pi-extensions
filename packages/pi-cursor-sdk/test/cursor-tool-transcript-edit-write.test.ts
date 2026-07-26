import { describe, expect, it } from "vitest";
import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME } from "../src/cursor-tool-presentation-registry.js";
import { buildCursorPiToolDisplay } from "../src/cursor-tool-transcript.js";


describe("formatCursorToolTranscript edit and write", () => {

	it("uses native edit replay only when Cursor edit args can truthfully satisfy pi edit schema", () => {
		const editDisplay = buildCursorPiToolDisplay({
			name: "edit",
			args: { path: "src/index.ts", oldText: "old line\n", newText: "new line\n" },
			result: { status: "success", value: { linesAdded: 1, linesRemoved: 1, diffString: "--- a/src/index.ts\n+++ b/src/index.ts" } },
		});
		const writeDisplay = buildCursorPiToolDisplay({
			name: "write",
			args: { path: "new.txt", content: "hello\n" },
			result: { status: "success", value: { linesCreated: 1, fileSize: 6, fileContentAfterWrite: "hello\n" } },
		});

		expect(editDisplay).toMatchObject({
			toolName: "edit",
			args: { path: "src/index.ts", edits: [{ oldText: "old line\n", newText: "new line\n" }] },
			result: { details: { variant: "nativeEdit", diff: "--- a/src/index.ts\n+++ b/src/index.ts" } },
			isError: false,
		});
		expect(editDisplay.toolName).not.toContain("cursor");
		expect(editDisplay.result.content[0].text).toContain("edit src/index.ts");
		expect(editDisplay.result.content[0].text).toContain("+1 -1");
		expect(writeDisplay).toMatchObject({
			toolName: "write",
			args: { path: "new.txt", content: "hello\n" },
			result: { details: { variant: "nativeWrite", fileContentAfterWrite: "hello\n" } },
			isError: false,
		});
		expect(writeDisplay.toolName).not.toContain("cursor");
		expect(writeDisplay.result.content[0].text).toContain("write new.txt");
		expect(writeDisplay.result.content[0].text).toContain("Created 1 lines");
		expect(writeDisplay.result.content[0].text).toContain("hello");
	});

	it("falls back path-only Cursor edit replay to neutral cursor activity", () => {
		const editDisplay = buildCursorPiToolDisplay({
			name: "edit",
			args: { path: ".tool-demo-temp.txt" },
			result: { status: "success", value: { linesAdded: 1, linesRemoved: 0, diffString: "--- a/.tool-demo-temp.txt\n+++ b/.tool-demo-temp.txt" } },
		});

		expect(editDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { path: ".tool-demo-temp.txt", activityTitle: "Cursor edit", activitySummary: ".tool-demo-temp.txt" },
			result: {
				details: {
					variant: "activity",
					sourceToolName: "edit",
					title: "Cursor edit",
					summary: ".tool-demo-temp.txt added 1 line",
					// Producer regression: activity edit details now carry structured diff when SDK result has it (primary for coloring).
					diffString: expect.stringContaining("--- a/.tool-demo-temp.txt"),
					diff: expect.stringContaining("--- a/.tool-demo-temp.txt"),
					linesAdded: 1,
					linesRemoved: 0,
				},
			},
			isError: false,
		});
		expect(editDisplay.args).not.toHaveProperty("edits");
		expect(editDisplay.result.content[0].text).toContain("edit .tool-demo-temp.txt");
	});

	it("falls back path-only Cursor write replay to neutral cursor activity with structured file content", () => {
		const writeDisplay = buildCursorPiToolDisplay({
			name: "write",
			args: { path: ".tool-demo-temp.txt" },
			result: { status: "success", value: { linesCreated: 1, fileSize: 6, fileContentAfterWrite: "hello\n" } },
		});

		expect(writeDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { path: ".tool-demo-temp.txt", activityTitle: "Cursor write", activitySummary: ".tool-demo-temp.txt" },
			result: {
				details: {
					variant: "activity",
					sourceToolName: "write",
					title: "Cursor write",
					path: ".tool-demo-temp.txt",
					fileContentAfterWrite: "hello\n",
				},
			},
			isError: false,
		});
		expect(writeDisplay.args).not.toHaveProperty("content");
		expect(writeDisplay.result.content[0].text).toContain("write .tool-demo-temp.txt");
	});

	it("maps Cursor StrReplace to schema-valid edit replay and notebook edits to neutral cursor activity", () => {
		const strReplaceDisplay = buildCursorPiToolDisplay({
			name: "StrReplace",
			args: { path: "src/index.ts", old_string: "before", new_string: "after" },
			result: { status: "success", value: { linesAdded: 2, linesRemoved: 1, diff: "--- a/src/index.ts\n+++ b/src/index.ts" } },
		});
		const notebookDisplay = buildCursorPiToolDisplay({
			name: "EditNotebook",
			args: { path: "notebooks/demo.ipynb", cellId: "cell-1" },
			result: { status: "success", value: { linesAdded: 1, linesRemoved: 0, unifiedDiff: "--- a/notebooks/demo.ipynb\n+++ b/notebooks/demo.ipynb" } },
		});
		const genericNotebookEditDisplay = buildCursorPiToolDisplay({
			name: "edit",
			args: { path: "notebooks/demo.ipynb", oldText: "before", newText: "after" },
			result: { status: "success", value: { linesAdded: 1, linesRemoved: 1, unifiedDiff: "--- a/notebooks/demo.ipynb\n+++ b/notebooks/demo.ipynb" } },
		});

		expect(strReplaceDisplay).toMatchObject({
			toolName: "edit",
			args: { path: "src/index.ts", edits: [{ oldText: "before", newText: "after" }] },
			result: { details: { variant: "nativeEdit", diff: "--- a/src/index.ts\n+++ b/src/index.ts" } },
			isError: false,
		});
		expect(notebookDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { path: "notebooks/demo.ipynb", cellId: "cell-1", activityTitle: "Cursor edit", activitySummary: "notebooks/demo.ipynb" },
			result: { details: { variant: "activity", sourceToolName: "edit", title: "Cursor edit" } },
			isError: false,
		});
		expect(genericNotebookEditDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { path: "notebooks/demo.ipynb", oldText: "before", newText: "after", activityTitle: "Cursor edit", activitySummary: "notebooks/demo.ipynb" },
			result: { details: { variant: "activity", sourceToolName: "edit", title: "Cursor edit" } },
			isError: false,
		});
		expect(strReplaceDisplay.toolName).not.toBe(CURSOR_REPLAY_ACTIVITY_TOOL_NAME);
		expect(notebookDisplay.args).not.toHaveProperty("edits");
		expect(genericNotebookEditDisplay.args).not.toHaveProperty("edits");
	});

	it("builds replay-only native pi display data for Cursor workflow and utility tools", () => {
		const lintsDisplay = buildCursorPiToolDisplay(
			{
				name: "readLints",
				args: { path: "/repo/src/index.ts" },
				result: {
					status: "success",
					value: { fileDiagnostics: [{ path: "/repo/src/index.ts", diagnostics: [] }], totalDiagnostics: 0 },
				},
			},
			{ cwd: "/repo" },
		);
		const todosDisplay = buildCursorPiToolDisplay({
			name: "updateTodos",
			args: {},
			result: {
				status: "success",
				value: {
					todos: [
						{ content: "Run Read/Grep/Glob", status: "completed" },
						{ content: "Run Task/MCP", status: "pending" },
					],
					totalCount: 2,
				},
			},
		});
		const planDisplay = buildCursorPiToolDisplay({
			name: "createPlan",
			args: {},
			result: {
				status: "success",
				value: {
					todos: [
						{ content: "Draft plan", status: "completed" },
						{ content: "Review plan", status: "pending" },
					],
					totalCount: 2,
				},
			},
		});
		const taskDisplay = buildCursorPiToolDisplay({
			name: "task",
			args: { description: "Quick ls demo subagent" },
			result: {
				status: "success",
				value: { result: { success: { command: "ls src | head -5", stdout: "context.ts\ncursor-provider.ts\n" } } },
			},
		});
		const mcpDisplay = buildCursorPiToolDisplay({
			name: "mcp",
			args: { toolName: "git" },
			result: {
				status: "success",
				value: { content: [{ text: { text: "## Git Status ✅\n13 modified" } }], isError: false },
			},
		});
		const deleteDisplay = buildCursorPiToolDisplay(
			{
				name: "delete",
				args: { path: "/repo/.debug/delete-me.txt" },
				result: { status: "success", value: { fileSize: 9 } },
			},
			{ cwd: "/repo" },
		);

		expect(lintsDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { paths: ["src/index.ts"], diagnosticCount: 0, activityTitle: "Cursor diagnostics", activitySummary: "0 diagnostics in src/index.ts" },
			result: { details: { variant: "activity", sourceToolName: "readLints", title: "Cursor diagnostics", summary: "0 diagnostics in src/index.ts" } },
			isError: false,
		});
		expect(lintsDisplay.result.content[0].text).toContain("No diagnostics in src/index.ts");
		expect(todosDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { totalCount: 2, activityTitle: "Cursor todos", activitySummary: "1/2 completed, 1 pending" },
			result: {
				details: {
					variant: "activity",
					sourceToolName: "updateTodos",
					title: "Cursor todos",
					summary: "1/2 completed, 1 pending",
				},
			},
			isError: false,
		});
		expect(planDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { totalCount: 2, activityTitle: "Cursor plan", activitySummary: "1/2 completed, 1 pending" },
			result: {
				details: {
					variant: "activity",
					sourceToolName: "createPlan",
					title: "Cursor plan",
					summary: "1/2 completed, 1 pending",
				},
			},
			isError: false,
		});
		expect(todosDisplay.result.content[0].text).toContain("✓ Run Read/Grep/Glob (completed)");
		expect(taskDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { description: "Quick ls demo subagent", activityTitle: "Cursor subagent", activitySummary: "Quick ls demo subagent: $ ls src | head -5" },
			result: { details: { variant: "activity", sourceToolName: "task", title: "Cursor subagent", summary: "Quick ls demo subagent: $ ls src | head -5" } },
			isError: false,
		});
		expect(taskDisplay.result.content[0].text).toContain("context.ts");
		expect(mcpDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { toolName: "git", activityTitle: "Cursor MCP", activitySummary: "git · ## Git Status ✅" },
			result: { details: { variant: "activity", sourceToolName: "mcp", title: "Cursor MCP", summary: "git · ## Git Status ✅" } },
			isError: false,
		});
		expect(mcpDisplay.result.content[0].text).toContain("## Git Status ✅");
		expect(mcpDisplay.result.content[0].text).not.toContain('"content"');
		expect(deleteDisplay).toMatchObject({
			toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
			args: { path: ".debug/delete-me.txt", activityTitle: "Cursor delete", activitySummary: ".debug/delete-me.txt" },
			result: { details: { variant: "activity", sourceToolName: "delete", title: "Cursor delete", path: ".debug/delete-me.txt" } },
			isError: false,
		});
		expect(deleteDisplay.result.content[0].text).toContain("Deleted 9 bytes");
	});

	it("includes nested Cursor task conversation tool-call summaries when the SDK returns them", () => {
		process.env.PI_CURSOR_TASK_PRESENTATION = "subagent-meta";
		try {
			const taskDisplay = buildCursorPiToolDisplay(
				{
					name: "task",
					args: { description: "Inspect package.json", subagentType: { kind: "explore" }, model: "composer-2.5-fast" },
					result: {
						status: "success",
						value: {
							agentId: "agent-sub-1",
							conversationSteps: [
								{ type: "toolCall", message: { type: "read", args: { path: "/repo/package.json" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "/outside/.ssh/id_rsa" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "file:///outside/.ssh/id_rsa" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "vscode://file/outside/private.ts" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "~example/.ssh/id_rsa" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "../.ssh/id_rsa" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "..\\secret.txt" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "src/.." } } },
								{ type: "toolCall", message: { type: "read", args: { path: "~/.ssh/id_rsa" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "C:..\\secret.txt" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "C:\\Users\\example\\secret.txt" } } },
								{ type: "toolCall", message: { type: "read", args: { path: "/repo/src/../package.json" } } },
								{
									type: "toolCall",
									message: {
										type: "shell",
										args: { command: "node -p require('./package.json').name" },
										result: { status: "success", value: { stdout: "pi-cursor-sdk\n", stderr: "", exitCode: 0, signal: "", executionTime: 1 } },
									},
								},
								{ type: "assistantMessage", message: { text: "Package name is pi-cursor-sdk." } },
							],
						},
					},
				},
				{ cwd: "/repo" },
			);

			const text = taskDisplay.result.content[0].text;
			expect(text).toContain("read package.json");
			expect(text).not.toContain("/outside/.ssh/id_rsa");
			expect(text).not.toContain("file:///outside/.ssh/id_rsa");
			expect(text).not.toContain("vscode://file/outside/private.ts");
			expect(text).not.toContain("~example/.ssh/id_rsa");
			expect(text).not.toContain("../.ssh/id_rsa");
			expect(text).not.toContain("..\\secret.txt");
			expect(text).not.toContain("src/..");
			expect(text).not.toContain("~/.ssh/id_rsa");
			expect(text).not.toContain("C:..\\secret.txt");
			expect(text).not.toContain("C:\\Users\\example\\secret.txt");
			expect(text).not.toContain("/repo/src/../package.json");
			expect(text).toContain("$ node -p require('./package.json').name");
			expect(text).toContain("pi-cursor-sdk");
			expect(text).toContain("Package name is pi-cursor-sdk.");
		} finally {
			delete process.env.PI_CURSOR_TASK_PRESENTATION;
		}
	});

	it("uses Cursor task result descriptions for replay summaries and transcript headers", () => {
		process.env.PI_CURSOR_TASK_PRESENTATION = "subagent-meta";
		try {
			const taskDisplay = buildCursorPiToolDisplay({
				name: "task",
				args: {},
				result: {
					status: "success",
					value: { description: "Inspect fallback description", conversationSteps: [{ assistantMessage: { text: "done" } }] },
				},
			});

			expect(taskDisplay.args.activitySummary).toBe("Inspect fallback description: done");
			expect(taskDisplay.result.content[0].text).toContain("subagent Inspect fallback description");
		} finally {
			delete process.env.PI_CURSOR_TASK_PRESENTATION;
		}
	});

	it("suppresses invalid Cursor subagent agent IDs", () => {
		process.env.PI_CURSOR_TASK_PRESENTATION = "subagent-meta";
		try {
			const taskDisplay = buildCursorPiToolDisplay({
				name: "task",
				args: { description: "Inspect package.json", subagentType: { kind: "explore" }, model: "composer-2.5-fast" },
				result: {
					status: "success",
					value: {
						agentId: "../../agent/sub 123",
						conversationSteps: [{ type: "assistantMessage", message: { text: "done" } }],
					},
				},
			});

			expect(taskDisplay.args).not.toHaveProperty("agentId");
			expect(taskDisplay.args.activitySummary).toBe("Inspect package.json · Explore · composer-2.5-fast");
		} finally {
			delete process.env.PI_CURSOR_TASK_PRESENTATION;
		}
	});

	it("can render SDK task activity as an explicit Cursor subagent card with metadata", () => {
		process.env.PI_CURSOR_TASK_PRESENTATION = "subagent-meta";
		try {
			const taskDisplay = buildCursorPiToolDisplay({
				name: "task",
				args: {
					description: "Review API auth flow",
					subagentType: { kind: "builtin", name: "reviewer" },
					model: "composer-2.5",
				},
				result: {
					status: "success",
					value: {
						agentId: "agent-sub-1234567890",
						isBackground: true,
						conversationSteps: [{ assistantMessage: { text: "Found two auth risks." } }],
					},
				},
			});

			expect(taskDisplay).toMatchObject({
				toolName: CURSOR_REPLAY_ACTIVITY_TOOL_NAME,
				args: {
					description: "Review API auth flow",
					subagentName: "reviewer",
					subagentKind: "Builtin",
					model: "composer-2.5",
					agentId: "agent-su",
					isBackground: true,
					activityTitle: "Cursor subagent",
					activitySummary: "Review API auth flow · Builtin · composer-2.5 · ID: agent-su · backgrounded",
				},
				result: {
					details: {
						variant: "activity",
						sourceToolName: "task",
						title: "Cursor subagent",
						summary: "Review API auth flow · Builtin · composer-2.5 · ID: agent-su · backgrounded",
					},
				},
				isError: false,
			});
			expect(taskDisplay.result.content[0].text).toContain("subagent reviewer Review API auth flow");
			expect(taskDisplay.result.content[0].text).not.toContain("type=builtin");
			expect(taskDisplay.result.content[0].text).toContain("Found two auth risks.");
		} finally {
			delete process.env.PI_CURSOR_TASK_PRESENTATION;
		}
	});
});
