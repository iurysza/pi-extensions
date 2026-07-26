/** Canonical Cursor settingSources parsing (parity-tested by provider runtime and maintainer scripts). */
export const CURSOR_SETTING_SOURCES_ENV = "PI_CURSOR_SETTING_SOURCES";
export const DEFAULT_CURSOR_SETTING_SOURCES = Object.freeze(["all"]);

export function resolveCursorSettingSources(raw) {
	const trimmed = raw?.trim();
	if (!trimmed) return [...DEFAULT_CURSOR_SETTING_SOURCES];
	const normalized = trimmed.toLowerCase();
	if (["0", "false", "off", "none", "omit", "disabled"].includes(normalized)) return undefined;
	if (["1", "true", "on", "all"].includes(normalized)) return ["all"];
	const sources = trimmed
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (sources.length === 0) return undefined;
	return sources;
}

/** Serialize parsed settingSources for PI_CURSOR_SETTING_SOURCES (undefined => explicit none). */
export function serializeCursorSettingSources(settingSources) {
	if (settingSources === undefined || settingSources.length === 0) return "none";
	return settingSources.join(",");
}
