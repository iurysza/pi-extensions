/**
 * Pure rendering helpers for the custom footer.
 *
 * Each function produces a styled string segment — no side effects.
 * All colors are resolved via theme roles (no hardcoded ANSI).
 */

import { basename, dirname, isAbsolute, relative, sep } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import { THINKING_ROLES } from "../shared/thinking-colors.js";

type ThemeFg = { fg: (role: any, text: string) => string };

// ── Tokens ─────────────────────────────────────────────────────────────

export function fmtTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Path ───────────────────────────────────────────────────────────────

export function renderPath(
	pathRaw: string,
	budget: number,
	theme: ThemeFg,
): string {
	if (visibleWidth(pathRaw) <= budget) return theme.fg("text", pathRaw);
	const folders = pathRaw.split(sep).filter(Boolean);
	for (let start = 1; start < folders.length; start++) {
		const shortened = `…${sep}${folders.slice(start).join(sep)}`;
		if (visibleWidth(shortened) <= budget) return theme.fg("text", shortened);
	}
	const leaf = folders.at(-1) ?? pathRaw;
	if (visibleWidth(leaf) <= budget) return theme.fg("text", leaf);
	return "";
}

export function buildPathString(cwd: string, branch: string | null): string {
	let pwd = cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && pwd.startsWith(home)) pwd = `~${pwd.slice(home.length)}`;
	return pwd + (branch ? ` (${branch})` : "");
}

export function nearestAgentsFolder(files: readonly { path: string }[], cwd: string): string | undefined {
	let nearest: string | undefined;
	for (const file of files) {
		if (!/^AGENTS(?:\.override)?\.(?:md|MD)$/.test(basename(file.path))) continue;
		const folder = dirname(file.path);
		const below = relative(folder, cwd);
		if (below === ".." || below.startsWith(`..${sep}`) || isAbsolute(below)) continue;
		if (!nearest || folder.length > nearest.length) nearest = folder;
	}
	return nearest;
}

export function agentsFolderFromPrompt(prompt: string, cwd: string): string | undefined {
	// Pi exposes structured contextFiles before a turn, but only the rendered
	// system prompt during session_start. Read its loaded-file tags, not disk.
	const files = Array.from(prompt.matchAll(/^<project_instructions path="([^"\r\n]+)">\r?$/gm),
		match => ({ path: match[1] }));
	return nearestAgentsFolder(files, cwd);
}

// ── Context Usage ──────────────────────────────────────────────────────

export function renderContextUsage(
	pct: number,
	win: number,
	used: number | null,
	theme: { fg: (role: any, text: string) => string },
	compaction?: { enabled: boolean; reserveTokens: number },
): string {
	const filled = Math.min(5, Math.ceil(Math.max(0, pct) / 20));
	const role = used !== null && used >= 200_000 ? "warning" : "success";
	const threshold = Math.max(0, win - (compaction?.reserveTokens ?? 0));
	const remaining = used === null ? null : Math.max(0, threshold - used);
	const nearCompaction = compaction?.enabled && win > 0 && remaining !== null
		&& remaining <= threshold * 0.1;
	const label = nearCompaction ? `${fmtTokens(Math.floor(remaining))} left` : fmtTokens(win);
	return theme.fg(role, "▰".repeat(filled))
		+ theme.fg("dim", "▱".repeat(5 - filled) + ` ${label}`);
}

// ── Model + Thinking ───────────────────────────────────────────────────

// Three speedometer steps, doubled for max; the theme role (see THINKING_ROLES) separates levels that share one.
const THINKING_ICONS: Record<string, string> = {
	minimal: "\u{F0F86}", // md-speedometer_slow
	low:     "\u{F0F86}",
	medium:  "\u{F0F85}", // md-speedometer_medium
	high:    "\u{F04C5}", // md-speedometer
	xhigh:   "\u{F04C5}",
	max:     "\u{F04C5}\u{F04C5}", // doubled so it differs from xhigh
};

export function renderModelInfo(
	modelName: string,
	thinking: string,
	theme: ThemeFg,
): { text: string; rawWidth: number } {
	const icon = thinking !== "off" ? THINKING_ICONS[thinking] : undefined;
	const rawWidth = visibleWidth(`󱜙 ${modelName}${icon ? ` ${icon}` : ""}`);

	let text = theme.fg("accent", `󱜙 ${modelName}`);
	if (icon) {
		const role = THINKING_ROLES[thinking] ?? THINKING_ROLES.off;
		text += " " + theme.fg(role, icon);
	}

	return { text, rawWidth };
}

// ── Usage Bars (Line 2) ───────────────────────────────────────────────

export function clampPct(v: number): number {
	return Math.max(0, Math.min(100, Math.round(v)));
}

type ThemeRole = "success" | "warning" | "error";
function colorForPct(v: number): ThemeRole {
	return v >= 90 ? "error" : v >= 70 ? "warning" : "success";
}

const BAR_WIDTH = 8;

export function renderBar(
	pct: number,
	theme: { fg: (role: any, text: string) => string },
): string {
	const v = clampPct(pct);
	const filled = Math.round((v / 100) * BAR_WIDTH);
	return theme.fg(colorForPct(v), "█".repeat(filled))
		+ theme.fg("dim", "░".repeat(BAR_WIDTH - filled));
}

export function renderPct(
	pct: number,
	theme: { fg: (role: any, text: string) => string },
): string {
	const v = clampPct(pct);
	return theme.fg(colorForPct(v), `${v}%`.padStart(4));
}
