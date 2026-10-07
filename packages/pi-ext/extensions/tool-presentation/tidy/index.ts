/**
 * pi-tidy-tools — tidy, reason-first tool output for pi.
 *
 * Model (per-tool 2-line block): each built-in tool renders its OWN compact
 * block inline in the transcript, in execution order, via the tool-renderer
 * path (renderShell: "self"). No collector, no above-editor widget, no
 * turn-end stamping — pi already renders tool components inline; we just make
 * them tight.
 *
 *     ── 14:32 ────────────────────────────
 *
 *     󱇧 put reasoning on line 1, detail on line 2
 *     index.ts → +28/-14 · <1s
 *     󰆍 run the typecheck
 *     npx tsc --noEmit → done · 3s
 *
 * Line 1: {running mark?} {icon or name} {reasoning headline}
 * Line 2: {dim arg/command detail} → {colored summary} · {duration}
 * A dim clock divider precedes the first execution in each new minute.
 *
 * Why this beats the spacer floor: pi bakes a Spacer(1) inside every tool's
 * ToolExecutionComponent, so N default cards = N blank lines. BUT in
 * `renderShell: "self"` mode, ToolExecutionComponent.render() skips that baked
 * spacer — it emits ONE leading blank + the self-rendered content, and returns
 * [] when content is empty. So each tool = 1 separator + 2 tight lines.
 *
 * `reasoning`: built-in tools have no reasoning of their own, so we inject a
 * REQUIRED `reasoning` string param into each wrapped tool. The model must fill
 * it with the GOAL/intent behind the call (not the file or command, which are
 * already shown); we strip it before delegating and render it as the line-1
 * headline. If ever absent, line 1 falls back to the arg detail.
 *
 * C-o (app.tools.expand) expansion: renderResult receives `{ expanded }`.
 * Collapsed shows the 2-line block; expanded appends the tool's real output —
 * a colored line-numbered diff for code edits (details.diff), else raw content.
 *
 * One renderer resolver supplies cards for known third-party and MCP tools.
 * Built-in registrations retain their behavior and historical presentation.
 *
 * Usage:  pi -e ./index.ts     (or install as a pi package)
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
} from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth } from "@earendil-works/pi-tui";
import {
	CONFIG_PATH,
	loadTidyIcons,
	loadTidyMode,
	loadTidyState,
	saveTidyEnabled,
	saveTidyIcons,
	saveTidyMode,
	type TidyMode,
} from "./config.js";
import {
	BOLD,
	DIM,
	MAGENTA,
	RESET,
	shortPath,
	style,
} from "./render.js";
import {
	composeSourceTool,
	createDiffingWriteTool,
	stripReasoning,
	withReasoning,
	type SourceToolDefinition,
} from "./tool-composition.js";
import {
	concisePiFffStatus,
	createPiFffIntegrationController,
	type PiFffIntegrationController,
} from "./pi-fff/controller.js";
import type { PiFffLifecyclePreview } from "./pi-fff/integration.js";
import { renderRichDiff } from "../rich-diff.js";
import { readToolTiming, ToolTimeline } from "./timeline.js";

import { buildToolBlock, WidthAwareLines, TimelineTool, colorizeDiff } from "./cards/card.js";
import { cardRenderers, cardRuntime, specForTool } from "./cards/index.js";
export { buildToolBlock, fitToolLine, formatElapsed } from "./cards/card.js";

export { withReasoning } from "./tool-composition.js";

class RichToolResult {
	private richKey = "";
	private richLines: string[] | undefined;
	private richPending = false;

	constructor(
		private readonly name: string,
		private readonly args: Record<string, unknown>,
		private readonly result: any,
		private readonly options: { isError: boolean; expanded: boolean; elapsedMs?: number; mode: TidyMode; icons: boolean },
		private readonly theme: any,
		private readonly invalidateResult: () => void,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		const compact = buildToolBlock(this.name, this.args, this.result, { ...this.options, expanded: false });
		const background = (text: string) => this.theme.bg(this.options.isError ? "toolErrorBg" : "toolSuccessBg", text);
		const compactLines = new WidthAwareLines(compact, background).render(width);
		if (!this.options.expanded) return compactLines;

		const fallback = buildToolBlock(this.name, this.args, this.result, { ...this.options, expanded: true }).slice(compact.length);
		if (this.options.isError || (this.name !== "edit" && this.name !== "write")) {
			return [...compactLines, ...new WidthAwareLines(fallback, background).render(width)];
		}

		const key = [
			this.name,
			width,
			typeof this.args.path === "string" ? this.args.path : "",
			typeof this.args.content === "string" ? this.args.content.length : 0,
			typeof this.args.oldText === "string" ? this.args.oldText.length : 0,
			typeof this.args.newText === "string" ? this.args.newText.length : 0,
			Array.isArray(this.args.edits) ? this.args.edits.length : 0,
			typeof this.result?.details?.diff === "string" ? this.result.details.diff.length : 0,
		].join(":");
		if (key !== this.richKey) {
			this.richKey = key;
			this.richLines = undefined;
			this.richPending = false;
		}
		if (!this.richPending && this.richLines === undefined) {
			this.richPending = true;
			renderRichDiff({
				toolName: this.name,
				args: this.args,
				result: this.result,
				width,
				theme: this.theme,
			}).then((lines) => {
				if (this.richKey !== key) return;
				this.richLines = lines ?? [];
				this.richPending = false;
				this.invalidateResult();
			}).catch(() => {
				if (this.richKey !== key) return;
				this.richLines = [];
				this.richPending = false;
				this.invalidateResult();
			});
		}
		if (!this.richLines?.length) {
			return [...compactLines, ...new WidthAwareLines(fallback, background).render(width)];
		}
		return [
			...compactLines,
			...this.richLines.map((line) => truncateToWidth(line, Math.max(1, width))),
		];
	}
}

/** A file change captured during a turn, for the `/diff` recap. */
export interface TurnDiff {
	tool: string; // "edit" | "write"
	path: string;
	diff: string; // raw details.diff (may be empty for whole-file writes)
}

/** Render a set of turn diffs as colored lines with per-file headers. */
function renderTurnDiffs(diffs: TurnDiff[], icons = true): string[] {
	const lines: string[] = [];
	diffs.forEach((d, i) => {
		if (i > 0) lines.push("");
		const { icon, color } = style(d.tool);
		lines.push(`${color}${icons ? `${icon} ` : ""}${BOLD}${shortPath(d.path)}${RESET}`);
		if (d.diff.trim()) lines.push(...colorizeDiff(d.diff.replace(/\s+$/, "")));
		else lines.push(`${DIM}(new file / full overwrite — no line diff)${RESET}`);
	});
	return lines;
}

/** Full `/diff` recap block — same lines the command posts into the transcript. */
export function buildTurnDiffBlock(diffs: TurnDiff[], opts: { icons?: boolean } = {}): string[] {
	const { icons = true } = opts;
	const n = diffs.length;
	const header = `${MAGENTA}${icons ? "◆ " : ""}${BOLD}last turn diff${RESET} ${DIM}(${n} file${n === 1 ? "" : "s"})${RESET}`;
	return [header, ...renderTurnDiffs(diffs, icons)];
}

const DIFF_MSG_TYPE = "minimal-turn-diff";
const TIDY_COMPLETIONS = [
	"on", "off", "toggle", "status", "mode default", "mode reasoning", "mode result", "mode status",
	"icons on", "icons off", "icons status",
	"pi-fff setup", "pi-fff status", "pi-fff teardown",
];

export interface TidyExtensionDependencies {
	cwd?: string;
	timeline?: ToolTimeline;
	loadState?: typeof loadTidyState;
	loadMode?: typeof loadTidyMode;
	loadIcons?: typeof loadTidyIcons;
	saveIcons?: typeof saveTidyIcons;
	createIntegration?: (pi: ExtensionAPI, cwd: string) => PiFffIntegrationController;
	decorateSource?: (source: SourceToolDefinition) => SourceToolDefinition;
	isReplayCall?: (toolCallId: string) => boolean;
	onToolsReady?: () => void;
}

function previewText(preview: PiFffLifecyclePreview): string {
	return preview.changes.map((change) => `${change.scope}: ${change.settingsPath}\n${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`).join("\n");
}

export function createTidyExtension(dependencies: TidyExtensionDependencies = {}) {
	return async (pi: ExtensionAPI): Promise<void> => {
		const cwd = dependencies.cwd ?? process.cwd();
		const tidyState = (dependencies.loadState ?? loadTidyState)();
		const tidyMode = (dependencies.loadMode ?? loadTidyMode)();
		const tidyIcons = (dependencies.loadIcons ?? loadTidyIcons)();
		const persistIcons = dependencies.saveIcons ?? saveTidyIcons;
		const integration = dependencies.createIntegration?.(pi, cwd)
			?? createPiFffIntegrationController({ pi: pi as any, cwd });
		let startupPlan: Awaited<ReturnType<PiFffIntegrationController["initialize"]>> | undefined;

		pi.registerCommand("tidy", {
			description: "Manage pi-tidy-tools state, layout, and pi-fff integration",
			getArgumentCompletions: (prefix) => TIDY_COMPLETIONS
				.filter((value) => value.startsWith(prefix.trim().toLowerCase()))
				.map((value) => ({ value, label: value })),
			handler: async (args, ctx) => {
				const action = args.trim().toLowerCase();
				const piFff = action.match(/^pi-fff (setup|status|teardown)$/);
				if (piFff) {
					const operation = piFff[1] as "setup" | "status" | "teardown";
					const result = await integration.run(operation, {
						enabled: tidyState.enabled,
						confirm: ctx.hasUI === false ? undefined : async (preview) => ctx.ui.confirm(`pi-fff ${preview.action}`, previewText(preview)),
						reload: operation === "status" ? undefined : async () => {
							ctx.ui.notify(`pi-fff ${operation} committed; reloading.`, "info");
							await ctx.reload();
							return;
						},
					});
					if (result.reload === "requested") return;
					ctx.ui.notify(result.message, result.level);
					return;
				}
				if (action === "status" || action === "mode status") {
					const detail = tidyState.source === "environment" ? "PI_TIDY_TOOLS override"
						: tidyState.source === "file" ? CONFIG_PATH : "default; no config file";
					const status = (await integration.run("status", { enabled: tidyState.enabled })).status;
					ctx.ui.notify(`pi-tidy-tools is ${tidyState.enabled ? "on" : "off"}, mode ${tidyMode}, icons ${tidyIcons ? "on" : "off"} (${detail}).\n${concisePiFffStatus(status)}.`, "info");
					return;
				}
				if (action === "icons status") {
					ctx.ui.notify(`pi-tidy-tools icons are ${tidyIcons ? "on" : "off"}.`, "info");
					return;
				}
				const iconsMatch = action.match(/^icons (on|off)$/);
				if (iconsMatch) {
					const icons = iconsMatch[1] === "on";
					if (icons === tidyIcons) { ctx.ui.notify(`pi-tidy-tools icons are already ${icons ? "on" : "off"}.`, "info"); return; }
					try { await persistIcons(icons); }
					catch (error) { ctx.ui.notify(`Could not save ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error"); return; }
					ctx.ui.notify(`pi-tidy-tools icons set to ${icons ? "on" : "off"}; reloading.`, "info");
					await ctx.reload(); return;
				}
				const modeMatch = action.match(/^mode (default|reasoning|result)$/);
				if (modeMatch) {
					const mode = modeMatch[1] as TidyMode;
					if (mode === tidyMode) { ctx.ui.notify(`pi-tidy-tools mode is already ${mode}.`, "info"); return; }
					try { await saveTidyMode(mode); }
					catch (error) { ctx.ui.notify(`Could not save ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error"); return; }
					ctx.ui.notify(`pi-tidy-tools mode set to ${mode}; reloading.`, "info");
					await ctx.reload(); return;
				}
				if (action !== "on" && action !== "off" && action !== "toggle") {
					ctx.ui.notify("Usage: /tidy on|off|toggle|status|mode default|reasoning|result|status|icons on|off|status|pi-fff setup|status|teardown", "warning"); return;
				}
				if (tidyState.source === "environment") { ctx.ui.notify("PI_TIDY_TOOLS overrides persistent settings; change or unset it first.", "warning"); return; }
				const enabled = action === "toggle" ? !tidyState.enabled : action === "on";
				if (enabled === tidyState.enabled) { ctx.ui.notify(`pi-tidy-tools is already ${enabled ? "on" : "off"}.`, "info"); return; }
				try { await saveTidyEnabled(enabled); }
				catch (error) { ctx.ui.notify(`Could not save ${CONFIG_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error"); return; }
				ctx.ui.notify(`pi-tidy-tools ${enabled ? "enabled" : "disabled"}; reloading.`, "info");
				await ctx.reload(); return;
			},
		});

		startupPlan = await integration.initialize(tidyState.enabled);
		if (startupPlan.notice) {
			const notice = startupPlan.notice;
			pi.on("session_start", (_event: unknown, ctx: any) => ctx.ui.notify(notice.message, notice.level));
		}
		const timeline = dependencies.timeline ?? new ToolTimeline();
		// Older Pi hosts retain the built-in registrations, but cannot resolve foreign tools.
		if (pi.registerToolRenderer) {
			const runtime = tidyState.enabled ? cardRuntime(pi, timeline, dependencies.isReplayCall) : undefined;
			pi.registerToolRenderer((name, next) => {
				const original = next();
				if (!tidyState.enabled) return original;
				const spec = specForTool({ name });
				return spec ? cardRenderers(spec, runtime, original, { mode: tidyMode, icons: tidyIcons }) : original;
			});
		}
		if (!tidyState.enabled) return;

		let currentTurn: TurnDiff[] = [], lastTurn: TurnDiff[] = [];
		const pathByCallId = new Map<string, string>();
		const elapsedTimerByCallId = new Map<string, ReturnType<typeof setInterval>>();
		const ownedTools = new Set<string>();

		const decorate = (source: SourceToolDefinition): SourceToolDefinition => {
			const name = source.name;
			const behaviorSource = dependencies.decorateSource?.(source) ?? source;
			const tool = composeSourceTool(behaviorSource, { mode: tidyMode, reasoningGuideline: `Always pass a "reasoning" phrase to ${name}: state the GOAL/intent, not the file or command (those are shown already).` });
			ownedTools.add(name);
			return {
				...tool, name, renderShell: "self",
				renderCall: (args: any, theme: any, context: any) => {
					if (!context?.isPartial) return new Container();
					const id = context.toolCallId as string;
					if (!elapsedTimerByCallId.has(id)) { const timer = setInterval(() => context.invalidate(), 1000); timer.unref?.(); elapsedTimerByCallId.set(id, timer); }
					const mode = dependencies.isReplayCall?.(id) ? "result" : tidyMode;
					const content = new WidthAwareLines(() => {
						const timing = timeline.get(id);
						const elapsedMs = timing?.elapsedMs ?? (timing?.startedAt === undefined ? undefined : Math.max(0, Date.now() - timing.startedAt));
						return buildToolBlock(name, args ?? {}, {}, { isPartial: true, elapsedMs, mode, icons: tidyIcons });
					}, (text) => theme.bg("toolPendingBg", text));
					return new TimelineTool(content, () => timeline.get(id), theme);
				},
				renderResult: (result: any, options: any, theme: any, context: any) => {
					if (options?.isPartial) return new Container();
					const isError = context?.isError ?? result?.isError ?? false;
					const id = context?.toolCallId as string | undefined;
					const timer = elapsedTimerByCallId.get(id ?? "");
					if (timer) clearInterval(timer); elapsedTimerByCallId.delete(id ?? "");
					const timing = readToolTiming(result?.details) ?? timeline.get(id ?? "");
					const mode = id && dependencies.isReplayCall?.(id) ? "result" : tidyMode;
					return new TimelineTool(new RichToolResult(
						name,
						context?.args ?? {},
						result,
						{ isError, expanded: options?.expanded ?? false, elapsedMs: timing?.elapsedMs, mode, icons: tidyIcons },
						theme,
						() => context?.invalidate?.(),
					), () => timing, theme);
				},
			} as SourceToolDefinition;
		};

		const restoreTimeline = (_event: unknown, ctx: any) => {
			for (const timer of elapsedTimerByCallId.values()) clearInterval(timer);
			elapsedTimerByCallId.clear();
			const results = ctx.sessionManager.getBranch()
				.filter((entry: any) => entry.type === "message" && entry.message?.role === "toolResult")
				.map((entry: any) => entry.message);
			timeline.restore(results);
		};
		pi.on("session_start", restoreTimeline);
		pi.on("session_tree", restoreTimeline);

		pi.on("tool_execution_start", async (e: any) => {
			// Replayed provider results already ran elsewhere; playback time is not execution time.
			if (ownedTools.has(e.toolName) && !dependencies.isReplayCall?.(e.toolCallId)) timeline.start(e.toolCallId, Date.now());
			if ((e.toolName === "edit" || e.toolName === "write") && typeof e?.args?.path === "string") pathByCallId.set(e.toolCallId, e.args.path);
		});
		pi.on("tool_execution_end", async (e: any) => {
			timeline.finish(e.toolCallId, Date.now());
			const timer = elapsedTimerByCallId.get(e.toolCallId); if (timer) clearInterval(timer); elapsedTimerByCallId.delete(e.toolCallId);
			if (e.toolName !== "edit" && e.toolName !== "write") return;
			const path = pathByCallId.get(e.toolCallId); pathByCallId.delete(e.toolCallId);
			if (!e.isError) currentTurn.push({ tool: e.toolName, path: path ?? "(unknown)", diff: (e?.result?.details?.diff as string | undefined) ?? "" });
		});
		pi.on("tool_result", async (e: any) => {
			if (!ownedTools.has(e.toolName)) return;
			const timing = timeline.finish(e.toolCallId, Date.now()); if (!timing) return;
			return { details: {
				...(e.details ?? {}),
				piTidyStartedAt: timing.startedAt,
				piTidyShowTimestamp: timing.showTimestamp,
				piTidyElapsedMs: timing.elapsedMs,
			} };
		});
		pi.on("turn_end", async () => {
			lastTurn = currentTurn; currentTurn = []; pathByCallId.clear();
			for (const timer of elapsedTimerByCallId.values()) clearInterval(timer); elapsedTimerByCallId.clear();
		});
		pi.on("session_shutdown", async () => {
			for (const timer of elapsedTimerByCallId.values()) clearInterval(timer);
			elapsedTimerByCallId.clear();
		});
		pi.registerMessageRenderer(DIFF_MSG_TYPE, (message: any) => new WidthAwareLines(message.details?.rows ?? String(message.content ?? "").split("\n")));
		const showLastTurnDiff = (ctx: any) => {
			if (!lastTurn.length) { ctx.ui.notify("No file changes recorded in the last turn.", "info"); return; }
			const rows = buildTurnDiffBlock(lastTurn, { icons: tidyIcons }); pi.sendMessage({ customType: DIFF_MSG_TYPE, content: rows.join("\n"), display: true, details: { rows } });
		};
		pi.registerCommand("diff", { description: "Show file changes (edit/write diffs) from the last turn", handler: async (_args, ctx) => showLastTurnDiff(ctx) });
		pi.registerShortcut("ctrl+shift+o", { description: "Show file changes from the last turn", handler: async (ctx) => showLastTurnDiff(ctx) });

		const sourceTools: Record<string, SourceToolDefinition> = {
			read: createReadTool(cwd) as SourceToolDefinition, write: createDiffingWriteTool(cwd) as SourceToolDefinition,
			edit: createEditTool(cwd) as SourceToolDefinition,
			// Keep tidy's existing prompt contract, without Pi 1's extra bash guideline.
			bash: { ...createBashTool(cwd), promptGuidelines: [] } as SourceToolDefinition,
			grep: createGrepTool(cwd) as SourceToolDefinition, find: createFindTool(cwd) as SourceToolDefinition, ls: createLsTool(cwd) as SourceToolDefinition,
		};
		for (const [name, source] of Object.entries(sourceTools)) {
			if (startupPlan.skipTidyTools.has(name as "read" | "grep" | "find")) continue;
			pi.registerTool(decorate(source) as any);
		}
		startupPlan.commit(decorate);
		dependencies.onToolsReady?.();
	};
}

const extension = createTidyExtension();
export default extension;
