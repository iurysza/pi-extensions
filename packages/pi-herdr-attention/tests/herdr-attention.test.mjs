import assert from "node:assert/strict";
import { describe, it } from "node:test";
import herdrAttention, { attentionLabelForTool } from "../src/index.ts";

function createHarness() {
	const handlers = new Map();
	const events = new Map();
	const emitted = [];
	const pi = {
		on: (name, handler) => handlers.set(name, handler),
		events: {
			on: (name, handler) => events.set(name, handler),
			emit: (name, data) => emitted.push({ name, data }),
		},
	};

	herdrAttention(pi);
	return { handlers, events, emitted };
}

describe("Herdr attention", () => {
	it("labels known interactive tools and explicit subagent clarification", () => {
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "ask_user" }), "question");
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "choose_visual_artifact_direction" }), "choose visual direction");
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "plannotator_submit_plan" }), "review plan");
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "cursor_ask_question" }), "question");
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "subagent", args: { clarify: true } }), "configure subagents");
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "subagent", args: { clarify: false } }), undefined);
		assert.equal(
			attentionLabelForTool({
				toolCallId: "1",
				toolName: "bash",
				args: {
					command: "plannotator setup-goal interview ai-artifacts/goals/new-feature/interview.json --json > ai-artifacts/goals/new-feature/interview-result.json",
				},
			}),
			"answer goal interview",
		);
		assert.equal(
			attentionLabelForTool({
				toolCallId: "1",
				toolName: "bash",
				args: { command: "plannotator annotate ai-artifacts/goals/new-feature/plan.md --gate" },
			}),
			undefined,
		);
		assert.equal(
			attentionLabelForTool({
				toolCallId: "1",
				toolName: "bash",
				args: { command: "plannotator setup-goal facts ai-artifacts/goals/new-feature/facts-review.json --json" },
			}),
			undefined,
		);
		assert.equal(attentionLabelForTool({ toolCallId: "1", toolName: "bash" }), undefined);
	});

	it("blocks while an interactive tool is open and clears when it finishes", () => {
		const { handlers, emitted } = createHarness();
		const ctx = { mode: "tui" };

		handlers.get("tool_execution_start")({ toolCallId: "ask-1", toolName: "ask_user" }, ctx);
		handlers.get("tool_execution_end")({ toolCallId: "ask-1", toolName: "ask_user" }, ctx);

		assert.deepEqual(emitted, [
			{ name: "herdr:blocked", data: { active: true, label: "question" } },
			{ name: "herdr:blocked", data: { active: false } },
		]);
	});

	it("clears a Plannotator goal interview wait when bash finishes", () => {
		const { handlers, emitted } = createHarness();
		const event = {
			toolCallId: "interview-1",
			toolName: "bash",
			args: {
				command: "plannotator setup-goal interview ai-artifacts/goals/new-feature/interview.json --json > ai-artifacts/goals/new-feature/interview-result.json",
			},
		};

		handlers.get("tool_execution_start")(event, { mode: "tui" });
		handlers.get("tool_execution_end")(event, { mode: "tui" });

		assert.deepEqual(emitted, [
			{ name: "herdr:blocked", data: { active: true, label: "answer goal interview" } },
			{ name: "herdr:blocked", data: { active: false } },
		]);
	});

	it("does not report interactive waits outside a terminal UI", () => {
		const { handlers, emitted } = createHarness();

		handlers.get("tool_execution_start")({ toolCallId: "ask-1", toolName: "ask_user" }, { mode: "print" });
		handlers.get("tool_execution_end")({ toolCallId: "ask-1", toolName: "ask_user" }, { mode: "print" });

		assert.deepEqual(emitted, []);
	});

	it("uses permission lifecycle events and clears unfinished waits on shutdown", () => {
		const { handlers, events, emitted } = createHarness();

		events.get("permissions:request")({ sessionId: "session-1" });
		events.get("permissions:resolved")({ sessionId: "session-1" });
		handlers.get("tool_execution_start")(
			{
				toolCallId: "interview-1",
				toolName: "bash",
				args: {
					command: "plannotator setup-goal interview ai-artifacts/goals/new-feature/interview.json --json > ai-artifacts/goals/new-feature/interview-result.json",
				},
			},
			{ mode: "tui" },
		);
		handlers.get("session_shutdown")({}, { mode: "tui" });

		assert.deepEqual(emitted, [
			{ name: "herdr:blocked", data: { active: true, label: "permission" } },
			{ name: "herdr:blocked", data: { active: false } },
			{ name: "herdr:blocked", data: { active: true, label: "answer goal interview" } },
			{ name: "herdr:blocked", data: { active: false } },
		]);
	});
});
