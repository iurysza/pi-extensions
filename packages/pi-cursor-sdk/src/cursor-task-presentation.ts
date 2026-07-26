import { asRecord, getBoolean, getRecord, getString } from "./cursor-record-utils.js";

export const CURSOR_TASK_PRESENTATION_ENV = "PI_CURSOR_TASK_PRESENTATION";

export type CursorTaskPresentationMode = "task" | "subagent" | "subagent-meta";

const VALID_CURSOR_TASK_PRESENTATION_MODES = new Set<CursorTaskPresentationMode>([
	"task",
	"subagent",
	"subagent-meta",
]);

export function getCursorTaskPresentationMode(env: NodeJS.ProcessEnv = process.env): CursorTaskPresentationMode {
	const raw = env[CURSOR_TASK_PRESENTATION_ENV]?.trim();
	return raw && VALID_CURSOR_TASK_PRESENTATION_MODES.has(raw as CursorTaskPresentationMode)
		? (raw as CursorTaskPresentationMode)
		: "subagent-meta";
}

export interface CursorTaskMetadata {
	description?: string;
	subagentKind?: string;
	subagentName?: string;
	model?: string;
	agentId?: string;
	isBackground?: boolean;
}

export function getCursorTaskDescription(args: Record<string, unknown>, resultValue?: unknown): string {
	return getString(args, "description") ?? getString(asRecord(resultValue), "description") ?? "task";
}

export function readCursorTaskMetadata(args: Record<string, unknown>, resultValue?: unknown): CursorTaskMetadata {
	const subagentType = getRecord(args, "subagentType");
	const result = asRecord(resultValue);
	return {
		description: getCursorTaskDescription(args, resultValue),
		subagentKind: getString(subagentType, "kind"),
		subagentName: getString(subagentType, "name"),
		model: getString(args, "model"),
		agentId: getString(args, "agentId") ?? getString(result, "agentId"),
		isBackground: getBoolean(result, "isBackground"),
	};
}

function cleanMetadataValue(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed || undefined;
}

export function getCursorTaskActivityTitle(): string {
	return getCursorTaskPresentationMode() === "task" ? "Cursor task" : "Cursor subagent";
}

export function getCursorTaskTranscriptHeader(args: Record<string, unknown>, resultValue?: unknown): string {
	const metadata = readCursorTaskMetadata(args, resultValue);
	const description = cleanMetadataValue(metadata.description) ?? "task";
	const mode = getCursorTaskPresentationMode();
	if (mode === "task") return `task ${description}`;
	if (mode === "subagent-meta") {
		const subagentName = cleanMetadataValue(metadata.subagentName);
		return subagentName ? `subagent ${subagentName} ${description}` : `subagent ${description}`;
	}
	return `subagent ${description}`;
}

export function formatCursorTaskKind(value: string | undefined): string | undefined {
	const cleaned = cleanMetadataValue(value);
	if (!cleaned) return undefined;
	return cleaned.slice(0, 1).toUpperCase() + cleaned.slice(1);
}

export function formatCursorTaskAgentId(value: string | undefined): string | undefined {
	const cleaned = cleanMetadataValue(value);
	if (!cleaned || !/^[A-Za-z0-9_.:-]+$/.test(cleaned)) return undefined;
	return cleaned.length > 12 ? cleaned.slice(0, 8) : cleaned;
}
