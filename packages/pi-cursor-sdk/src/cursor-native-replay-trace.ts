import type { CursorPiToolDisplay } from "./cursor-transcript-utils.js";
import { asRecord } from "./cursor-record-utils.js";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";

function getCursorReplayResultText(display: CursorPiToolDisplay): string | undefined {
	for (const content of display.result.content) {
		if (content.type !== "text") continue;
		const text = truncateCursorDisplayLine(content.text);
		if (text) return text;
	}
	return undefined;
}

/** Unified inactive native-replay fallback: `title: summary` in thinking trace. */
export function formatInactiveCursorReplayTrace(display: CursorPiToolDisplay): string {
	const details = asRecord(display.result.details);
	const args = asRecord(display.args);
	const title = typeof details?.title === "string" && details.title.trim()
		? details.title.trim()
		: typeof args?.activityTitle === "string" && args.activityTitle.trim()
			? args.activityTitle.trim()
			: `Cursor ${display.toolName}`;
	const summary = typeof details?.summary === "string" && details.summary.trim()
		? details.summary.trim()
		: typeof args?.activitySummary === "string" && args.activitySummary.trim()
			? args.activitySummary.trim()
			: getCursorReplayResultText(display) ?? "completed";
	return `${truncateCursorDisplayLine(title)}: ${truncateCursorDisplayLine(summary)}\n`;
}
