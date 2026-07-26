import { asRecord } from "./cursor-record-utils.js";

const CURSOR_EDIT_DIFF_FIELD_ORDER = ["diffString", "diff", "unifiedDiff", "patch"] as const;

export function resolveCursorEditDiff(source: unknown): string | undefined {
	const record = asRecord(source);
	if (!record) return undefined;
	for (const key of CURSOR_EDIT_DIFF_FIELD_ORDER) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}
