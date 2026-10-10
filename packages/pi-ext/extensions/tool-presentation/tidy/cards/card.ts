import type { Theme } from "@earendil-works/pi-coding-agent";
import { getCapabilities, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { DEFAULT_EXPANDED_MAX_LINES, type TidyMode } from "../config.js";
import { BOLD, CYAN, DIM, GREEN, MAGENTA, RED, RESET, grepResultCounts, nonEmptyLineCount, shortPath, style } from "../render.js";
import { stripReasoning } from "../tool-composition.js";
import { builtinSpec } from "./specs/builtins.js";
import { errorText, oneLine as singleLine, type CardArgs, type CardResult, type CardSpec } from "./spec.js";
import { timeDivider, type ToolTiming } from "../timeline.js";
/** Hanging indent for expanded output only. Compact pills stay flush left. */
const INDENT = "  ";
const BUILT_INS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

/** Collapse whitespace/newlines to one line (width-based truncation happens at render). */
function oneLine(s: string): string {
	return s.replace(/\s+/g, " ").trim();
}

/** Fit a rendered line while preserving its useful result tail. */
export function fitToolLine(line: string, width: number): string {
	const max = Math.max(1, width);
	if (visibleWidth(line) <= max) return line;
	// Reserve a trailing card link before shortening the target or summary.
	const linkIndex = line.lastIndexOf(" · \x1b]8;;");
	if (linkIndex >= 0) {
		const suffix = line.slice(linkIndex);
		const link = suffix.slice(3);
		const space = max - visibleWidth(suffix);
		if (space > 0) return `${fitToolLine(line.slice(0, linkIndex), space)}${suffix}`;
		return truncateToWidth(link, max, "…");
	}
	const arrowIndex = line.indexOf("→");
	if (arrowIndex < 0) return truncateToWidth(line, max, "…");

	const tail = line.slice(arrowIndex);
	const tailWidth = visibleWidth(tail);
	if (tailWidth >= max) {
		const durationIndex = tail.lastIndexOf("· ");
		if (durationIndex >= 0) {
			const duration = `${DIM}${tail.slice(durationIndex)}`;
			const durationWidth = visibleWidth(duration);
			if (durationWidth >= max) return truncateToWidth(duration, max, "…");
			return `${truncateToWidth(tail.slice(0, durationIndex).trimEnd(), max - durationWidth - 1, "…")} ${duration}`;
		}
		return truncateToWidth(tail, max, "…");
	}
	const head = line.slice(0, arrowIndex).trimEnd();
	return `${truncateToWidth(head, max - tailWidth - 1, "…")} ${tail}`;
}

/**
 * A width-aware component: truncates each pre-composed (ANSI-colored) line to the
 * live viewport width so nothing soft-wraps. Re-flows on resize
 * because render(width) is re-invoked by the TUI.
 */
export class WidthAwareLines {
	constructor(
		private readonly source: string[] | (() => string[]),
		private readonly background?: (text: string) => string,
	) {}
	invalidate(): void {}
	render(width: number): string[] {
		const max = Math.max(1, width);
		const lines = typeof this.source === "function" ? this.source() : this.source;
		return lines.map((line) => paint(fitToolLine(line, max), max, this.background));
	}
}

/** Pad a row that already fits and keep its background unbroken. */
function paint(row: string, max: number, background?: (text: string) => string): string {
	if (!background) return row;
	const padded = row + " ".repeat(Math.max(0, max - visibleWidth(row)));
	// Raw foreground styling uses RESET, which also clears an enclosing
	// background. Apply the background independently to every reset-delimited
	// segment so it remains continuous through the full padded line.
	return padded.split(RESET).map((segment) => background(`${segment}${RESET}`)).join("");
}

/** Card lines by layout: head and tail rows fit one row each; body lines wrap and are capped. */
export interface CardParts { head: string[]; body: string[]; tail: string[] }

/** Wrap one body line, keeping the hanging indent on continuation rows. */
function wrapBodyLine(line: string, max: number): string[] {
	const rail = line.match(/^  (?:\x1b\[[0-9;]*m)*│ ?/)?.[0];
	const prefix = rail ?? INDENT;
	const indented = line.startsWith(prefix) && max > visibleWidth(prefix);
	const rows = indented ? wrapTextWithAnsi(line.slice(prefix.length), max - visibleWidth(prefix)).map((row) => `${prefix}${row}`) : wrapTextWithAnsi(line, max);
	// Guard against characters the wrapper measures differently, such as tabs.
	return rows.map((row) => truncateToWidth(row, max, ""));
}

/**
 * Wrap body lines until `maxLines` rows (0 means no limit). Wrapping stops at the
 * limit, so huge output costs no more than the limit itself.
 */
export function layoutBody(body: string[], width: number, maxLines: number): string[] {
	const max = Math.max(1, width);
	const rows: string[] = [];
	let shown = 0;
	for (const line of body) {
		const wrapped = wrapBodyLine(line, max);
		if (maxLines > 0 && rows.length + wrapped.length > maxLines) {
			// One line longer than the whole limit still shows its first rows.
			if (rows.length === 0) rows.push(...wrapped.slice(0, maxLines));
			break;
		}
		rows.push(...wrapped);
		shown++;
	}
	const hidden = body.length - shown;
	if (hidden > 0) rows.push(truncateToWidth(`${INDENT}${DIM}… ${hidden} more ${hidden === 1 ? "line" : "lines"} · /tidy lines <n> changes the limit${RESET}`, max, "…"));
	return rows;
}

/** An expanded card that wraps its body. Results are cached per width, limit and content. */
export class ExpandedCard {
	private key = "";
	private rows: string[] = [];
	constructor(
		private readonly source: () => CardParts,
		private readonly background?: (text: string) => string,
		private readonly maxLines: () => number = () => DEFAULT_EXPANDED_MAX_LINES,
	) {}
	invalidate(): void { this.key = ""; }
	render(width: number): string[] {
		const max = Math.max(1, width);
		const { head, body, tail } = this.source();
		const limit = this.maxLines();
		const key = [max, limit, head.join("\n"), body.join("\n"), tail.join("\n")].join("\0");
		if (key === this.key) return this.rows;
		this.key = key;
		this.rows = [
			...head.map((line) => fitToolLine(line, max)),
			...layoutBody(body, max, limit),
			...tail.map((line) => fitToolLine(line, max)),
		].map((row) => paint(row, max, this.background));
		return this.rows;
	}
}

/** The divider sits outside the pill background and never mutates timeline state. */
export class TimelineTool {
	constructor(
		private readonly content: { render(width: number): string[]; invalidate(): void },
		private readonly timing: () => ToolTiming | undefined,
		private readonly theme: Pick<Theme, "fg">,
	) {}
	invalidate(): void { this.content.invalidate(); }
	render(width: number): string[] {
		const lines = this.content.render(width);
		const timing = this.timing();
		if (!timing?.showTimestamp || timing.startedAt === undefined) return lines;
		return [timeDivider(timing.startedAt, width, this.theme), "", ...lines];
	}
}

/** Dim line-2 detail when the model gave no `reasoning`. Always ONE line. */
export function argDetail(name: string, args: Record<string, unknown>): string {
	if (name === "bash" && typeof args.command === "string") return oneLine(args.command);
	if ((name === "grep" || name === "find") && typeof args.pattern === "string") {
		return oneLine(typeof args.path === "string" ? `${args.pattern} in ${args.path}` : String(args.pattern));
	}
	if (typeof args.path === "string") return oneLine(args.path);
	if (typeof args.name === "string") return oneLine(args.name);
	return "";
}

/** Compact execution duration for running and completed tools. */
export function formatElapsed(milliseconds: number): string {
	if (milliseconds < 1000) return "<1s";
	const seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;
	if (minutes < 60) return `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

/** Colored result summary from a finished tool result. */
export function summarize(
	name: string,
	result: any,
	isError: boolean,
	args: Record<string, unknown> = {},
): string {
	const text = textFromResult(result);
	if (isError) {
		if (name === "bash") return `${RED}error${RESET}`;
		return `${RED}${text.split("\n")[0] || "error"}${RESET}`;
	}
	if (name === "read") return `${GREEN}${text.split("\n").length} lines${RESET}`;
	if (name === "write") {
		if (typeof args.content === "string" && !args.content.includes("\0")) {
			const lines = args.content.length === 0
				? 0
				: (args.content.match(/\n/g)?.length ?? 0) + (args.content.endsWith("\n") ? 0 : 1);
			return `${GREEN}${lines}${RESET} ${DIM}${lines === 1 ? "line" : "lines"}${RESET}`;
		}
		const bytes = text.match(/wrote (\d+) bytes/i)?.[1];
		return bytes ? `${GREEN}${bytes}b${RESET}` : `${GREEN}written${RESET}`;
	}
	if (name === "edit") {
		const diff = result?.details?.diff as string | undefined;
		if (!diff) return `${GREEN}applied${RESET}`;
		let add = 0;
		let del = 0;
		for (const l of diff.split("\n")) {
			if (l.startsWith("+") && !l.startsWith("+++")) add++;
			if (l.startsWith("-") && !l.startsWith("---")) del++;
		}
		return `${GREEN}+${add}${RESET}${DIM}/${RESET}${RED}-${del}${RESET}`;
	}
	if (name === "bash") {
		const m = text.match(/exit code: (\d+)/);
		const exit = m ? Number(m[1]) : null;
		const status = exit && exit !== 0 ? `${RED}exit ${exit}` : `${GREEN}done`;
		return `${status}${RESET}`;
	}
	if (name === "grep") {
		const { matches: count, files } = grepResultCounts(text);
		const matchLabel = count === 1 ? "match" : "matches";
		const fileLabel = files === 1 ? "file" : "files";
		return `${GREEN}${count} ${matchLabel}${RESET} ${DIM}in${RESET} ${CYAN}${files} ${fileLabel}${RESET}`;
	}
	const count = nonEmptyLineCount(text);
	const noun = name === "find" ? "files" : name === "ls" ? "entries" : "results";
	return `${DIM}${count} ${noun}${RESET}`;
}

/** Pull the first text block out of a tool result / partial (shape varies). */
function textFromResult(r: any): string {
	const content = r?.content ?? r?.partialResult?.content;
	if (Array.isArray(content)) {
		const c = content.find((x: any) => x?.type === "text");
		if (c?.text) return c.text;
	}
	if (typeof r?.output === "string") return r.output;
	if (typeof r?.error === "string") return r.error;
	if (typeof r?.message === "string") return r.message;
	if (typeof r?.details?.error === "string") return r.details.error;
	return "";
}

/** Replace tabs with painted cells using stops relative to the code payload. */
function expandTabs(text: string): string {
	let column = 0;
	let expanded = "";
	for (const character of text) {
		if (character === "\t") {
			const spaces = 8 - (column % 8);
			expanded += " ".repeat(spaces);
			column += spaces;
		} else {
			expanded += character;
			column += visibleWidth(character);
		}
	}
	return expanded;
}

/** Keep line-number prefixes out of edit payload tab-stop calculations. */
function expandDiffTabs(line: string): string {
	const numbered = line.match(/^([ +\-]\s*\d+ )(.*)$/);
	return numbered ? `${numbered[1]}${expandTabs(numbered[2])}` : expandTabs(line);
}

/** Colorize a unified/line-numbered diff string (edit tool's details.diff). */
export function colorizeDiff(diff: string): string[] {
	return diff.split("\n").map((rawLine) => {
		const line = expandDiffTabs(rawLine);
		if (line.startsWith("+") && !line.startsWith("+++")) return `${GREEN}${line}${RESET}`;
		if (line.startsWith("-") && !line.startsWith("---")) return `${RED}${line}${RESET}`;
		if (line.startsWith("@@")) return `${CYAN}${line}${RESET}`;
		return `${DIM}${line}${RESET}`;
	});
}

/**
 * Build the expanded (C-o) continuation lines for a settled tool result:
 *   - bash: the full multi-line command input, then its output
 *   - edit/write: the colored line-numbered diff when present
 *   - otherwise: the raw result text
 * Each line is prefixed with the hanging INDENT.
 */
export function expandedLines(name: string, args: Record<string, unknown>, result: any): string[] {
	const out: string[] = [];

	// bash: show the full command (collapsed line 2 is truncated to one line).
	if (name === "bash" && typeof args.command === "string") {
		const cmdLines = args.command.replace(/\s+$/, "").split("\n");
		cmdLines.forEach((cl, i) => {
			const prefix = i === 0 ? `${CYAN}$ ${RESET}` : `${DIM}  ${RESET}`;
			out.push(`${INDENT}${prefix}${CYAN}${cl}${RESET}`);
		});
	}

	// Whole-file writes do not provide a useful diff. Show the actual written
	// content instead of repeating the generic "Successfully wrote..." result.
	if (name === "write" && typeof args.content === "string") {
		if (args.content.length === 0) {
			out.push(`${INDENT}${DIM}(empty file)${RESET}`);
			return out;
		}
		const splitLines = args.content.split("\n");
		const contentLines = args.content.endsWith("\n") ? splitLines.slice(0, -1) : splitLines;
		const lineNumberWidth = String(contentLines.length).length;
		contentLines.forEach((line, index) => {
			const lineNumber = String(index + 1).padStart(lineNumberWidth, " ");
			out.push(`${INDENT}${DIM}${lineNumber} ${RESET}${expandTabs(line)}`);
		});
		return out;
	}

	// Prefer the structured diff over the generic "Successfully replaced..." text.
	const diff = result?.details?.diff as string | undefined;
	if (diff && diff.trim()) {
		for (const dl of colorizeDiff(diff)) out.push(`${INDENT}${dl}`);
		return out;
	}

	const text = textFromResult(result).replace(/\s+$/, "");
	if (text) for (const raw of text.split("\n")) out.push(`${INDENT}${DIM}${raw}${RESET}`);
	return out;
}

/**
 * Build the rendered lines for one settled tool call. Shared by the live
 * renderResult and the demo generator so the demo shows REAL output, never
 * hand-typed ANSI. `args` includes the model's `reasoning` (stripped here).
 */
export function buildToolBlock(
	name: string,
	args: Record<string, unknown>,
	result: any,
	opts: { isError?: boolean; isPartial?: boolean; expanded?: boolean; elapsedMs?: number; mode?: TidyMode; icons?: boolean } = {},
): string[] {
	return renderCard({ spec: builtinSpec(name), args, result }, opts);
}

export interface CardModel { spec: CardSpec; args: CardArgs; result: CardResult }
export interface CardOptions { isError?: boolean; isPartial?: boolean; expanded?: boolean; elapsedMs?: number; mode?: TidyMode; icons?: boolean }

/** All layouts share the same two-line shape and width fitting. Expanded output is not capped here. */
export function renderCard(model: CardModel, opts: CardOptions = {}): string[] {
	const { head, body, tail } = cardParts(model, opts);
	return [...head, ...body, ...tail];
}

/** The card split into its summary rows, expanded body and trailing notes. */
export function cardParts({ spec, args = {}, result = {} }: CardModel, opts: CardOptions = {}): CardParts {
	const { isError: piError = false, isPartial = false, expanded = false, elapsedMs, mode = "default", icons = true } = opts;
	const isError = piError || result?.isError === true || spec.failed?.(result) === true;
	const { reasoning, rest } = stripReasoning(args ?? {});

	// Settled success/error is already encoded by Pi's native row background.
	// Only running calls need an inline state mark.
	const runningPrefix = isPartial ? `${DIM}·${RESET} ` : "";
	const duration = elapsedMs === undefined ? undefined : formatElapsed(elapsedMs);
	let fact: string;
	if (isPartial) fact = spec.running?.(result, rest) ?? "";
	else if (isError && (piError || result.isError || result.details?.error)) fact = spec.errorSummary?.(result, rest) ?? errorText(result).split("\n")[0];
	else fact = spec.summary(result, rest);
	if (!spec.legacy) fact = truncateToWidth(singleLine(fact), 48, "…");
	const cardLink = !isPartial && getCapabilities().hyperlinks ? spec.link?.(result, rest) : undefined;
	const linkSuffix = cardLink ? ` · \x1b]8;;${cardLink.url}\x07${cardLink.label}\x1b]8;;\x07` : "";
	const summary = (spec.legacy
		? isPartial ? `${DIM}${duration ?? "preparing"}${RESET}` : `${summarize(spec.label, result, isError, rest)}${duration === undefined ? "" : ` ${DIM}· ${duration}${RESET}`}`
		: `${isPartial ? DIM : isError ? RED : GREEN}${fact || (isPartial ? duration ?? "preparing" : isError ? "error" : "done")}${RESET}${duration === undefined || (isPartial && !fact) ? "" : ` ${DIM}· ${duration}${RESET}`}`) + linkSuffix;

	const { icon, color } = spec;
	// Built-ins stay icon-only; every other card names its provider group in bold after the icon.
	const label = icons && spec.legacy && BUILT_INS.has(spec.label) ? icon : `${icons ? `${icon} ` : ""}${BOLD}${spec.label}`;
	const toolLabel = `${color}${label}${RESET}`;
	const headline = oneLine(reasoning || spec.headline(rest) || spec.target(rest, result));
	const detail = singleLine(spec.target(rest, result));
	// Keep the target on failures too; width fitting preserves the useful error
	// tail while the command/path answers what actually failed.
	// No target: new cards show the summary alone rather than a dangling arrow.
	// Built-ins (legacy) keep their tested "→ summary" shape.
	const bareArrow = spec.legacy ? `${DIM}→${RESET} ` : "";
	const line2 = !detail
		? `${bareArrow}${summary}`
		: `${DIM}${detail}${RESET} ${DIM}→${RESET} ${summary}`;
	let lines: string[];
	if (mode === "reasoning") {
		lines = [`${runningPrefix}${toolLabel} ${headline} ${DIM}→${RESET} ${summary}`];
	} else if (mode === "result") {
		const resultDetail = !detail ? "" : ` ${DIM}${detail}${RESET}`;
		lines = [`${runningPrefix}${toolLabel}${resultDetail}${resultDetail || spec.legacy ? ` ${DIM}→${RESET}` : ""} ${summary}`];
	} else {
		lines = [
			`${runningPrefix}${toolLabel} ${headline}`,
			line2,
		];
	}
	const body: string[] = [];
	const tail: string[] = [];
	if (expanded && !isPartial) {
		if (spec.legacy) body.push(...expandedLines(spec.label, rest, result));
		else {
			const output = isError && !spec.errorSummary && (piError || result.isError || result.details?.error) ? errorText(result).split("\n") : spec.expanded?.(result, rest) ?? [];
			body.push(...output.map((line) => `${INDENT}${isError ? RED : DIM}${line}${RESET}`));
			if (result.details?.fullOutputPath) tail.push(`${INDENT}${DIM}full output: ${result.details.fullOutputPath}${RESET}`);
		}
	}
	return { head: lines, body, tail };
}
