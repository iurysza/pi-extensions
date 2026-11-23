import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * `pi.session` is the session's human name: herdr-t3 shows it as the agent's title (Inbox, Agents, tabs).
 * The session file path goes under its own key so it never reaches a title.
 */
export const SESSION_LABEL_KEY = "pi.session";
export const SESSION_FILE_LABEL_KEY = "pi.session.file";

type Facts = { file?: string | undefined; name?: string | undefined };

/** `hc label` args for the facts given; a fact passed as undefined clears its label, a missing one leaves it. */
export function sessionLabelArgs(terminal: string | undefined, facts: Facts): string[] | undefined {
	if (!terminal) return undefined;
	const pairs: string[] = [];
	if ("file" in facts) pairs.push(`${SESSION_FILE_LABEL_KEY}=${facts.file ?? ""}`);
	if ("name" in facts) pairs.push(`${SESSION_LABEL_KEY}=${facts.name?.trim() ?? ""}`);
	return pairs.length ? ["label", terminal, ...pairs] : undefined;
}

export default function herdrSessionLabel(pi: ExtensionAPI): void {
	const publish = (facts: Facts) => {
		const args = sessionLabelArgs(process.env.HC_TERMINAL_ID, facts);
		if (args) execFile("hc", args, () => {});
	};
	// Fires on startup, /new, /resume, fork and reload: the labels always follow the live session.
	pi.on("session_start", (_event, ctx) =>
		publish({
			file: ctx.sessionManager.getSessionFile?.() ?? undefined,
			name: ctx.sessionManager.getSessionName?.() ?? undefined,
		}),
	);
	pi.on("session_info_changed", (event) => publish({ name: event.name ?? undefined }));
	pi.on("session_shutdown", (event) => {
		if (event.reason === "quit") publish({ file: undefined, name: undefined });
	});
}
