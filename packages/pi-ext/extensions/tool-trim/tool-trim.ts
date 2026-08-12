import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Keep the useful semantic tools without paying prompt cost for the rest.
 *
 * Pi has no persistent per-tool disable, so reapply the filter every turn.
 * MCP aliases are filtered too in case another extension exposes them.
 */
const DROP = new Set(
	["sem_diff", "sem_eval", "sem_log", "sem_blame"].flatMap((name) => [name, `mcp__pi__${name}`]),
);

export default function (pi: ExtensionAPI) {
	const trim = () => {
		const active = pi.getActiveTools();
		const kept = active.filter((name) => !DROP.has(name));
		if (kept.length !== active.length) pi.setActiveTools(kept);
	};

	pi.on("session_start", trim);
	pi.on("turn_start", trim);
}
