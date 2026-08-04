import { homedir } from "node:os";
import { relative, sep } from "node:path";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WORDMARK = [
	"██████   ██",
	"██   ██  ██",
	"██████   ██",
	"██       ██",
	"██       ██",
	"██       ██",
] as const;

const WORDMARK_WIDTH = Math.max(...WORDMARK.map((line) => visibleWidth(line)));
const WORDMARK_ROLES = ["mdLink", "mdHeading", "accent", "syntaxVariable"] as const;

function centerLine(text: string, width: number): string {
	if (width <= 0) return "";
	const fitted = truncateToWidth(text, width, "");
	const padding = Math.max(0, Math.floor((width - visibleWidth(fitted)) / 2));
	return `${" ".repeat(padding)}${fitted}`;
}

function paintWordmarkLine(line: string, theme: Theme): string {
	let painted = "";
	let segment = "";
	let previousRole: (typeof WORDMARK_ROLES)[number] | undefined;

	for (const [column, character] of [...line].entries()) {
		const roleIndex = Math.min(
			WORDMARK_ROLES.length - 1,
			Math.floor((column * WORDMARK_ROLES.length) / WORDMARK_WIDTH),
		);
		const role = WORDMARK_ROLES[roleIndex]!;
		if (previousRole !== undefined && role !== previousRole) {
			painted += theme.fg(previousRole, segment);
			segment = "";
		}
		segment += character;
		previousRole = role;
	}

	return previousRole === undefined ? painted : painted + theme.fg(previousRole, segment);
}

export function formatStartupPath(cwd: string, home = homedir()): string {
	const display = cwd === home
		? "~"
		: cwd.startsWith(`${home}${sep}`)
			? `~/${relative(home, cwd)}`
			: cwd;
	return display.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

export function renderStartupHeader(width: number, theme: Theme, cwd: string): string[] {
	const path = centerLine(theme.fg("muted", formatStartupPath(cwd)), width);
	if (width < WORDMARK_WIDTH) {
		return ["", centerLine(theme.bold(theme.fg("accent", "π")), width), "", path, ""];
	}

	const logo = WORDMARK.map((line) => centerLine(paintWordmarkLine(line, theme), width));
	return ["", ...logo, "", path, ""];
}

export default function startupScreen(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((_tui, theme) => ({
			render: (width: number) => renderStartupHeader(width, theme, ctx.cwd),
			invalidate() {},
		}));
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.setHeader(undefined);
	});
}
