import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ATTENTION_TOOL_LABELS = new Map<string, string>([
	["ask_user", "question"],
	["ask_user_question", "question"],
	["choose_visual_artifact_direction", "choose visual direction"],
	["plannotator_submit_plan", "review plan"],
	["cursor_ask_question", "question"],
]);

const PERMISSION_REQUEST_EVENT = "permissions:request";
const PERMISSION_RESOLVED_EVENT = "permissions:resolved";
const PERMISSION_KEY = "permission";

type ToolExecutionEvent = {
	toolCallId: string;
	toolName: string;
	args?: unknown;
};

type PermissionEvent = {
	sessionId: string;
};

export function attentionLabelForTool(event: ToolExecutionEvent): string | undefined {
	const label = ATTENTION_TOOL_LABELS.get(event.toolName);
	if (label) return label;

	if (
		event.toolName === "subagent" &&
		event.args !== null &&
		typeof event.args === "object" &&
		(event.args as { clarify?: unknown }).clarify === true
	) {
		return "configure subagents";
	}

	return undefined;
}

export default function herdrAttention(pi: ExtensionAPI): void {
	const activeWaits = new Set<string>();

	function begin(key: string, label: string): void {
		if (activeWaits.has(key)) return;
		activeWaits.add(key);
		pi.events.emit("herdr:blocked", { active: true, label });
	}

	function end(key: string): void {
		if (!activeWaits.delete(key)) return;
		pi.events.emit("herdr:blocked", { active: false });
	}

	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		const toolEvent = event as ToolExecutionEvent;
		const label = attentionLabelForTool(toolEvent);
		if (label) begin(`tool:${toolEvent.toolCallId}`, label);
	});

	pi.on("tool_execution_end", (event) => {
		end(`tool:${(event as ToolExecutionEvent).toolCallId}`);
	});

	pi.events.on(PERMISSION_REQUEST_EVENT, (event) => {
		const { sessionId } = event as PermissionEvent;
		begin(`${PERMISSION_KEY}:${sessionId}`, "permission");
	});

	pi.events.on(PERMISSION_RESOLVED_EVENT, (event) => {
		const { sessionId } = event as PermissionEvent;
		end(`${PERMISSION_KEY}:${sessionId}`);
	});

	pi.on("session_shutdown", () => {
		for (const key of activeWaits) end(key);
	});
}
