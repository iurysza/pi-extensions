/**
 * Custom Footer Extension — Two-line compact powerline style
 *
 * Line 1:  MODE  ~/path (branch) │ 42%/200k │ ended 3:59 pm · 1m 50s ago │ ⚡ model • thinking
 * Line 2: Extension statuses registered through ctx.ui.setStatus().
 *
 * Rendered as a belowEditor widget while the default footer is suppressed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PermissionMode } from "../permissions/permissions.js";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execSync } from "node:child_process";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import {
	buildPathString,
	fmtTokens,
	modePillWidth,
	renderContextUsage,
	renderModelInfo,
	renderModePill,
	renderPath,
} from "./renderers.js";



// ── Helpers ────────────────────────────────────────────────────────────

function getGitBranch(cwd: string): string | null {
	try {
		return execSync("git branch --show-current", { cwd, encoding: "utf-8", timeout: 500 }).trim() || null;
	} catch {
		return null;
	}
}

function formatResponseTime(endedAt: number): string {
	const time = new Date(endedAt).toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
		hour12: true,
	}).toLowerCase();
	const elapsedSeconds = Math.max(0, Math.floor((Date.now() - endedAt) / 1000));

	if (elapsedSeconds < 60) return `◷ ended ${time} · ${elapsedSeconds}s ago`;

	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) return `◷ ended ${time} · ${elapsedMinutes}m ${elapsedSeconds % 60}s ago`;

	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) return `◷ ended ${time} · ${elapsedHours}h ${elapsedMinutes % 60}m ago`;

	return `◷ ended ${time} · ${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h ago`;
}

// ── Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let currentMode: PermissionMode = "safe";
	let tuiRef: { requestRender(): void } | null = null;
	let footerDataRef: { getExtensionStatuses(): ReadonlyMap<string, string> } | null = null;
	let gitBranch: string | null = null;
	let gitWatcher: FSWatcher | undefined;
	let responseEndedAt: number | null = null;
	let responseAgeTimer: ReturnType<typeof setInterval> | undefined;

	pi.events.on("mode:change", (data: unknown) => {
		currentMode = data as PermissionMode;
		tuiRef?.requestRender();
	});

	pi.on("session_start", async (_event, ctx) => {
		responseAgeTimer = setInterval(() => {
			if (responseEndedAt !== null) tuiRef?.requestRender();
		}, 1000);
		responseAgeTimer.unref?.();

		// Get initial git branch
		gitBranch = getGitBranch(ctx.cwd);

		// Watch .git/HEAD for branch changes
		const headPath = join(ctx.cwd, ".git", "HEAD");
		if (existsSync(headPath)) {
			gitWatcher = watch(headPath, () => {
				gitBranch = getGitBranch(ctx.cwd);
				tuiRef?.requestRender();
			});
		}

		// Suppress the default footer, but retain its data provider so extension
		// statuses remain visible in our below-editor footer.
		ctx.ui.setFooter((_footerTui, _footerTheme, footerData) => {
			footerDataRef = footerData;
			return {
				render() { return []; },
				invalidate() { tuiRef?.requestRender(); },
			};
		});

		const setWidgetFn = ctx.ui.setWidget.bind(ctx.ui) as (
			name: string,
			content: unknown,
			options?: { placement?: string },
		) => void;

		setWidgetFn(
			"custom-footer",
			(_widgetTui: { requestRender(): void }, widgetTheme: any) => {
				tuiRef = _widgetTui;
				return {
					render(width: number): string[] {
						const lines = [renderLine1(width, widgetTheme, ctx)];
						const statusLine = renderExtensionStatuses(width);
						if (statusLine) lines.push(statusLine);
						return lines;
					},
					invalidate() {},
				};
			},
			{ placement: "belowEditor" },
		);
	});

	pi.on("agent_start", () => {
		responseEndedAt = null;
		tuiRef?.requestRender();
	});

	pi.on("agent_end", () => {
		responseEndedAt = Date.now();
		tuiRef?.requestRender();
	});

	pi.on("session_shutdown", async () => {
		gitWatcher?.close();
		if (responseAgeTimer) clearInterval(responseAgeTimer);
		responseAgeTimer = undefined;
		footerDataRef = null;
		tuiRef = null;
	});

	function renderExtensionStatuses(width: number): string | null {
		const statuses = footerDataRef?.getExtensionStatuses();
		if (!statuses || statuses.size === 0) return null;

		const text = Array.from(statuses.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, value]) => value.replace(/[\r\n\t]+/g, " ").trim())
			.filter(Boolean)
			.join(" ");

		return text ? truncateToWidth(` ${text}`, width) : null;
	}

	// ── Line 1: Mode │ Path │ Context │ Model ──────────────────────────

	function renderLine1(
		width: number,
		theme: { fg: (role: any, text: string) => string; bold: (text: string) => string; inverse: (text: string) => string; bg: (role: any, text: string) => string },
		ctx: { getContextUsage(): { percent: number | null; contextWindow: number } | null | undefined; model: { provider?: string; id?: string; contextWindow?: number } | null | undefined },
	): string {
		const sep = theme.fg("dim", " │ ");
		const sepW = 3;

		// Mode pill
		const pill = renderModePill(currentMode, theme);
		const pillW = modePillWidth(currentMode);

		// Path + branch
		const pathRaw = buildPathString(process.cwd(), gitBranch);

		// Context usage
		const usage = ctx.getContextUsage();
		const pct = usage?.percent ?? 0;
		const win = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const ctxRaw = `${pct.toFixed(0)}%/${fmtTokens(win)}`;
		const ctxColored = renderContextUsage(pct, win, theme);

		// Model + thinking
		const provider = ctx.model?.provider || "unknown";
		const modelName = ctx.model?.id || "no-model";
		const thinking = pi.getThinkingLevel();
		const model = renderModelInfo(modelName, provider, thinking, theme);
		const responseTimeRaw = responseEndedAt === null ? "" : formatResponseTime(responseEndedAt);
		const responseTime = responseTimeRaw ? theme.fg("dim", responseTimeRaw) : "";

		// Layout: compute path budget from remaining space
		const responseTimeWidth = responseTimeRaw ? sepW + visibleWidth(responseTimeRaw) : 0;
		const rightBlockWidth = visibleWidth(ctxRaw) + responseTimeWidth + sepW + model.rawWidth;
		const pathBudget = width - pillW - sepW - rightBlockWidth - sepW;
		const pathDisplay = renderPath(pathRaw, pathBudget, theme);

		// Assemble
		const segments: string[] = [pill];
		if (pathDisplay) segments.push(pathDisplay);
		segments.push(ctxColored);
		if (responseTime) segments.push(responseTime);
		segments.push(model.text);

		return truncateToWidth(segments.join(sep), width);
	}


}
