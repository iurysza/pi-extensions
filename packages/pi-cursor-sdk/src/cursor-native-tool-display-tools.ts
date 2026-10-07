import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { getCursorSessionCwd } from "./cursor-session-scope.js";
import {
	BUILTIN_NATIVE_CURSOR_TOOL_NAMES,
	CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES,
	CURSOR_REPLAY_TOOL_NAMES,
	isNativeCursorToolName,
	NATIVE_CURSOR_TOOL_NAMES,
	type BuiltinNativeCursorToolName,
	type NativeCursorToolName,
} from "./cursor-native-tool-names.js";
import { isCursorReplayToolName } from "./cursor-tool-presentation-registry.js";
import { createCursorReplayOnlyToolDefinition } from "./cursor-native-tool-display-replay.js";
import {
	consumeCursorNativeToolDisplay,
	isCursorReplayToolCallId,
} from "./cursor-native-tool-display-state.js";


type AnyToolDefinition = ToolDefinition<TSchema, unknown, unknown>;
const NATIVE_CURSOR_TOOL_FACTORIES: Record<BuiltinNativeCursorToolName, (cwd: string) => AnyToolDefinition> = {
	read: (cwd) => createReadToolDefinition(cwd) as AnyToolDefinition,
	bash: (cwd) => createBashToolDefinition(cwd) as AnyToolDefinition,
	edit: (cwd) => createEditToolDefinition(cwd) as AnyToolDefinition,
	write: (cwd) => createWriteToolDefinition(cwd) as AnyToolDefinition,
	grep: (cwd) => createGrepToolDefinition(cwd) as AnyToolDefinition,
	find: (cwd) => createFindToolDefinition(cwd) as AnyToolDefinition,
	ls: (cwd) => createLsToolDefinition(cwd) as AnyToolDefinition,
};

export function wrapNativeCursorTool<TParams extends TSchema, TDetails, TState>(
	definition: ToolDefinition<TParams, TDetails, TState>,
	getCurrentDefinition: () => ToolDefinition<TParams, TDetails, TState>,
): ToolDefinition<TParams, TDetails, TState> {
	return {
		...definition,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const cursorDisplay = consumeCursorNativeToolDisplay(toolCallId);
			if (cursorDisplay) {
				if (cursorDisplay.isError) {
					const text = cursorDisplay.result.content
						.map((entry) => (entry.type === "text" ? entry.text : undefined))
						.filter((entry): entry is string => Boolean(entry))
						.join("\n");
					throw new Error(text || "Cursor tool replay failed");
				}
				return {
					content: cursorDisplay.result.content,
					details: cursorDisplay.result.details as TDetails,
					terminate: cursorDisplay.terminate ?? true,
				};
			}
			if (isCursorReplayToolCallId(toolCallId)) {
				throw new Error(`No recorded Cursor ${definition.name} result was available. This replay-only call never executes the underlying tool.`);
			}
			return getCurrentDefinition().execute(toolCallId, params, signal, onUpdate, ctx);
		},
	};
}

export function createNativeCursorToolDefinition(toolName: NativeCursorToolName, cwd: string): ToolDefinition<TSchema, unknown, unknown> {
	if (Object.hasOwn(NATIVE_CURSOR_TOOL_FACTORIES, toolName)) return NATIVE_CURSOR_TOOL_FACTORIES[toolName as BuiltinNativeCursorToolName](cwd);
	if (isCursorReplayToolName(toolName)) return createCursorReplayOnlyToolDefinition(toolName) as ToolDefinition<TSchema, unknown, unknown>;
	throw new Error(`Unsupported Cursor native replay tool: ${toolName}`);
}

export function registerNativeCursorTool(
	pi: Pick<import("@earendil-works/pi-coding-agent").ExtensionAPI, "registerTool">,
	toolName: NativeCursorToolName,
): void {
	const definition = createNativeCursorToolDefinition(toolName, getCursorSessionCwd());
	pi.registerTool(wrapNativeCursorTool(definition, () => createNativeCursorToolDefinition(toolName, getCursorSessionCwd())));
}

export { CURSOR_MODEL_ACTIVE_REPLAY_TOOL_NAMES, CURSOR_REPLAY_TOOL_NAMES };
