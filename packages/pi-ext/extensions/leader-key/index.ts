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
 *   - Ctrl+J / Ctrl+K to move down / up
 *   - Ctrl+H to go back or collapse; Ctrl+L to enter or expand
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
import { launchSkillEditor } from "./skill-editor.js";
import { categorizeSkillCommands, skillCommandLabel } from "./skill-categories.js";
import { handleSkillTagInput, selectSkill, SKILL_TAG } from "./skill-tag.js";
import { OverlayFrame } from "../shared/overlay.js";
import { copyToClipboard } from "../pi-telescope/clipboard.js";
import { stashDraft } from "./stash-draft.js";
import { saveLastResponse } from "../chat-to-md/index.js";
import { entryKey, type ActionItem, type ActionGroup, type MenuEntry, type TopLevelEntry } from "./types.js";
import { groupEntries } from "./layout.js";
import { buildSessionEntries } from "./session-actions.js";
import { buildLabelEntries } from "./label-actions.js";
import { collectCommandMenus } from "./contributions.js";
import { registerBridgeCommands } from "./context-helpers.js";
import {
	clearHerdrNavigationPassthrough,
	withHerdrNavigationPassthrough,
} from "./herdr-navigation.js";

const ROOT_EXTENSION_MENU_IDS = ["themed-agents", "pi-voice"];
const CONTRIBUTED_EXTENSION_COMMAND_NAMES = new Set(["team", "voice"]);
// Move home entries by listing their existing keys; no action implementation needs to move.
const HOME_GROUPS: { key: string; label: string; children: string[] }[] = [];

// ─────────────────────────────────────────────────────────────────────────────
// Build top-level entries
// ─────────────────────────────────────────────────────────────────────────────

function buildEntries(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	openFavouriteModels: (ctx: ExtensionContext) => Promise<void>,
): MenuEntry[] {
	const entries: TopLevelEntry[] = [];

	// ── Session ─────────────────────────────────────────────────────────
	entries.push(buildSessionEntries(pi));

	// ── Labels ──────────────────────────────────────────────────────────
	entries.push(buildLabelEntries(pi));

	const commands = pi.getCommands();

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
	const extCommands = commands.filter((c) => c.source === "extension");

	const builtinCommandNames = new Set([
		"new", "resume", "tree", "fork", "compact",
		"model", "thinking", "tools", "reload",
		"switch", "lk", "leader-key",
		"mode", "permissions", "chat-to-md",
		"lk-navigate", "lk-switch", // internal bridge commands
	]);

	const customCommands = extCommands.filter((c) => !builtinCommandNames.has(c.name) && !CONTRIBUTED_EXTENSION_COMMAND_NAMES.has(c.name));

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
	const categorizedSkillCommands = categorizeSkillCommands(commands);
	const skillCommands = categorizedSkillCommands.map(({ command }) => command);

	if (skillCommands.length > 0) {
		const skItems = skillCommands.map((cmd) => {
			const label = skillCommandLabel(cmd.name);
			return {
				key: label[0],
				label,
				description: cmd.description || "skill",
				action: (ctx: ExtensionContext) => {
					ctx.ui.setEditorText(selectSkill(ctx.ui.getEditorText(), label));
					ctx.ui.notify(`Type your prompt after ${SKILL_TAG} ${label}`, "info");
				},
			};
		});
		entries.push({
			type: "action",
			key: "k",
			label: "Skills",
			description: `${skillCommands.length} skill${skillCommands.length !== 1 ? "s" : ""}`,
			action: async (ctx) => {
				const items = categorizedSkillCommands.map(({ command, category }) => ({
					value: command.name,
					label: skillCommandLabel(command.name),
					description: command.description || "skill",
					category,
				}));

				const selected = await searchableSelect<string>(
					ctx,
					"Select Skill",
					items,
					undefined,
					undefined,
					{
						label: "open",
						run: async (skillName) => {
							const command = skillCommands.find((candidate) => candidate.name === skillName);
							if (!command) return;
							try {
								const target = await launchSkillEditor(pi, command.sourceInfo.path);
								ctx.ui.notify(`Opened ${skillName} in ${target}`, "info");
							} catch (error) {
								const message = error instanceof Error ? error.message : String(error);
								ctx.ui.notify(`Unable to open ${skillName}: ${message}`, "error");
							}
						},
					},
				);

				if (selected) {
					const label = skillCommandLabel(selected);
					ctx.ui.setEditorText(selectSkill(ctx.ui.getEditorText(), label));
					ctx.ui.notify(`Type your prompt after ${SKILL_TAG} ${label}`, "info");
				}
			},
			expandableItems: skItems,
		});
	}

	// ── Writing styles ──────────────────────────────────────────────────
	const writingStyleCommands = categorizedSkillCommands
		.filter(({ category }) => category.id === "writing-style")
		.map(({ command }) => command);

	if (writingStyleCommands.length > 0) {
		const writingStyleItems = writingStyleCommands.map((cmd) => {
			const label = skillCommandLabel(cmd.name);
			return {
				key: label[0],
				label,
				description: cmd.description || "writing style",
				action: (ctx: ExtensionContext) => {
					ctx.ui.setEditorText(selectSkill(ctx.ui.getEditorText(), label));
					ctx.ui.notify(`Type your prompt after ${SKILL_TAG} ${label}`, "info");
				},
			};
		});

		entries.push({
			type: "action",
			key: "t",
			label: "Writing style",
			description: `${writingStyleCommands.length} style${writingStyleCommands.length !== 1 ? "s" : ""}`,
			action: async (ctx) => {
				const items = writingStyleCommands.map((cmd) => ({
					value: cmd.name,
					label: skillCommandLabel(cmd.name),
					description: cmd.description || "writing style",
				}));

				const selected = await searchableSelect<string>(
					ctx,
					"Select Writing Style",
					items,
					undefined,
					undefined,
					{
						label: "open",
						run: async (skillName) => {
							const command = writingStyleCommands.find((candidate) => candidate.name === skillName);
							if (!command) return;
							try {
								const target = await launchSkillEditor(pi, command.sourceInfo.path);
								ctx.ui.notify(`Opened ${skillCommandLabel(skillName)} in ${target}`, "info");
							} catch (error) {
								const message = error instanceof Error ? error.message : String(error);
								ctx.ui.notify(`Unable to open ${skillCommandLabel(skillName)}: ${message}`, "error");
							}
						},
					},
				);

				if (selected) {
					const label = skillCommandLabel(selected);
					ctx.ui.setEditorText(selectSkill(ctx.ui.getEditorText(), label));
					ctx.ui.notify(`Type your prompt after ${SKILL_TAG} ${label}`, "info");
				}
			},
			expandableItems: writingStyleItems,
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

	// ── Save last response ───────────────────────────────────────────────
	entries.push({
		type: "action",
		key: "w",
		label: "Save last response",
		description: "write assistant message to ai-artifacts/chat",
		action: async (ctx: ExtensionContext) => {
			await saveLastResponse(pi, ctx);
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

	return HOME_GROUPS.reduce<MenuEntry[]>((menu, group) => groupEntries(menu, group), entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay component
// ─────────────────────────────────────────────────────────────────────────────

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

export class LeaderKeyOverlay {
	private entries: MenuEntry[];
	private groups: ActionGroup[] = [];
	private highlights = [0];
	private theme: Theme;
	private done: (result: ActionItem | null) => void;
	private expandedEntryIndex: number | null = null;
	private expandedHighlightIndex = 0;
	private scrollOffset = 0;

	constructor(
		entries: MenuEntry[],
		theme: Theme,
		done: (result: ActionItem | null) => void,
	) {
		this.entries = entries;
		this.theme = theme;
		this.done = done;
	}

	private get currentEntries(): MenuEntry[] {
		return this.groups.at(-1)?.items ?? this.entries;
	}

	private get highlightedIndex(): number {
		return this.highlights[this.highlights.length - 1];
	}

	private set highlightedIndex(value: number) {
		this.highlights[this.highlights.length - 1] = value;
	}

	private get currentItems(): Array<{ key: string; label: string; description?: string }> {
		if (this.expandedEntryIndex !== null) {
			const entry = this.currentEntries[this.expandedEntryIndex];
			if (entry && "expandableItems" in entry && entry.expandableItems) return entry.expandableItems;
		}
		return this.currentEntries.map((entry) => "type" in entry && entry.type === "group"
			? { key: entry.group.key, label: entry.group.label, description: `${entry.group.items.length} item${entry.group.items.length !== 1 ? "s" : ""}` }
			: { key: entryKey(entry), label: entry.label, description: entry.description });
	}

	private get isExpanded(): boolean {
		return this.expandedEntryIndex !== null;
	}

	private expandCurrent(): void {
		const entry = this.currentEntries[this.highlightedIndex];
		if (entry && "expandableItems" in entry && entry.expandableItems && entry.expandableItems.length > 0) {
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

	private goBack(): void {
		if (this.isExpanded) {
			this.collapseExpanded();
			return;
		}
		if (this.groups.length > 0) {
			this.groups.pop();
			this.highlights.pop();
		} else {
			this.done(null);
		}
	}

	private selectHighlighted(): void {
		if (this.isExpanded) {
			const entry = this.currentEntries[this.expandedEntryIndex!];
			if (entry && "expandableItems" in entry && entry.expandableItems) {
				const action = entry.expandableItems[this.expandedHighlightIndex];
				if (action) this.done(action);
			}
			return;
		}
		const entry = this.currentEntries[this.highlightedIndex];
		if (entry) this.selectEntry(entry);
	}

	private enterOrExpand(): void {
		if (!this.isExpanded) {
			const entry = this.currentEntries[this.highlightedIndex];
			if (entry && "expandableItems" in entry && entry.expandableItems?.length) {
				this.expandCurrent();
				return;
			}
		}
		this.selectHighlighted();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
			this.goBack();
			return;
		}

		if (matchesKey(data, Key.ctrl("h")) || matchesKey(data, "backspace")) {
			this.goBack();
			return;
		}

		// Tab: toggle expand/collapse for expandable items
		if (matchesKey(data, "tab")) {
			if (this.isExpanded) this.collapseExpanded();
			else this.expandCurrent();
			return;
		}

		// Arrow and control keys for highlighting
		if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("k"))) {
			if (this.isExpanded) {
				this.expandedHighlightIndex = Math.max(0, this.expandedHighlightIndex - 1);
				this.ensureExpandedVisible();
			} else {
				this.highlightedIndex = Math.max(0, this.highlightedIndex - 1);
			}
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("j"))) {
			const items = this.currentItems;
			if (this.isExpanded) {
				this.expandedHighlightIndex = Math.min(items.length - 1, this.expandedHighlightIndex + 1);
				this.ensureExpandedVisible();
			} else {
				this.highlightedIndex = Math.min(items.length - 1, this.highlightedIndex + 1);
			}
			return;
		}

		// Ctrl+L expands an expandable entry, otherwise it selects it.
		if (matchesKey(data, Key.ctrl("l"))) {
			this.enterOrExpand();
			return;
		}

		// Enter keeps its existing select behaviour.
		if (matchesKey(data, "enter") || matchesKey(data, "return")) {
			this.selectHighlighted();
			return;
		}

		// Direct key press — Shift+letter runs the tab/window variant when available
		const parsed = parsePaletteKey(data);
		if (parsed) {
			const { key, shifted } = parsed;

			if (this.isExpanded) {
				// In expanded mode, direct key jumps to item starting with that letter
				const entry = this.currentEntries[this.expandedEntryIndex!];
				if (entry && "expandableItems" in entry && entry.expandableItems) {
					const idx = entry.expandableItems.findIndex((a) => a.key === key || a.label.toLowerCase().startsWith(key));
					if (idx >= 0) {
						this.expandedHighlightIndex = idx;
						this.scrollOffset = idx;
					}
				}
				return;
			}

			const entry = this.currentEntries.find((candidate) => entryKey(candidate) === key);
			if (entry) this.selectEntry(entry, shifted);
		}
	}

	private ensureExpandedVisible(): void {
		if (this.expandedHighlightIndex < this.scrollOffset) {
			this.scrollOffset = this.expandedHighlightIndex;
		} else if (this.expandedHighlightIndex >= this.scrollOffset + MAX_EXPANDED_VISIBLE) {
			this.scrollOffset = this.expandedHighlightIndex - MAX_EXPANDED_VISIBLE + 1;
		}
	}

	private selectEntry(entry: MenuEntry, shifted = false): void {
		if ("type" in entry && entry.type === "group") {
			this.groups.push(entry.group);
			this.highlights.push(0);
			return;
		}
		if (!("type" in entry)) {
			this.done(this.resolveAction(entry, shifted));
			return;
		}
		this.done(this.resolveAction({
			key: entry.key,
			label: entry.label,
			description: entry.description,
			action: entry.action,
			shiftAction: entry.shiftAction,
		}, shifted));
	}

	render(width: number): string[] {
		const th = this.theme;
		const f = new OverlayFrame(width, th);
		const lines: string[] = [];

		// Header
		lines.push(f.top());

		if (this.isExpanded) {
			const entry = this.currentEntries[this.expandedEntryIndex!];
			const label = entry && !("type" in entry && entry.type === "group") ? entry.label : "";
			const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold([...this.groups.map((group) => group.label), label].join(" › "))) + th.fg("dim", " (expanded)");
			lines.push(f.rowTruncated(breadcrumb));
		} else if (this.groups.length === 0) {
			lines.push(f.row(th.fg("accent", th.bold("Leader Key"))));
		} else {
			const breadcrumb = th.fg("dim", "< ") + th.fg("accent", th.bold(this.groups.map((group) => group.label).join(" › ")));
			lines.push(f.rowTruncated(breadcrumb));
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

				// Show a chevron for groups at any depth, or tab hint for expandable items.
				let suffix = "";
				const entry = this.currentEntries[i];
				if (entry && "type" in entry && entry.type === "group") {
					suffix = " " + th.fg("dim", ">");
				} else if (isHighlighted && entry && "expandableItems" in entry && entry.expandableItems) {
					suffix = " " + th.fg("dim", "[tab expand]");
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
			lines.push(f.row(th.fg("dim", "↑↓ or C-j/k scroll | C-l/enter run | C-h/tab collapse | esc back")));
		} else if (this.groups.length === 0) {
			lines.push(f.row(th.fg("dim", "C-j/k nav | C-l enter/expand | key select | tab expand | esc close")));
		} else {
			lines.push(f.row(th.fg("dim", "C-j/k nav | C-h back | C-l/enter run | key run | esc close")));
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

	pi.on("input", (event, ctx) => event.source === "interactive"
		? handleSkillTagInput(event.text, pi, ctx)
		: { action: "continue" });

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

		const entries = collectCommandMenus(pi, buildEntries(pi, ctx, openFavouriteModels), (message) => ctx.ui.notify(message, "warning"), ROOT_EXTENSION_MENU_IDS);

		const selected = await withHerdrNavigationPassthrough(() => ctx.ui.custom<ActionItem | null>(
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
		));

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

		clearHerdrNavigationPassthrough();
		stopFavouriteModelsShortcut?.();
		stopFavouriteModelsShortcut = ctx.ui.onTerminalInput((data) => {
			if (parseKey(data) !== Key.ctrl("m")) return;
			void openFavouriteModels(ctx);
			return { consume: true };
		});
	});

	pi.on("session_shutdown", async () => {
		clearHerdrNavigationPassthrough();
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

	pi.registerShortcut(Key.ctrl("s"), {
		description: "Copy and clear current draft",
		handler: (ctx) => {
			if (ctx.mode === "tui") stashDraft(ctx.ui);
		},
	});
}
