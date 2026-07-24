/**
 * Terminal multiplexer abstraction — herder, tmux, or cmux.
 *
 * Detects which multiplexer is active and provides a unified API
 * for creating splits, tabs, and sending text to panes/surfaces.
 *
 * Gracefully degrades: returns null when none of herder, tmux, or cmux
 * is available.
 *
 * Precedence: herder → tmux → cmux. When the agent runs inside a
 * Herdr-managed pane (HERDR_ENV=1) we always use Herdr so the spawned
 * pi shows up as a tracked agent in the Herdr sidebar. Herdr can itself
 * live inside an outer tmux; we treat the Herdr split as authoritative.
 */

export type MultiplexerType = "herder" | "tmux" | "cmux";

import { execSync } from "node:child_process";
import { writeFileSync, chmodSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SplitTarget {
	type: "split" | "tab";
	id: string; // herder pane_id (w1:p2), tmux pane_id, or cmux surface_id
}

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function isHerder(): boolean {
	return process.env.HERDR_ENV === "1";
}

function isTmux(): boolean {
	return !!process.env.TMUX;
}

function isCmux(): boolean {
	return !!process.env.CMUX_SOCKET_PATH;
}

export function detectMultiplexer(): MultiplexerType | null {
	if (isHerder()) return "herder";
	if (isTmux()) return "tmux";
	if (isCmux()) return "cmux";
	return null;
}

// ── tmux implementations ──

function tmuxSplit(direction: "right" | "down" = "right"): SplitTarget | null {
	try {
		const flag = direction === "right" ? "-h" : "-v";
		const cwd = shellQuote(process.cwd());
		const paneId = execSync(`tmux split-window ${flag} -c ${cwd} -P -F '#{pane_id}'`, { encoding: "utf8" }).trim();
		return { type: "split", id: paneId };
	} catch {
		return null;
	}
}

function tmuxTab(name?: string): SplitTarget | null {
	try {
		const cwd = shellQuote(process.cwd());
		const paneId = execSync(`tmux new-window -c ${cwd} -P -F '#{pane_id}'`, { encoding: "utf8" }).trim();
		if (name) {
			execSync(`tmux rename-window ${shellQuote(name)}`);
		}
		return { type: "tab", id: paneId };
	} catch {
		return null;
	}
}

function tmuxSendKeys(paneId: string, text: string): void {
	const MAX_SEND_KEYS = 800; // tmux send-keys has practical limits
	if (text.length <= MAX_SEND_KEYS) {
		execSync(`tmux send-keys -t ${paneId} ${shellQuote(text)} Enter`);
		return;
	}

	// For long commands, write to a temp script and execute it
	const tmpFile = join(tmpdir(), `pi-handoff-${Date.now()}.sh`);
	writeFileSync(tmpFile, `#!/bin/bash\n${text}\n`);
	chmodSync(tmpFile, 0o755);
	try {
		execSync(`tmux send-keys -t ${paneId} ${shellQuote(tmpFile)} Enter`);
	} finally {
		setTimeout(() => {
			try { unlinkSync(tmpFile); } catch {}
		}, 30000);
	}
}

// ── herder implementations ──

// Herdr prints JSON by default. `herdr pane split` returns {result.pane.pane_id};
// `herdr tab create` returns {result.root_pane.pane_id}. Panes inherit the caller's
// cwd by default, but we pass --cwd explicitly for parity with tmux/cmux.
function herderPaneIdFromJson(out: string, path: string[]): string | null {
	try {
		const parsed = JSON.parse(out);
		const result = parsed?.result;
		if (!result) return null;
		let node: unknown = result;
		for (const key of path) {
			if (typeof node !== "object" || node === null) return null;
			node = (node as Record<string, unknown>)[key];
		}
		return typeof node === "string" ? node : null;
	} catch {
		return null;
	}
}

function herderSplit(direction: "right" | "down" = "right"): SplitTarget | null {
	try {
		const cwd = shellQuote(process.cwd());
		const out = execSync(
			`herdr pane split --current --direction ${direction} --cwd ${cwd} --no-focus`,
			{ encoding: "utf8" },
		).trim();
		const paneId = herderPaneIdFromJson(out, ["pane", "pane_id"]);
		if (!paneId) return null;
		return { type: "split", id: paneId };
	} catch {
		return null;
	}
}

function herderTab(name?: string): SplitTarget | null {
	try {
		const cwd = shellQuote(process.cwd());
		const labelArg = name ? ` --label ${shellQuote(name)}` : "";
		const out = execSync(`herdr tab create --cwd ${cwd}${labelArg} --no-focus`, {
			encoding: "utf8",
		}).trim();
		// Tab create returns the root pane id directly; no second lookup needed.
		const paneId = herderPaneIdFromJson(out, ["root_pane", "pane_id"]);
		if (!paneId) return null;
		return { type: "tab", id: paneId };
	} catch {
		return null;
	}
}

function herderSendKeys(paneId: string, text: string): void {
	// `herdr pane run` submits text plus Enter atomically; preferred over
	// send-text + send-keys enter. It takes the command as a single argv,
	// so long handoff prompts need no tmux-style temp-script fallback.
	execSync(`herdr pane run ${shellQuote(paneId)} ${shellQuote(text)}`);
}

// ── cmux implementations ──

function cmuxShellEscape(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function cmuxSplit(direction: "right" | "down" = "right"): SplitTarget | null {
	try {
		const out = execSync(`cmux new-split ${direction}`, { encoding: "utf8" }).trim();
		const match = out.match(/surface:\d+/);
		if (!match) return null;
		return { type: "split", id: match[0] };
	} catch {
		return null;
	}
}

function cmuxTab(name?: string): SplitTarget | null {
	try {
		const out = execSync("cmux new-tab", { encoding: "utf8" }).trim();
		const match = out.match(/surface:\d+/);
		if (!match) return null;
		if (name) {
			execSync(`cmux rename-tab --surface ${cmuxShellEscape(match[0])} ${cmuxShellEscape(name)}`);
		}
		return { type: "tab", id: match[0] };
	} catch {
		return null;
	}
}

function cmuxSendKeys(surfaceId: string, text: string): void {
	execSync(`cmux send --surface ${cmuxShellEscape(surfaceId)} ${cmuxShellEscape(text + "\n")}`);
}

// ── unified API ──

export function createSplit(direction: "right" | "down" = "right"): SplitTarget | null {
	const mux = detectMultiplexer();
	if (mux === "herder") return herderSplit(direction);
	if (mux === "tmux") return tmuxSplit(direction);
	if (mux === "cmux") return cmuxSplit(direction);
	return null;
}

export function createTab(name?: string): SplitTarget | null {
	const mux = detectMultiplexer();
	if (mux === "herder") return herderTab(name);
	if (mux === "tmux") return tmuxTab(name);
	if (mux === "cmux") return cmuxTab(name);
	return null;
}

export function sendKeys(target: SplitTarget, text: string): void {
	if (!target) return;
	const mux = detectMultiplexer();
	if (mux === "herder") herderSendKeys(target.id, text);
	if (mux === "tmux") tmuxSendKeys(target.id, text);
	if (mux === "cmux") cmuxSendKeys(target.id, text);
}

export function getMultiplexerName(): string {
	return detectMultiplexer() ?? "none";
}
