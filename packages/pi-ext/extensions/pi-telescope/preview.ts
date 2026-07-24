/**
 * Preview Panel
 *
 * Reads files and formats them for the preview pane.
 * Uses pi's highlightCode() for syntax highlighting when available.
 */

import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { highlightCode, getLanguageFromPath } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
// Note: highlightCode(code, lang?) returns string[] (lines), no theme param needed

/** Read a file and return preview lines with optional syntax highlighting. */
export function filePreview(
	filePath: string,
	theme: Theme,
	maxLines: number,
	highlightLine?: number,
): string[] {
	try {
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			return [theme.fg("dim", `(directory: ${filePath})`)];
		}
		if (stat.size > 512 * 1024) {
			return [theme.fg("dim", `(file too large: ${(stat.size / 1024).toFixed(0)} KB)`)];
		}

		const content = readFileSync(filePath, "utf-8");
		const rawLines = content.split("\n").slice(0, maxLines);

		// Try syntax highlighting
		const lang = getLanguageFromPath(filePath);
		if (lang && lang !== "plaintext") {
			try {
				const hlLines = highlightCode(content, lang).slice(0, maxLines);
				return formatPreviewLines(hlLines, theme, highlightLine);
			} catch {
				// Fall through to plain text
			}
		}

		return formatPreviewLines(rawLines, theme, highlightLine);
	} catch {
		return [theme.fg("dim", "(no preview available)")];
	}
}

/** Format lines with line numbers and optional highlight marker. */
function formatPreviewLines(
	lines: string[],
	theme: Theme,
	highlightLine?: number,
): string[] {
	const gutterWidth = String(lines.length).length;

	return lines.map((line, i) => {
		const lineNum = String(i + 1).padStart(gutterWidth);
		const isHighlighted = highlightLine !== undefined && i + 1 === highlightLine;
		const gutter = isHighlighted
			? theme.fg("accent", `${lineNum}│`)
			: theme.fg("dim", `${lineNum}│`);
		return `${gutter}${expandTabs(line)}`;
	});
}

/** Plain text preview (no syntax highlighting). */
export function plainPreview(
	lines: string[],
	theme: Theme,
): string[] {
	if (lines.length === 0) return [theme.fg("dim", "(empty)")];
	const gutterWidth = String(lines.length).length;
	return lines.map((line, i) => {
		const lineNum = String(i + 1).padStart(gutterWidth);
		return `${theme.fg("dim", `${lineNum}│`)}${expandTabs(line)}`;
	});
}

/** Replace tab characters with spaces to match pi-tui's tab width of 3. */
function expandTabs(line: string): string {
	return line.includes("\t") ? line.replace(/\t/g, "   ") : line;
}
