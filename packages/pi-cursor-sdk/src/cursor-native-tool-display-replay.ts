import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CursorReplayToolName } from "./cursor-tool-presentation-registry.js";

// Card drawing for replayed Cursor tools lives in @iurysza/pi-ext (tidy). This package only supplies data.
export type {
	CursorReplayNativeEditDetails,
	CursorReplayGenerateImageDetails,
	CursorReplayGenericFallbackDetails,
	CursorReplayActivityDetails,
	CursorReplayToolDetails,
	CursorReplayNativeWriteDetails,
} from "./cursor-replay-tool-details.js";
export {
	isCursorReplayNativeEditDetails,
	isCursorReplayGenerateImageDetails,
	isCursorReplayActivityDetails,
	isCursorReplayNativeWriteDetails,
	parseCursorReplayToolDetails,
} from "./cursor-replay-tool-details.js";

export const cursorReplayToolSchema = Type.Object({}, { additionalProperties: true });

export function createCursorReplayOnlyToolDefinition(toolName: CursorReplayToolName): ToolDefinition<typeof cursorReplayToolSchema, unknown> {
	return {
		name: toolName,
		label: "Cursor activity",
		description: "Display recorded Cursor SDK tool activity. This tool only returns recorded Cursor results and never executes work directly.",
		parameters: cursorReplayToolSchema,
		async execute() {
			throw new Error("No recorded Cursor activity result was available. This replay-only tool does not execute work directly.");
		},
	};
}
