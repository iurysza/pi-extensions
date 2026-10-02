// Startup-light replay tool name helpers. Keep free of heavy imports: the extension entry
// loads this module synchronously, while the full presentation registry is loaded lazily.
export const CURSOR_REPLAY_ACTIVITY_TOOL_NAME = "cursor" as const;

export type CursorReplayToolName = typeof CURSOR_REPLAY_ACTIVITY_TOOL_NAME;

export function isCursorReplayToolName(toolName: string): toolName is CursorReplayToolName {
	return toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME;
}

export function isExcludedFromCursorBridgeExposure(toolName: string): boolean {
	return toolName === CURSOR_REPLAY_ACTIVITY_TOOL_NAME;
}
