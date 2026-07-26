import { asRecord } from "./cursor-record-utils.js";
import type { CursorPiToolDisplay } from "./cursor-transcript-utils.js";
/** Provider-facing wrapper; canonical scrubbing lives in shared/cursor-sensitive-text.mjs. */
import { scrubSensitiveText as scrubSensitiveTextJs } from "../shared/cursor-sensitive-text.mjs";

export function scrubSensitiveText(text: string, apiKey?: string): string {
	return scrubSensitiveTextJs(text, apiKey);
}

function scrubDisplayValue(value: unknown, apiKey?: string): unknown {
	if (typeof value === "string") return scrubSensitiveText(value, apiKey);
	if (Array.isArray(value)) return value.map((entry) => scrubDisplayValue(entry, apiKey));
	const record = asRecord(value);
	if (!record) return value;
	return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, scrubDisplayValue(entry, apiKey)]));
}

export function scrubPiToolDisplay(display: CursorPiToolDisplay, apiKey?: string): CursorPiToolDisplay {
	return {
		...display,
		args: scrubDisplayValue(display.args, apiKey) as Record<string, unknown>,
		result: scrubDisplayValue(display.result, apiKey) as CursorPiToolDisplay["result"],
	};
}
