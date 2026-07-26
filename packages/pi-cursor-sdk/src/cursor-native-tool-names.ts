import { CURSOR_REPLAY_ACTIVITY_TOOL_NAME } from "./cursor-tool-presentation-registry.js";

export const CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES = [CURSOR_REPLAY_ACTIVITY_TOOL_NAME] as const;
export const CURSOR_REPLAY_TOOL_NAMES = [CURSOR_REPLAY_ACTIVITY_TOOL_NAME] as const;
export const BUILTIN_NATIVE_CURSOR_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export const NATIVE_CURSOR_TOOL_NAMES = [
	...BUILTIN_NATIVE_CURSOR_TOOL_NAMES,
	...CURSOR_REPLAY_TOOL_NAMES,
] as readonly NativeCursorToolName[];

export type BuiltinNativeCursorToolName = typeof BUILTIN_NATIVE_CURSOR_TOOL_NAMES[number];
export type NativeCursorToolName = BuiltinNativeCursorToolName | typeof CURSOR_REPLAY_TOOL_NAMES[number];

export function isNativeCursorToolName(toolName: string): toolName is NativeCursorToolName {
	return NATIVE_CURSOR_TOOL_NAMES.some((nativeToolName) => nativeToolName === toolName);
}
