export const CURSOR_REPLAY_SOURCE_TOOL_NAMES = [
	"read",
	"grep",
	"glob",
	"ls",
	"shell",
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
] as const;

export type CursorReplaySourceToolName = (typeof CURSOR_REPLAY_SOURCE_TOOL_NAMES)[number];
export type CursorReplayActivitySourceName = Exclude<CursorReplaySourceToolName, "generateImage">;

const CURSOR_REPLAY_SOURCE_TOOL_NAME_SET: ReadonlySet<string> = new Set(CURSOR_REPLAY_SOURCE_TOOL_NAMES);

export function isCursorReplaySourceToolName(name: string): name is CursorReplaySourceToolName {
	return CURSOR_REPLAY_SOURCE_TOOL_NAME_SET.has(name);
}

export function isCursorReplayActivitySourceName(name: string): name is CursorReplayActivitySourceName {
	return name !== "generateImage" && isCursorReplaySourceToolName(name);
}
