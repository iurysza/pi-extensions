/**
 * Render pi-vcc's buildSections() output as an uncapped summary.
 *
 * pi-vcc 0.11 renamed its section fields (sessionGoal/outstandingContext/
 * userPreferences became earlyRequests/commits/userMessages/trackedCommands).
 * Reading the old names gave undefined and crashed /handoff with
 * "Cannot read properties of undefined (reading 'length')". Missing fields are
 * now treated as empty, so a future rename drops a section instead of crashing.
 */
import type { VccSections } from "@sting8k/pi-vcc/src/core/build-sections";

const SECTION_TITLES: ReadonlyArray<[keyof VccSections, string]> = [
	["earlyRequests", "Early Session Requests"],
	["filesAndChanges", "Files And Changes"],
	["commits", "Commits"],
	["trackedCommands", "Tracked Commands"],
	["userMessages", "User Messages"],
];

function section(title: string, items: unknown): string {
	if (!Array.isArray(items) || items.length === 0) return "";
	return `[${title}]\n${items.map((i) => `- ${i}`).join("\n")}`;
}

/** Joins header sections and the full brief transcript. Returns "" when empty. */
export function renderVccSections(data: Partial<VccSections> | null | undefined): string {
	if (!data) return "";
	const headers = SECTION_TITLES.map(([key, title]) => section(title, data[key])).filter(Boolean);
	const parts: string[] = [];
	if (headers.length > 0) parts.push(headers.join("\n\n"));
	if (typeof data.briefTranscript === "string" && data.briefTranscript) parts.push(data.briefTranscript);
	return parts.join("\n\n---\n\n");
}
