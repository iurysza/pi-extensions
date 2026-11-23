import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Label that tells Herdr which session file this terminal's agent is writing. */
export const SESSION_LABEL_KEY = "pi.session";

export function sessionLabelArgs(terminal: string | undefined, file: string | undefined): string[] | undefined {
	if (!terminal) return undefined;
	return ["label", terminal, `${SESSION_LABEL_KEY}=${file ?? ""}`];
}

export default function herdrSessionLabel(pi: ExtensionAPI): void {
	const publish = (file: string | undefined) => {
		const args = sessionLabelArgs(process.env.HC_TERMINAL_ID, file);
		if (args) execFile("hc", args, () => {});
	};
	// Fires on startup, /new, /resume, fork and reload: the label always follows the live file.
	pi.on("session_start", (_event, ctx) => publish(ctx.sessionManager.getSessionFile?.() ?? undefined));
	pi.on("session_shutdown", (event) => {
		if (event.reason === "quit") publish(undefined);
	});
}
