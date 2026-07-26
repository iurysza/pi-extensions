import { asRecord, getString } from "./cursor-record-utils.js";
import { normalizeCursorToolName } from "./cursor-tool-presentation-registry.js";
import {
	buildCursorPiToolDisplayFromSpec,
	formatCursorToolTranscriptFromSpec,
	type ToolDisplayContext,
} from "./cursor-transcript-tool-specs.js";
import {
	getToolArgs,
	getToolName,
	getToolResult,
	normalizeResult,
	type CursorPiToolDisplay,
	type TranscriptOptions,
} from "./cursor-transcript-utils.js";
import { resolveTranscriptToolName } from "./cursor-web-tool-activity.js";

export type { CursorPiToolDisplay } from "./cursor-transcript-utils.js";
export type { ToolDisplayContext } from "./cursor-transcript-tool-specs.js";

function buildToolDisplayContext(toolCall: unknown, options: TranscriptOptions = {}): ToolDisplayContext {
	const rawName = getToolName(toolCall);
	const args = getToolArgs(toolCall);
	return {
		rawName,
		name: resolveTranscriptToolName(rawName, args),
		args,
		result: normalizeResult(getToolResult(toolCall)),
		options,
	};
}

export function formatCursorToolTranscript(toolCall: unknown, options: TranscriptOptions = {}): string {
	return formatCursorToolTranscriptFromSpec(buildToolDisplayContext(toolCall, options));
}

export function buildCursorPiToolDisplay(toolCall: unknown, options: TranscriptOptions = {}): CursorPiToolDisplay {
	return buildCursorPiToolDisplayFromSpec(buildToolDisplayContext(toolCall, options));
}

export function getCursorCreatePlanText(toolCall: unknown): string | undefined {
	const name = normalizeCursorToolName(getToolName(toolCall));
	if (name !== "createPlan") return undefined;
	const args = getToolArgs(toolCall);
	const result = normalizeResult(getToolResult(toolCall));
	const plan = getString(args, "plan") ?? getString(asRecord(result.value), "plan");
	const trimmed = plan?.trim();
	return trimmed || undefined;
}
