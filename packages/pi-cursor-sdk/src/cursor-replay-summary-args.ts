/**
 * Typed replay summary argument payloads shared by the presentation registry
 * and transcript replay builders.
 */

export interface CursorReplayActivitySummaryOverride {
	activitySummary?: string;
}

export interface CursorReplayPathSummaryArgs extends CursorReplayActivitySummaryOverride {
	path?: string;
}

export interface CursorReplayReadLintsSummaryArgs extends CursorReplayActivitySummaryOverride {
	paths?: string[];
	path?: string;
	diagnosticCount?: number;
}

export interface CursorReplayTodoSummaryArgs extends CursorReplayActivitySummaryOverride {
	totalCount?: number;
	completedCount?: number;
	inProgressCount?: number;
	pendingCount?: number;
}

export interface CursorReplayPlanSummaryArgs extends CursorReplayTodoSummaryArgs {
	planTitle?: string;
}

export interface CursorReplayTaskSummaryArgs extends CursorReplayActivitySummaryOverride {
	description?: string;
	preview?: string;
	subagentName?: string;
	subagentKind?: string;
	model?: string;
	agentId?: string;
	isBackground?: boolean;
}

export interface CursorReplayGenerateImageSummaryArgs extends CursorReplayActivitySummaryOverride {
	path?: string;
	prompt?: string;
}

export interface CursorReplayMcpSummaryArgs extends CursorReplayActivitySummaryOverride {
	toolName?: string;
	preview?: string;
}

export interface CursorReplaySemSearchSummaryArgs extends CursorReplayActivitySummaryOverride {
	query?: string;
	targetDirectories?: string[];
}

export interface CursorReplayRecordScreenSummaryArgs extends CursorReplayActivitySummaryOverride {
	mode?: string;
	path?: string;
	recordingDurationMs?: number;
}

export interface CursorReplayWebSearchSummaryArgs extends CursorReplayActivitySummaryOverride {
	query?: string;
}

export interface CursorReplayWebFetchSummaryArgs extends CursorReplayActivitySummaryOverride {
	url?: string;
}

export interface CursorReplayNeutralActivitySummaryArgs extends CursorReplayActivitySummaryOverride {
	path?: string;
	toolName?: string;
	query?: string;
	targetDirectories?: string[];
}

export type CursorReplaySummaryArgs =
	| CursorReplayPathSummaryArgs
	| CursorReplayReadLintsSummaryArgs
	| CursorReplayTodoSummaryArgs
	| CursorReplayPlanSummaryArgs
	| CursorReplayTaskSummaryArgs
	| CursorReplayGenerateImageSummaryArgs
	| CursorReplayMcpSummaryArgs
	| CursorReplaySemSearchSummaryArgs
	| CursorReplayRecordScreenSummaryArgs
	| CursorReplayWebSearchSummaryArgs
	| CursorReplayWebFetchSummaryArgs
	| CursorReplayNeutralActivitySummaryArgs;

export function readCursorReplaySummaryString(
	args: CursorReplaySummaryArgs | undefined,
	key: string,
): string | undefined {
	const value = args?.[key as keyof CursorReplaySummaryArgs];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readCursorReplaySummaryNumber(
	args: CursorReplaySummaryArgs | undefined,
	key: string,
): number | undefined {
	const value = args?.[key as keyof CursorReplaySummaryArgs];
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readCursorReplaySummaryStringArray(
	args: CursorReplaySummaryArgs | undefined,
	key: string,
): string[] {
	const value = args?.[key as keyof CursorReplaySummaryArgs];
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function formatReplayRecordingDurationMs(ms: number | undefined): string | undefined {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return undefined;
	if (ms < 1000) return `${Math.round(ms)}ms`;
	const seconds = ms / 1000;
	return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function summarizeReplayPath(args: CursorReplayPathSummaryArgs | undefined): string | undefined {
	return readCursorReplaySummaryString(args, "path") ?? "unknown";
}

export function summarizeReplayReadLints(args: CursorReplayReadLintsSummaryArgs | undefined): string | undefined {
	const paths = readCursorReplaySummaryStringArray(args, "paths");
	const path = readCursorReplaySummaryString(args, "path");
	const diagnosticCount = readCursorReplaySummaryNumber(args, "diagnosticCount");
	const target = paths.length > 0 ? paths.join(", ") : path;
	if (target && diagnosticCount !== undefined) {
		return `${diagnosticCount} diagnostic${diagnosticCount === 1 ? "" : "s"} in ${target}`;
	}
	return target;
}

export function summarizeReplayTodoCount(args: CursorReplayTodoSummaryArgs | undefined): string | undefined {
	const totalCount = readCursorReplaySummaryNumber(args, "totalCount");
	const completedCount = readCursorReplaySummaryNumber(args, "completedCount");
	const inProgressCount = readCursorReplaySummaryNumber(args, "inProgressCount");
	const pendingCount = readCursorReplaySummaryNumber(args, "pendingCount");
	if (totalCount !== undefined && completedCount !== undefined) {
		const parts = [`${completedCount}/${totalCount} completed`];
		if (inProgressCount && inProgressCount > 0) parts.push(`${inProgressCount} in progress`);
		if (pendingCount && pendingCount > 0) parts.push(`${pendingCount} pending`);
		return parts.join(", ");
	}
	return totalCount !== undefined ? `${totalCount} item${totalCount === 1 ? "" : "s"}` : undefined;
}

export function summarizeReplayPlan(args: CursorReplayPlanSummaryArgs | undefined): string | undefined {
	return readCursorReplaySummaryString(args, "planTitle") ?? summarizeReplayTodoCount(args);
}

export function summarizeReplayTask(args: CursorReplayTaskSummaryArgs | undefined): string | undefined {
	const description = readCursorReplaySummaryString(args, "description");
	const preview = readCursorReplaySummaryString(args, "preview");
	const subagentName = readCursorReplaySummaryString(args, "subagentName");
	const subagentKind = readCursorReplaySummaryString(args, "subagentKind");
	const model = readCursorReplaySummaryString(args, "model");
	const agentId = readCursorReplaySummaryString(args, "agentId");
	const metadataParts = [
		subagentKind,
		model,
		agentId ? `ID: ${agentId}` : undefined,
		args?.isBackground === true ? "backgrounded" : undefined,
	].filter((part): part is string => Boolean(part));
	const subjectParts = [description].filter((part): part is string => Boolean(part));
	const subject = subjectParts.length > 0 ? subjectParts.join(" · ") : undefined;
	const head = metadataParts.length > 0 ? [subject, ...metadataParts].filter(Boolean).join(" · ") : subject;
	if (metadataParts.length > 0) return head;
	if (head && preview && preview !== description && preview !== subagentName) return `${head}: ${preview}`;
	return head ?? preview;
}

export function summarizeReplayMcp(args: CursorReplayMcpSummaryArgs | undefined): string | undefined {
	const toolName = readCursorReplaySummaryString(args, "toolName") ?? "mcp";
	const preview = readCursorReplaySummaryString(args, "preview");
	return preview && preview !== toolName ? `${toolName} · ${preview}` : toolName;
}

export function summarizeReplayRecordScreen(args: CursorReplayRecordScreenSummaryArgs | undefined): string | undefined {
	const path = readCursorReplaySummaryString(args, "path");
	const duration = formatReplayRecordingDurationMs(readCursorReplaySummaryNumber(args, "recordingDurationMs"));
	if (path && duration) return `${path} · ${duration}`;
	return path ?? readCursorReplaySummaryString(args, "mode");
}

export function formatReplaySemSearchQuery(args: CursorReplaySemSearchSummaryArgs | undefined): string | undefined {
	const query = readCursorReplaySummaryString(args, "query");
	if (!query) return undefined;
	const targetDirectories = readCursorReplaySummaryStringArray(args, "targetDirectories");
	const dirHint =
		targetDirectories.length > 0 ? ` (${targetDirectories.length} dir${targetDirectories.length === 1 ? "" : "s"})` : "";
	return `${query}${dirHint}`;
}

export function summarizeReplayGenericActivity(args: CursorReplayNeutralActivitySummaryArgs | undefined): string | undefined {
	return (
		readCursorReplaySummaryString(args, "path")
		?? readCursorReplaySummaryString(args, "toolName")
		?? formatReplaySemSearchQuery(args)
	);
}

export function withActivitySummaryFallback<T extends CursorReplayActivitySummaryOverride>(
	buildSummary: (args: T | undefined) => string | undefined,
): (args: T | undefined) => string | undefined {
	return (args) => readCursorReplaySummaryString(args, "activitySummary") ?? buildSummary(args);
}
