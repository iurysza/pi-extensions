/**
 * Leader Key Extension
 *
 * Press Ctrl+X to open a floating command palette showing all available
 * actions organised into groups (like Vim's which-key or Emacs' leader key).
 *
 * Each group has a single-character chord key. Press the chord to see the
 * group's actions, then press the action key to execute.
 *
 * Navigation:
 *   - Chord keys shown in the palette (e.g. "s" for Session, "m" for Model)
 *   - Backspace / Escape to go back or close
 *   - Direct key press executes the action immediately
 *
 * The palette auto-discovers extension commands and merges them with
 * built-in actions (session, model, etc.).
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { matchesKey, parseKey, Key } from "@earendil-works/pi-tui";
import { searchableSelect } from "./model-switcher.js";
import { runFavouriteModels } from "./favourite-models.js";
import { OverlayFrame } from "../shared/overlay.js";
import { copyToClipboard } from "../pi-telescope/clipboard.js";
import type { ActionItem, ActionGroup, TopLevelEntry } from "./types.js";
import { buildSessionEntries } from "./session-actions.js";
import { buildLabelEntries } from "./label-actions.js";
import { registerBridgeCommands } from "./context-helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// Build top-level entries
// ─────────────────────────────────────────────────────────────────────────────

function buildEntries(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	openFavouriteModels: (ctx: ExtensionContext) => Promise<void>,
): TopLevelEntry[] {
	const entries: TopLevelEntry[] = [];

	// ── Session ─────────────────────────────────────────────────────────
	entries.push(buildSessionEntries(pi));

	// ── Labels ──────────────────────────────────────────────────────────
	entries.push(buildLabelEntries(pi));

	// ── Scoped models ───────────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "m",
		label: "Scoped",
		description: "quick-switch Pi scoped models",
		action: (ctx) => openFavouriteModels(ctx),
	});

	// ── Permissions mode ────────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "p",
		label: "Permissions",
		description: "switch permission mode",
		action: async (ctx) => {
			const ALL_MODES = ["yolo", "safe", "read-only"] as const;
			const MODE_DESCRIPTIONS: Record<string, string> = {
				yolo: "all commands allowed, no checks",
				safe: "permission rules active",
				"read-only": "read-only, no writes except /tmp",
			};

			const items = ALL_MODES.map((m) => ({
				value: m,
				label: m,
				description: MODE_DESCRIPTIONS[m],
			}));

			const selected = await searchableSelect<string>(
				ctx,
				"Select Permission Mode",
				items,
			);

			if (selected) {
				ctx.ui.setEditorText(`/mode ${selected}`);
				setTimeout(() => process.stdin.emit("data", "\r"), 0);
			}
		},
	});

	// ── Extension commands (auto-discovered, searchable picker) ─────────
	const commands = pi.getCommands();
	const extCommands = commands.filter((c) => c.source === "extension");

	const builtinCommandNames = new Set([
		"new", "resume", "tree", "fork", "compact",
		"model", "thinking", "tools", "reload",
		"switch", "lk", "leader-key",
		"mode", "permissions",
		"lk-navigate", "lk-switch", // internal bridge commands
	]);

	const customCommands = extCommands.filter((c) => !builtinCommandNames.has(c.name));

	if (customCommands.length > 0) {
		const extItems = customCommands.map((cmd) => ({
			key: cmd.name[0],
			label: cmd.name,
			description: cmd.description || "extension",
			action: (ctx: ExtensionContext) => pi.sendUserMessage(`/${cmd.name}`),
		}));
		entries.push({
			type: "action",
			key: "e",
			label: "Extensions",
			description: `${customCommands.length} command${customCommands.length !== 1 ? "s" : ""}`,
			action: async (ctx) => {
				const items = customCommands.map((cmd) => ({
					value: cmd.name,
					label: cmd.name,
					description: cmd.description || "extension",
				}));

				const selected = await searchableSelect<string>(
					ctx,
					"Select Extension Command",
					items,
				);

				if (selected) {
					pi.sendUserMessage(`/${selected}`);
				}
			},
			expandableItems: extItems,
		});
	}

	// ── Skills ──────────────────────────────────────────────────────────
	const skillCommands = commands.filter((c) => c.source === "skill");

	if (skillCommands.length > 0) {
		const skItems = skillCommands.map((cmd) => ({
			key: cmd.name[0],
			label: cmd.name,
			description: cmd.description || "skill",
			action: (ctx: ExtensionContext) => {
				ctx.ui.setEditorText(`/${cmd.name} `);
				ctx.ui.notify(`Type your prompt after /${cmd.name}`, "info");
			},
		}));
		entries.push({
			type: "action",
			key: "k",
			label: "Skills",
			description: `${skillCommands.length} skill${skillCommands.length !== 1 ? "s" : ""}`,
			action: async (ctx) => {
				const items = skillCommands.map((cmd) => ({
					value: cmd.name,
					label: cmd.name,
					description: cmd.description || "skill",
				}));

				const selected = await searchableSelect<string>(
					ctx,
					"Select Skill",
					items,
				);

				if (selected) {
					ctx.ui.setEditorText(`/${selected} `);
					ctx.ui.notify(`Type your prompt after /${selected}`, "info");
				}
			},
			expandableItems: skItems,
		});
	}

	// ── Spec (OpenSpec workflow) ────────────────────────────────────────
	const stageSpec = (cmd: string, hint: string) => (ctx: ExtensionContext) => {
		ctx.ui.setEditorText(cmd);
		ctx.ui.notify(hint, "info");
	};
	entries.push({
		type: "group",
		group: {
			key: "c",
			label: "Spec",
			items: [
				{
					key: "e",
					label: "Explore",
					description: "openspec — investigate before proposing",
					action: stageSpec("/opsx-explore ", "Describe what to explore, then Enter"),
				},
				{
					key: "s",
					label: "Spec",
					description: "openspec — propose a change (proposal + specs + tasks)",
					action: stageSpec("/opsx-propose ", "Describe the change, then Enter"),
				},
				{
					key: "a",
					label: "Apply",
					description: "openspec — implement interactively in this session",
					action: stageSpec("/opsx-apply ", "Optionally add a change name, then Enter"),
				},
				{
					key: "r",
					label: "Review",
					description: "gate panel taskflow on the current working tree",
					action: stageSpec("/tf:openspec-review ", 'Add change=<id> if needed, then Enter'),
				},
				{
					key: "x",
					label: "Archive",
					description: "openspec — merge spec deltas and archive the change",
					action: stageSpec("/opsx-archive ", "Optionally add a change name, then Enter"),
				},
			],
		},
	});

	// ── Review / Annotate ───────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "r",
		label: "Review",
		description: "code review UI",
		action: (ctx) => {
			ctx.ui.setEditorText("/plannotator-review");
			setTimeout(() => process.stdin.emit("data", "\r"), 0);
		},
	});

	entries.push({
		type: "action",
		key: "a",
		label: "Annotate last",
		description: "annotate last assistant message",
		action: (ctx) => {
			ctx.ui.setEditorText("/plannotator-last");
			setTimeout(() => process.stdin.emit("data", "\r"), 0);
		},
	});

	// ── Copy last response ──────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "y",
		label: "Copy last response",
		description: "copy assistant message to clipboard",
		action: (ctx: ExtensionContext) => {
			const entries = ctx.sessionManager.getEntries();
			for (let i = entries.length - 1; i >= 0; i--) {
				const e = entries[i];
				if (e.type === "message" && (e.message as any).role === "assistant") {
					const content = (e.message as any).content;
					const textParts: string[] = [];
					if (Array.isArray(content)) {
						for (const block of content) {
							if (block.type === "text" && block.text) textParts.push(block.text);
						}
					}
					const text = textParts.join("\n");
					if (text) {
						if (copyToClipboard(text)) {
							ctx.ui.notify(`Copied (${text.length} chars)`, "info");
						} else {
							ctx.ui.notify("Clipboard copy failed", "error");
						}
					} else {
						ctx.ui.notify("Last response has no text content", "info");
					}
					return;
				}
			}
			ctx.ui.notify("No assistant message found", "info");
		},
	});

	// ── Exit ─────────────────────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "q",
		label: "Exit",
		description: "quit pi",
		action: (ctx) => {
			ctx.ui.setEditorText("/quit");
			setTimeout(() => process.stdin.emit("data", "\r"), 0);
		},
	});

	return entries;
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay component
// ─────────────────────────────────────────────────────────────────────────────

type View = { type: "root" } | { type: "group"; group: ActionGroup };

const MAX_EXPANDED_VISIBLE = 12;

function parsePaletteKey(data: string): { key: string; shifted: boolean } | null {
	const parsed = parseKey(data);
	if (parsed) {
		const parts = parsed.split("+");
		const rawKey = parts[parts.length - 1];
		const key = rawKey.toLowerCase();
		const modifiers = parts.slice(0, -1).map((p) => p.toLowerCase());
		const plain = modifiers.length === 0;
		const shifted = modifiers.length === 1 && modifiers[0] === "shift" || (plain && rawKey >= "A" && rawKey <= "Z");
		if ((plain || shifted) && key.length === 1 && key >= "a" && key <= "z") {
			return { key, shifted };
		}
	}

	// Legacy terminals may send Shift+letter as an uppercase printable char.
	if (data.length === 1 && data >= "A" && data <= "Z") {
		return { key: data.toLowerCase(), shifted: true };
	}
	if (data.length === 1 && data >= "a" && data <= "z") {
		return { key: data, shifted: false };
	}
	return null;
}

class LeaderKeyOverlay {
	private view: View = { type: "root" };
	private entries: TopLevelEntry[];
	private theme: Theme;
	private done: (result: ActionItem | null) => void;
	private highlightedIndex = 0;
	private expandedEntryIndex: number | null = null;
	private expandedHighlightIndex = 0;
	private scrollOffset = 0;

	constructor(
		entries: TopLevelEntry[],
		theme: Theme,
		done: (result: ActionItem | null) => void,
	) {
		this.entries = entries;
		this.theme = theme;
		this.done = done;
	}

	private get currentItems(): Array<{ key: string; label: string; description?: string }> {
		if (this.expandedEntryIndex !== null) {
			const entry = this.entries[this.expandedEntryIndex];
			if (entry?.type === "action" && entry.expandableItems) {
				return entry.expandableItems;
			}
		}
		if (this.view.type === "root") {
			return this.entries.map((e) => {
				if (e.type === "group") {
					return {
						key: e.group.key,
						label: e.group.label,
						description: `${e.group.items.length} action${e.group.items.length !== 1 ? "s" : ""}`,
					};
				}
				return {
					key: e.key,
					label: e.label,
					description: e.description,
				};
			});
		}
		return this.view.group.items;
	}

	private get isExpanded(): boolean {
		return this.expandedEntryIndex !== null;
	}

	private expandCurrent(): void {
		if (this.view.type !== "root") return;
		const entry = this.entries[this.highlightedIndex];
		if (entry?.type === "action" && entry.expandableItems && entry.expandableItems.length > 0) {
			this.expandedEntryIndex = this.highlightedIndex;
			this.expandedHighlightIndex = 0;
			this.scrollOffset = 0;
		}
	}

	private collapseExpanded(): void {
		this.expandedEntryIndex = null;
		this.expandedHighlightIndex = 0;
		this.scrollOffset = 0;
	}

	private resolveAction(action: ActionItem, shifted: boolean): ActionItem {
		if (shifted && action.shiftAction) {
			return { ...action, action: action.shiftAction };
		}
		return action;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
			if (this.isExpanded) {
				this.collapseExpanded();
				return;
			}
			if (this.view.type === "group") {
				this.view = { type: "root" };
				this.highlightedIndex = 0;
			} else {
				this.done(null);
			}
			return;
		}

		if (matchesKey(data, "backspace")) {
			if (this.isExpanded) {
				this.collapseExpanded();
				return;
			}
			if (this.view.type === "group") {
				this.view = { type: "root" };
				this.highlightedIndex = 0;
			} else {
				this.done(null);
			}
			return;
		}

		// Tab: toggle expand/collapse for expandable items
		if (matchesKey(data, "tab")) {
			if (this.isExpanded) {
				this.collapseExpanded();
			} else if (this.view.type === "root") {
				this.expandCurrent();
			}
			return;
		}

		// Arrow keys for highlighting
		if (matchesKey(data, "up")) {
			if (this.isExpanded) {
				this.expandedHighlightIndex = Math.max(0, this.expandedHighlightIndex - 1);
				this.ensureExpandedVisible();
			} else {
				this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
			}
			return;
		}
		if (matchesKey(data, "down")) {
			const items = this.currentItems;
			if (this.isExpanded) {
				this.expandedHighlightIndex = Math.min(items.length - 1, this.expandedHighlightIndex + 1);
				this.ensureExpandedVisible();
			} else {
				this.highlightedIndex = Math.min(items.length - 1, this.highlightedIndex + 1);
			}
			return;
		}

		// Enter to select highlighted item
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			if (this.isExpanded) {
				const entry = this.entries[this.expandedEntryIndex!];
				if (entry?.type === "action" && entry.expandableItems) {
					const action = entry.expandableItems[this.expandedHighlightIndex];
					if (action) {
						this.done(action);
					}
				}
				return;
			}
			const items = this.currentItems;
			if (this.highlightedIndex >= 0 && this.highlightedIndex < items.length) {
				const item = items[this.highlightedIndex];
				if (this.view.type === "root") {
					this.handleRootSelection(item.key);
				} else {
					const action = this.view.group.items.find((a) => a.key === item.key);
					if (action) {
						this.done(action);
					}
				}
			}
			return;
		}

		// Direct key press — Shift+letter runs the tab/window variant when available
		const parsed = parsePaletteKey(data);
		if (parsed) {
			const { key, shifted } = parsed;

			if (this.isExpanded) {
				// In expanded mode, direct key jumps to item starting with that letter
				const entry = this.entries[this.expandedEntryIndex!];
				if (entry?.type === "action" && entry.expandableItems) {
					const idx = entry.expandableItems.findIndex((a) => a.key === key || a.label.toLowerCase().startsWith(key));
					if (idx >= 0) {
						this.expandedHighlightIndex = idx;
						this.scrollOffset = idx;
					}
				}
				return;
			}

			if (this.view.type === "root") {
				this.handleRootSelection(key, shifted);
			} else {
				const action = this.view.group.items.find((a) => a.key === key);
				if (action) {
					this.done(this.resolveAction(action, shifted));
				}
			}
		}
	}

	private ensureExpandedVisible(): void {
		if (this.expandedHighlightIndex < this.scrollOffset) {
			this.scrollOffset = this.expandedHighlightIndex;
		} else if (this.expandedHighlightIndex >= this.scrollOffset + MAX_EXPANDED_VISIBLE) {
			this.scrollOffset = this.expandedHighlightIndex - MAX_EXPANDED_VISIBLE + 1;
		}
	}

	private handleRootSelection(key: string, shifted = false): void {
		const entry = this.entries.find((e) => {
			if (e.type === "group") return e.group.key === key;
			return e.key === key;
		});
		if (!entry) return;

		if (entry.type === "group") {
			this.view = { type: "group", group: entry.group };
			this.highlightedIndex = 0;
		} else {
			// Direct action — wrap it as an ActionItem and fire
			this.done(this.resolveAction({
				key: entry.key,
				label: entry.label,
				description: entry.description,
				action: entry.action,
				shiftAction: entry.shiftAction,
			}, shifted));
		}
	}

	render(width: number): string[] {
		const th = this.theme;
		const f = new OverlayFrame(width, th);
		const lines: string[] = [];

		// Header
		lines.push(f.top());

		if (this.isExpanded) {
			const entry = this.entries[this.expandedEntryIndex!];
			const label = entry?.type === "action" ? entry.label : "";
			const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold(label)) + th.fg("dim", " (expanded)");
			lines.push(f.row(breadcrumb));
		} else if (this.view.type === "root") {
			lines.push(f.row(th.fg("accent", th.bold("Leader Key"))));
		} else {
			const g = this.view.group;
			const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold(g.label));
			lines.push(f.row(breadcrumb));
		}

		lines.push(f.separator());

		// Items
		const items = this.currentItems;
		if (items.length === 0) {
			lines.push(f.row(th.fg("muted", "  (no items)")));
		} else if (this.isExpanded) {
			// Expanded view with scrolling
			const visibleEnd = Math.min(this.scrollOffset + MAX_EXPANDED_VISIBLE, items.length);

			if (this.scrollOffset > 0) {
				lines.push(f.row(th.fg("dim", `  ↑ ${this.scrollOffset} more`)));
			}

			for (let i = this.scrollOffset; i < visibleEnd; i++) {
				const item = items[i];
				const isHighlighted = i === this.expandedHighlightIndex;

				const label = isHighlighted
					? th.fg("accent", th.bold(item.label))
					: th.fg("text", item.label);

				let line = `${isHighlighted ? "> " : "  "}${label}`;

				if (item.description) {
					line += "  " + th.fg("dim", item.description);
				}

				lines.push(f.row(line));
			}

			const remaining = items.length - visibleEnd;
			if (remaining > 0) {
				lines.push(f.row(th.fg("dim", `  ↓ ${remaining} more`)));
			}
		} else {
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const isHighlighted = i === this.highlightedIndex;

				const keyBadge = th.fg("warning", th.bold(`[${item.key}]`));
				const label = isHighlighted
					? th.fg("accent", th.bold(item.label))
					: th.fg("text", item.label);

				// Show a chevron for groups in root view, or tab hint for highlighted expandable items
				let suffix = "";
				if (this.view.type === "root") {
					const entry = this.entries.find((e) => {
						if (e.type === "group") return e.group.key === item.key;
						return e.key === item.key;
					});
					if (entry?.type === "group") {
						suffix = " " + th.fg("dim", ">");
					} else if (isHighlighted && entry?.type === "action" && entry.expandableItems) {
						suffix = " " + th.fg("dim", "[tab expand]");
					}
				}

				let line = `${isHighlighted ? "> " : "  "}${keyBadge} ${label}${suffix}`;

				if (item.description) {
					line += "  " + th.fg("dim", item.description);
				}

				lines.push(f.rowTruncated(line));
			}
		}

		// Footer
		lines.push(f.separator());

		if (this.isExpanded) {
			lines.push(f.row(th.fg("dim", "↑↓ scroll | enter run | tab collapse | esc back")));
		} else if (this.view.type === "root") {
			lines.push(f.row(th.fg("dim", "press key to select | tab expand | esc close")));
		} else {
			lines.push(f.row(th.fg("dim", "press key run | ⇧ key tab | bksp back | esc close")));
		}

		lines.push(f.bottom());

		return lines;
	}

	invalidate(): void {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Extension
// ─────────────────────────────────────────────────────────────────────────────

export default function leaderKeyExtension(pi: ExtensionAPI) {
	// Register internal commands that bridge shortcut→command context
	registerBridgeCommands(pi);

	let stopFavouriteModelsShortcut: (() => void) | undefined;
	let favouriteModelsOpen = false;

	async function openFavouriteModels(ctx: ExtensionContext) {
		if (!ctx.hasUI || favouriteModelsOpen) return;

		favouriteModelsOpen = true;
		try {
			await runFavouriteModels(pi, ctx);
		} finally {
			favouriteModelsOpen = false;
		}
	}

	async function openLeaderKey(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;

		const entries = buildEntries(pi, ctx, openFavouriteModels);

		const selected = await ctx.ui.custom<ActionItem | null>(
			(tui, theme, _kb, done) => {
				const overlay = new LeaderKeyOverlay(entries, theme, done);
				return {
					render: (w: number) => overlay.render(w),
					invalidate: () => overlay.invalidate(),
					handleInput: (data: string) => {
						overlay.handleInput(data);
						tui.requestRender();
					},
				};
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "center",
					width: 80,
					minWidth: 50,
					maxHeight: "80%",
				},
			},
		);

		if (selected) {
			try {
				await selected.action(ctx);
			} catch (err) {
				ctx.ui.notify(`Action failed: ${err}`, "error");
			}
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;

		stopFavouriteModelsShortcut?.();
		stopFavouriteModelsShortcut = ctx.ui.onTerminalInput((data) => {
			if (parseKey(data) !== Key.ctrl("m")) return;
			void openFavouriteModels(ctx);
			return { consume: true };
		});
	});

	pi.on("session_shutdown", async () => {
		stopFavouriteModelsShortcut?.();
		stopFavouriteModelsShortcut = undefined;
	});

	// Register as a command
	pi.registerCommand("lk", {
		description: "Open Leader Key palette",
		handler: async (_args, ctx) => {
			await openLeaderKey(ctx);
		},
	});

	// Register shortcut: Ctrl+X
	pi.registerShortcut(Key.ctrl("x"), {
		description: "Open Leader Key",
		handler: async (ctx) => {
			await openLeaderKey(ctx);
		},
	});
}
