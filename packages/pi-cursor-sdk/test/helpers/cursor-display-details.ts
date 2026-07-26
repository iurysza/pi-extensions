import type { CursorPiToolDisplay } from "../../src/cursor-transcript-utils.js";

export function getCursorDisplayDetailSummary(display: CursorPiToolDisplay): string | undefined {
	const details = display.result.details;
	if (!details || typeof details !== "object" || !("summary" in details)) {
		return undefined;
	}
	const summary = (details as { summary?: unknown }).summary;
	return typeof summary === "string" ? summary : undefined;
}
