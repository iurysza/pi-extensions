/**
 * Pi-Telescope Extension
 *
 * A native TUI fuzzy finder for pi, inspired by telescope.nvim and Television.
 *
 * Features:
 *   - Fuzzy search with pattern modifiers ('exact, ^prefix, suffix$, !negate)
 *   - Multi-select with Tab
 *   - Provider switching with Ctrl+R
 *   - Toggle preview with Ctrl+O
 *   - Help panel with Ctrl+G
 *   - Provider-specific actions with Ctrl+E
 *   - Copy to clipboard with Ctrl+Y
 *   - Frecency-aware sorting
 *   - Footer with keybinding hints
 *
 * Keybindings:
 *   Ctrl+Space          → open files finder
 *
 * Commands:
 *   /telescope [name]  → open specific provider
 *   /ts [name]         → alias
 *
 * Built-in providers:
 *   files, git-branches, git-log, sessions, skills, commands
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import type { TelescopeProvider } from "./types.js";
import { openTelescope } from "./telescope.js";
import { filterAndScore } from "./scoring.js";
import { getFrecencyMap } from "./frecency.js";

import { createFilesProvider, listFiles } from "./providers/files.js";

import { createGitBranchesProvider } from "./providers/git-branches.js";
import { createGitLogProvider } from "./providers/git-log.js";
import { createSessionsProvider } from "./providers/sessions.js";
import { createSkillsProvider } from "./providers/skills.js";
import { createCommandsProvider } from "./providers/commands.js";

type ProviderFactory = (cwd: string, pi: ExtensionAPI) => TelescopeProvider;

/** Registry of available providers */
const PROVIDERS: Record<string, ProviderFactory> = {
	"files":        (cwd) => createFilesProvider(cwd),

	"git-branches": (cwd) => createGitBranchesProvider(cwd),
	"git-log":      (cwd) => createGitLogProvider(cwd),
	"sessions":     ()    => createSessionsProvider(),
	"skills":       (cwd) => createSkillsProvider(cwd),
	"commands":     (_cwd, pi) => createCommandsProvider(pi),
};

const PROVIDER_NAMES = Object.keys(PROVIDERS);

/** Build the allProviders map for Ctrl+R switching */
function buildAllProviders(
	cwd: string,
	pi: ExtensionAPI,
): Record<string, () => TelescopeProvider> {
	const result: Record<string, () => TelescopeProvider> = {};
	for (const [name, factory] of Object.entries(PROVIDERS)) {
		result[name] = () => factory(cwd, pi);
	}
	return result;
}

async function runTelescope(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	providerName?: string,
) {
	const name = providerName?.trim().toLowerCase() || "files";
	const factory = PROVIDERS[name];

	if (!factory) {
		ctx.ui.notify(
			`Unknown provider: ${name}. Available: ${PROVIDER_NAMES.join(", ")}`,
			"warning",
		);
		return;
	}

	const provider = factory(ctx.cwd, pi);
	await openTelescope(provider, ctx, {
		allProviders: buildAllProviders(ctx.cwd, pi),
	});
}

// ---------------------------------------------------------------------------
// @ mention autocomplete replacement
// ---------------------------------------------------------------------------

const MENTION_MAX_RESULTS = 20;

/** Cache of file listings per cwd */
let cachedFiles: string[] = [];
let cachedCwd: string | null = null;

function ensureFileCache(cwd: string): string[] {
	if (cachedCwd !== cwd) {
		cachedFiles = listFiles(cwd);
		cachedCwd = cwd;
	}
	return cachedFiles;
}

/** Invalidate file cache (called on cwd change) */
function invalidateFileCache(): void {
	cachedFiles = [];
	cachedCwd = null;
}

/** Extract the @-prefix from text before cursor, or null if not in an @ context */
function extractAtPrefix(textBeforeCursor: string): string | null {
	const match = textBeforeCursor.match(/(?:^|[ \t])(@(?:"[^"]*|[^\s]*))$/);
	return match?.[1] ?? null;
}

/** Parse the raw query and whether it's a quoted @"..." prefix */
function parseAtPrefix(prefix: string): { raw: string; quoted: boolean } {
	if (prefix.startsWith('@"')) {
		return { raw: prefix.slice(2), quoted: true };
	}
	return { raw: prefix.slice(1), quoted: false };
}

/** Build the completion value with proper quoting for paths with spaces */
function buildAtValue(path: string, quotedPrefix: boolean): string {
	if (quotedPrefix || path.includes(" ")) {
		return `@"${path}"`;
	}
	return `@${path}`;
}

/**
 * Autocomplete provider that intercepts @ mentions and uses telescope's
 * fuzzy scoring engine to find files, delegating everything else to the
 * built-in provider.
 */
class TelescopeAtMentionProvider implements AutocompleteProvider {
	constructor(
		private base: AutocompleteProvider,
		private cwd: string,
	) {}

	async getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		options: { signal: AbortSignal; force?: boolean },
	): Promise<{ items: AutocompleteItem[]; prefix: string } | null> {
		const currentLine = lines[cursorLine] || "";
		const textBeforeCursor = currentLine.slice(0, cursorCol);
		const atPrefix = extractAtPrefix(textBeforeCursor);

		if (!atPrefix) {
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}

		const { raw, quoted } = parseAtPrefix(atPrefix);

		try {
			const files = ensureFileCache(this.cwd);
			const frecency = getFrecencyMap("files");
			const scored = filterAndScore(
				files,
				raw,
				(f) => f,
				MENTION_MAX_RESULTS,
				frecency,
			);

			if (scored.length === 0) {
				return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const items: AutocompleteItem[] = scored.map((s) => {
				const path = s.item;
				const fileName = path.includes("/")
					? path.slice(path.lastIndexOf("/") + 1)
					: path;
				return {
					value: buildAtValue(path, quoted),
					label: fileName,
					description: path,
				};
			});

			return { items, prefix: atPrefix };
		} catch {
			// Fall back to built-in on any error
			return this.base.getSuggestions(lines, cursorLine, cursorCol, options);
		}
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	) {
		return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}
}

/**
 * Custom editor that wraps the autocomplete provider to inject
 * telescope-powered @ mention completions.
 */
class TelescopeEditor extends CustomEditor {
	constructor(
		tui: any,
		theme: any,
		keybindings: any,
		private cwd: string,
	) {
		super(tui, theme, keybindings);
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		super.setAutocompleteProvider(
			new TelescopeAtMentionProvider(provider, this.cwd),
		);
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Register custom editor with telescope @ mentions
	pi.on("session_start", async (_event, ctx) => {
		try {
			const cwd = ctx.cwd;
			invalidateFileCache();
			ensureFileCache(cwd);
			ctx.ui.setEditorComponent((tui, theme, keybindings) =>
				new TelescopeEditor(tui, theme, keybindings, cwd),
			);
		} catch (e: unknown) {
			const msg = e instanceof Error ? e.message : String(e);
			ctx.ui.notify(`Telescope @ init failed: ${msg}`, "error");
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setEditorComponent(undefined);
		invalidateFileCache();
	});

	pi.registerShortcut("ctrl+space", {
		description: "Open Telescope fuzzy finder (files)",
		handler: (ctx) => runTelescope(pi, ctx, "files"),
	});

	pi.registerCommand("telescope", {
		description: "Open Telescope fuzzy finder (optional: provider name)",
		getArgumentCompletions: (prefix) => {
			const items = PROVIDER_NAMES
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({ value: n, label: n }));
			return items.length > 0 ? items : null;
		},
		handler: (args, ctx) => runTelescope(pi, ctx, args?.trim() || undefined),
	});

	pi.registerCommand("ts", {
		description: "Telescope (alias)",
		getArgumentCompletions: (prefix) => {
			const items = PROVIDER_NAMES
				.filter((n) => n.startsWith(prefix))
				.map((n) => ({ value: n, label: n }));
			return items.length > 0 ? items : null;
		},
		handler: (args, ctx) => runTelescope(pi, ctx, args?.trim() || undefined),
	});
}
