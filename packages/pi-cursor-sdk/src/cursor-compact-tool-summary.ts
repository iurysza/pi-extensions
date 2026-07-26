import { isAbsolute, relative, win32 } from "node:path";
import { asRecord, getRecord, getString } from "./cursor-record-utils.js";
import { formatDisplayPath } from "./cursor-transcript-utils.js";

export interface CursorCompactToolSummaryOptions {
	cwd?: string;
}

function isWindowsAbsolutePath(path: string): boolean {
	return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

export function formatCursorCompactToolPath(path: string | undefined, options: CursorCompactToolSummaryOptions): string | undefined {
	const trimmed = path?.trim();
	if (!trimmed) return undefined;
	const normalized = trimmed.replace(/\\/g, "/");
	if (normalized === "~" || normalized.startsWith("~/") || /^~[^/]+(?:\/|$)/.test(normalized)) return undefined;
	if (normalized.split("/").includes("..")) return undefined;
	if (/^[A-Za-z]:(?!\/)/.test(normalized)) return undefined;
	if (isWindowsAbsolutePath(trimmed)) {
		const cwd = options.cwd;
		if (!cwd || !isWindowsAbsolutePath(cwd)) return undefined;
		const relativePath = win32.relative(cwd, trimmed);
		if (!relativePath || relativePath.startsWith("..") || isWindowsAbsolutePath(relativePath)) return undefined;
		return relativePath.replace(/\\/g, "/");
	}
	if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)) return undefined;
	if (isAbsolute(trimmed)) {
		const cwd = options.cwd;
		if (!cwd) return undefined;
		const relativePath = relative(cwd, trimmed);
		if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
		return relativePath.replace(/\\/g, "/");
	}
	return formatDisplayPath(normalized, options.cwd);
}

function getNestedRecord(record: Record<string, unknown> | undefined, ...keys: string[]): Record<string, unknown> | undefined {
	let current = record;
	for (const key of keys) {
		current = getRecord(current, key);
		if (!current) return undefined;
	}
	return current;
}

function summarizeShellTool(args: Record<string, unknown> | undefined, resultValue: Record<string, unknown> | undefined): string {
	const command = getString(args, "command");
	const stdout = getString(resultValue, "stdout");
	const stderr = getString(resultValue, "stderr");
	return [command ? `$ ${command}` : "shell", stdout, stderr].filter((part): part is string => Boolean(part)).join("\n");
}

export function summarizeCursorCompactToolCall(
	toolName: string | undefined,
	args: Record<string, unknown> | undefined,
	result: Record<string, unknown> | undefined,
	options: CursorCompactToolSummaryOptions,
): string | undefined {
	if (!toolName) return undefined;
	const compactName = toolName.replace(/\s+/g, " ").trim() || "unknown";
	if (compactName === "shell") return summarizeShellTool(args, getNestedRecord(result, "value"));

	const path = formatCursorCompactToolPath(getString(args, "path"), options);
	if (path) return `${compactName} ${path}`;
	const query = getString(args, "query") ?? getString(args, "pattern");
	if (query) return `${compactName} ${query}`;
	return compactName;
}

export function summarizeCursorCompactConversationToolCall(step: unknown, options: CursorCompactToolSummaryOptions): string | undefined {
	const record = asRecord(step);
	if (getString(record, "type") !== "toolCall") return undefined;
	const message = getRecord(record, "message");
	return summarizeCursorCompactToolCall(
		getString(message, "type"),
		getRecord(message, "args"),
		getRecord(message, "result"),
		options,
	);
}
