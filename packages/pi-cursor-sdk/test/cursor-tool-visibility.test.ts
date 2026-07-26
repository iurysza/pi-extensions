import { describe, expect, it } from "vitest";
import { classifyCursorToolVisibility, isFastLocalDiscoveryTool } from "../src/cursor-tool-visibility.js";
import { buildCursorPiToolDisplay } from "../src/cursor-tool-transcript.js";

describe("cursor tool visibility classification", () => {
	it("classifies fast local discovery tools from the shared policy", () => {
		for (const name of ["read", "grep", "glob", "ls"]) {
			expect(isFastLocalDiscoveryTool({ name })).toBe(true);
			expect(classifyCursorToolVisibility({ name }).lifecycleEligible).toBe(false);
		}

		expect(isFastLocalDiscoveryTool({ name: "shell" })).toBe(false);
		expect(classifyCursorToolVisibility({ name: "shell" })).toMatchObject({
			normalizedName: "shell",
			activityTitle: "Cursor shell",
			incompleteTitle: "Cursor shell",
			lifecycleTitle: "Cursor shell",
			lifecycleEligible: true,
		});
	});

	it("uses replay display labels for lifecycle and incomplete activity titles", () => {
		expect(classifyCursorToolVisibility({ name: "mcp", args: { toolName: "git" } })).toMatchObject({
			normalizedName: "mcp",
			activityTitle: "Cursor MCP",
			incompleteTitle: "Cursor MCP",
			lifecycleTitle: "Cursor MCP",
			lifecycleEligible: true,
		});
		expect(classifyCursorToolVisibility({ name: "webSearch", args: { query: "pi" } })).toMatchObject({
			normalizedName: "webSearch",
			activityTitle: "Cursor web search",
			incompleteTitle: "Cursor web search",
			lifecycleTitle: "Cursor web search",
			lifecycleEligible: true,
		});
	});

	it("keeps completed replay activity titles on the shared classifier", () => {
		for (const toolCall of [
			{ name: "createPlan", args: { plan: "1. Test" }, result: { status: "success", value: {} } },
			{ name: "task", args: { description: "Explore repo" }, result: { status: "success", value: { text: "done" } } },
			{ name: "mcp", args: { toolName: "git" }, result: { status: "success", value: { content: "ok" } } },
			{ name: "generateImage", args: { prompt: "icon" }, result: { status: "success", value: {} } },
			{ name: "edit", args: { path: "src/index.ts" }, result: { status: "success", value: {} } },
			{ name: "write", args: { path: "new.txt" }, result: { status: "success", value: {} } },
		] as const) {
			const expectedTitle = classifyCursorToolVisibility(toolCall).activityTitle;
			const display = buildCursorPiToolDisplay(toolCall);
			expect(display.args.activityTitle).toBe(expectedTitle);
			if (toolCall.name === "generateImage") {
				expect(display.result.details).toMatchObject({
					variant: "generateImage",
				});
				expect(display.result.details).not.toHaveProperty("title");
			} else {
				expect(display.result.details).toMatchObject({ variant: "activity", title: expectedTitle });
			}
		}
	});
});
