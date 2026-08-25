/**
 * Model Switcher (embedded in leader-key)
 *
 * A multi-step model selector with searchable lists:
 *   1. Pick a provider (searchable)
 *   2. Pick a model from that provider (searchable)
 *   3. Pick a thinking level (searchable)
 *
 * Exported for use by the leader-key extension.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Key, matchesKey } from "@earendil-works/pi-tui";
import { OverlayFrame } from "../shared/overlay.js";
import { withHerdrNavigationPassthrough } from "./herdr-navigation.js";

export const ALL_THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — only enabled & available providers & models
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderInfo {
	name: string;
	modelCount: number;
}

/**
 * Get the set of enabled model identifiers from settings.
 * Returns undefined when there is no filter (all models are enabled).
 */
function getEnabledModelSet(cwd: string): Set<string> | undefined {
	const sm = SettingsManager.create(cwd);
	const patterns = sm.getEnabledModels();
	if (!patterns || patterns.length === 0) return undefined;
	// enabledModels entries are "provider/modelId" exact strings (or globs, but
	// for our purposes exact membership check covers the common case).
	return new Set(patterns.map((p) => p.toLowerCase()));
}

/**
 * Check whether a model matches the enabledModels allowlist.
 * Supports exact "provider/modelId" entries and simple glob "*" patterns.
 */
function isModelEnabled(provider: string, modelId: string, enabled: Set<string> | undefined): boolean {
	if (!enabled) return true; // no filter → everything enabled
	const key = `${provider}/${modelId}`.toLowerCase();
	// Exact match first
	if (enabled.has(key)) return true;
	// Simple glob matching (supports trailing *, e.g. "anthropic/*")
	for (const pattern of enabled) {
		if (pattern.includes("*") || pattern.includes("?")) {
			const regex = new RegExp(
				"^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
			);
			if (regex.test(key)) return true;
		}
	}
	return false;
}

function getAvailableEnabledModels(ctx: ExtensionContext) {
	const enabled = getEnabledModelSet(ctx.cwd);
	return ctx.modelRegistry
		.getAvailable()
		.filter((m) => isModelEnabled(m.provider, m.id, enabled));
}

export function getProviders(ctx: ExtensionContext): ProviderInfo[] {
	const models = getAvailableEnabledModels(ctx);
	const providerMap = new Map<string, number>();

	for (const model of models) {
		providerMap.set(model.provider, (providerMap.get(model.provider) ?? 0) + 1);
	}

	return Array.from(providerMap.entries())
		.map(([name, count]) => ({ name, modelCount: count }))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getModelsForProvider(ctx: ExtensionContext, provider: string) {
	return getAvailableEnabledModels(ctx)
		.filter((m) => m.provider === provider)
		.sort((a, b) => a.name.localeCompare(b.name));
}

// ─────────────────────────────────────────────────────────────────────────────
// Searchable select UI — styled to match leader-key overlay
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchableCategory {
	id: string;
	label: string;
	order: number;
}

export interface SearchableItem {
	value: string;
	label: string;
	description?: string;
	category?: SearchableCategory;
}

export interface SearchableSelectAlternateAction<T extends string> {
	label: string;
	run(value: T): void | Promise<void>;
}

const MAX_VISIBLE = 15;

export function filterSearchableItems(
	items: readonly SearchableItem[],
	searchText: string,
): SearchableItem[] {
	if (searchText !== "") {
		return fuzzyFilter([...items], searchText, (item) => [
			item.label,
			item.value,
			item.description,
			item.category?.id,
			item.category?.label,
		].filter(Boolean).join(" "));
	}

	const unfiltered = [...items];
	if (!unfiltered.some((item) => item.category)) return unfiltered;

	return unfiltered.sort((left, right) =>
		(left.category?.order ?? Number.MAX_SAFE_INTEGER) - (right.category?.order ?? Number.MAX_SAFE_INTEGER)
		|| left.label.localeCompare(right.label),
	);
}

export function getSearchableWindow(
	items: readonly SearchableItem[],
	startIndex: number,
	maxRows: number,
	showCategoryHeadings = true,
): { items: SearchableItem[]; endIndex: number } {
	let endIndex = startIndex;
	let usedRows = 0;
	let previousCategoryId: string | undefined;

	while (endIndex < items.length) {
		const item = items[endIndex];
		const categoryChanged = showCategoryHeadings
			&& item.category !== undefined
			&& item.category.id !== previousCategoryId;
		const requestedRows = 1 + (categoryChanged ? 1 : 0);
		if (endIndex > startIndex && usedRows + requestedRows > maxRows) break;

		usedRows += requestedRows;
		previousCategoryId = item.category?.id;
		endIndex++;
	}

	return { items: items.slice(startIndex, endIndex), endIndex };
}

/** Simple word-wrap: split text into lines of at most maxWidth visible chars. */
function wrapText(text: string, maxWidth: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const test = current ? current + " " + word : word;
		if (test.length > maxWidth && current) {
			lines.push(current);
			current = word;
		} else {
			current = test;
		}
	}
	if (current) lines.push(current);
	return lines;
}

export async function searchableSelect<T extends string>(
	ctx: ExtensionContext,
	title: string,
	items: SearchableItem[],
	helpText?: string,
	defaultValue?: string,
	alternateAction?: SearchableSelectAlternateAction<T>,
): Promise<T | null> {
	let alternateValue: T | null = null;
	const selected = await withHerdrNavigationPassthrough(() => ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
		let searchText = "";
		let filteredItems = filterSearchableItems(items, searchText);
		const defaultIndex = defaultValue ? filteredItems.findIndex((item) => item.value === defaultValue) : -1;
		let highlightedIndex = defaultIndex >= 0 ? defaultIndex : 0;
		let scrollOffset = 0;
		let expandedDescriptionIndex: number | null = null;

		const th = theme;

		const applyFilter = () => {
			filteredItems = filterSearchableItems(items, searchText);
			highlightedIndex = 0;
			scrollOffset = 0;
			expandedDescriptionIndex = null;
		};

		const ensureVisible = () => {
			if (highlightedIndex < scrollOffset) {
				scrollOffset = highlightedIndex;
				return;
			}

			let window = getSearchableWindow(filteredItems, scrollOffset, MAX_VISIBLE);
			while (highlightedIndex >= window.endIndex && scrollOffset < highlightedIndex) {
				scrollOffset++;
				window = getSearchableWindow(filteredItems, scrollOffset, MAX_VISIBLE);
			}
		};

		const selectHighlighted = () => {
			if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
				done(filteredItems[highlightedIndex].value as T);
			}
		};

		const enterOrExpand = () => {
			const item = filteredItems[highlightedIndex];
			if (!item) return;
			if (item.description && expandedDescriptionIndex !== highlightedIndex) {
				expandedDescriptionIndex = highlightedIndex;
				tui.requestRender();
				return;
			}
			selectHighlighted();
		};

		return {
			render: (width: number) => {
				const f = new OverlayFrame(width, th);
				const lines: string[] = [];

				// Header
				lines.push(f.top());
				lines.push(f.row(th.fg("accent", th.bold(title))));

				// Search indicator
				if (searchText.length > 0) {
					lines.push(f.row(
						th.fg("muted", "search: ") + th.fg("accent", searchText) + th.fg("dim", "▏"),
					));
				}

				lines.push(f.separator());

				// Items
				if (filteredItems.length === 0) {
					lines.push(f.row(th.fg("warning", "  no matches")));
				} else {
					const showCategoryHeadings = searchText === "";
					const window = getSearchableWindow(
						filteredItems,
						scrollOffset,
						MAX_VISIBLE,
						showCategoryHeadings,
					);

					if (scrollOffset > 0) {
						lines.push(f.row(th.fg("dim", `  ↑ ${scrollOffset} more`)));
					}

					let previousCategoryId: string | undefined;
					for (let visibleIndex = 0; visibleIndex < window.items.length; visibleIndex++) {
						const i = scrollOffset + visibleIndex;
						const item = window.items[visibleIndex];
						const isHighlighted = i === highlightedIndex;
						const isExpanded = i === expandedDescriptionIndex;

						if (
							showCategoryHeadings
							&& item.category
							&& item.category.id !== previousCategoryId
						) {
							const heading = `── ${item.category.label} `;
							const divider = heading + "─".repeat(Math.max(0, f.innerWidth - heading.length));
							lines.push(f.row(th.fg("muted", divider)));
						}
						previousCategoryId = item.category?.id;

						const label = isHighlighted
							? th.fg("accent", th.bold(item.label))
							: th.fg("text", item.label);
						const categoryLabel = !showCategoryHeadings && item.category
							? th.fg("muted", `  ${item.category.label}`)
							: "";

						// Expanded view: spacious card with colored description
						if (isExpanded && item.description) {
							lines.push(f.row(""));
							lines.push(f.row(
								`${isHighlighted ? "> " : "  "}${th.fg("accent", th.bold("▸ " + item.label))}${categoryLabel}`,
							));
							const wrapped = wrapText(item.description, f.innerWidth - 4);
							for (const wrappedLine of wrapped) {
								lines.push(f.row("    " + th.fg("text", wrappedLine)));
							}
							lines.push(f.row(""));
							continue;
						}

						// Compact inline view
						let line = `${isHighlighted ? "> " : "  "}${label}${categoryLabel}`;
						if (item.description && !isExpanded) {
							line += "  " + th.fg("dim", item.description);
						}
						lines.push(f.rowTruncated(line));
					}

					const remaining = filteredItems.length - window.endIndex;
					if (remaining > 0) {
						lines.push(f.row(th.fg("dim", `  ↓ ${remaining} more`)));
					}
				}

				// Footer
				lines.push(f.separator());
				const primaryHint = [
					"type search",
					"↑↓ or C-j/k nav",
					"tab expand",
					...(alternateAction ? [`S-Enter ${alternateAction.label}`] : []),
				].join(" • ");
				const hintLines = helpText ? [helpText] : [primaryHint];
				hintLines.push("C-h back/collapse • C-l enter/expand • enter select • esc cancel");
				for (const hint of hintLines) {
					lines.push(f.row(th.fg("dim", hint)));
				}
				lines.push(f.bottom());

				return lines;
			},
			invalidate: () => {},
			handleInput: (data: string) => {
				// Escape / Ctrl+C: cancel
				if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
					done(null);
					return;
				}

				// Ctrl+H: collapse an expanded description, otherwise go back.
				if (matchesKey(data, Key.ctrl("h"))) {
					if (expandedDescriptionIndex !== null) {
						expandedDescriptionIndex = null;
						tui.requestRender();
					} else {
						done(null);
					}
					return;
				}

				// Backspace: collapse expansion, then trim search, then cancel
				if (matchesKey(data, "backspace")) {
					if (expandedDescriptionIndex !== null) {
						expandedDescriptionIndex = null;
						tui.requestRender();
					} else if (searchText.length > 0) {
						searchText = searchText.slice(0, -1);
						applyFilter();
						tui.requestRender();
					}
					return;
				}

				// Tab: toggle description expansion for highlighted item
				if (matchesKey(data, "tab")) {
					if (expandedDescriptionIndex === highlightedIndex) {
						expandedDescriptionIndex = null;
					} else if (filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
						expandedDescriptionIndex = highlightedIndex;
					}
					tui.requestRender();
					return;
				}

				// Navigation
				if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p")) || matchesKey(data, Key.ctrl("k"))) {
					highlightedIndex = Math.max(0, highlightedIndex - 1);
					ensureVisible();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n")) || matchesKey(data, Key.ctrl("j"))) {
					highlightedIndex = Math.min(filteredItems.length - 1, highlightedIndex + 1);
					ensureVisible();
					tui.requestRender();
					return;
				}

				// Shift+Enter: close, then run the caller's alternate action
				if (matchesKey(data, "shift+enter")) {
					if (alternateAction && filteredItems.length > 0 && highlightedIndex < filteredItems.length) {
						alternateValue = filteredItems[highlightedIndex].value as T;
						done(null);
					}
					return;
				}

				// Ctrl+L expands the highlighted description, then selects it.
				if (matchesKey(data, Key.ctrl("l"))) {
					enterOrExpand();
					return;
				}

				// Enter keeps its existing select behaviour.
				if (matchesKey(data, "enter")) {
					selectHighlighted();
					return;
				}

				// Printable characters: search
				if (data.length === 1 && data >= " " && data <= "~") {
					searchText += data;
					applyFilter();
					tui.requestRender();
					return;
				}
			},
		};
	}, {
		overlay: true,
		overlayOptions: {
			anchor: "center",
			width: 80,
			minWidth: 50,
			maxHeight: "80%",
		},
	}));

	const pendingAlternate = alternateValue as T | null;
	if (pendingAlternate !== null && alternateAction) {
		await alternateAction.run(pendingAlternate);
	}
	return selected;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-step flow
// ─────────────────────────────────────────────────────────────────────────────

export async function runModelSwitcher(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	// ── Step 1: Pick provider ──────────────────────────────────────────────
	const providers = getProviders(ctx);
	if (providers.length === 0) {
		ctx.ui.notify("No providers available", "warning");
		return;
	}

	const currentProvider = ctx.model?.provider;

	const providerItems: SearchableItem[] = providers.map((p) => {
		const isCurrent = p.name === currentProvider;
		const badge = isCurrent ? " (current)" : "";
		return {
			value: p.name,
			label: `${p.name}${badge}`,
			description: `${p.modelCount} model${p.modelCount !== 1 ? "s" : ""}`,
		};
	});

	const selectedProvider = await searchableSelect<string>(
		ctx,
		"Select Provider",
		providerItems,
	);
	if (!selectedProvider) return;

	// ── Step 2: Pick model from provider ──────────────────────────────────
	const models = getModelsForProvider(ctx, selectedProvider);
	if (models.length === 0) {
		ctx.ui.notify(`No models found for provider "${selectedProvider}"`, "warning");
		return;
	}

	const currentModelId = ctx.model?.id;

	const modelItems: SearchableItem[] = models.map((model) => {
		const isCurrent = model.provider === currentProvider && model.id === currentModelId;
		const badge = isCurrent ? " (current)" : "";
		const features: string[] = [];
		if (model.reasoning) features.push("reasoning");
		if (model.input.includes("image")) features.push("vision");
		const desc = features.length > 0 ? features.join(", ") : "";

		return {
			value: model.id,
			label: `${model.name}${badge}`,
			description: desc,
		};
	});

	const selectedModelId = await searchableSelect<string>(
		ctx,
		`Select Model (${selectedProvider})`,
		modelItems,
	);
	if (!selectedModelId) return;

	// ── Step 3: Pick thinking level ───────────────────────────────────────
	const selectedModel = ctx.modelRegistry.find(selectedProvider, selectedModelId);
	if (!selectedModel) {
		ctx.ui.notify(`Model ${selectedProvider}/${selectedModelId} not found`, "error");
		return;
	}

	const supportsReasoning = selectedModel.reasoning;
	let selectedThinking: ThinkingLevel = pi.getThinkingLevel();

	if (supportsReasoning) {
		const currentThinking = pi.getThinkingLevel();

		const thinkingItems: SearchableItem[] = ALL_THINKING_LEVELS.map((level) => {
			const isCurrent = level === currentThinking;
			return {
				value: level,
				label: isCurrent ? `${level} (current)` : level,
				description: getThinkingDescription(level),
			};
		});

		const thinkingChoice = await searchableSelect<ThinkingLevel>(
			ctx,
			`Thinking Level (${selectedModel.name})`,
			thinkingItems,
			"type to search • ↑↓ navigate • enter select • esc cancel",
		);

		if (!thinkingChoice) return;
		selectedThinking = thinkingChoice;
	}

	// ── Apply ─────────────────────────────────────────────────────────────
	const ok = await pi.setModel(selectedModel);
	if (!ok) {
		ctx.ui.notify(`No API key available for ${selectedProvider}/${selectedModelId}`, "warning");
		return;
	}

	if (supportsReasoning) {
		pi.setThinkingLevel(selectedThinking);
	}

	ctx.ui.notify(
		`Switched to ${selectedModel.name}${supportsReasoning ? ` (thinking: ${selectedThinking})` : ""}`,
		"info",
	);
}

export function getThinkingDescription(level: ThinkingLevel): string {
	switch (level) {
		case "off":
			return "No extended thinking";
		case "minimal":
			return "Minimal reasoning effort";
		case "low":
			return "Low reasoning effort";
		case "medium":
			return "Moderate reasoning effort";
		case "high":
			return "High reasoning effort";
		case "xhigh":
			return "Maximum reasoning effort";
		default:
			return "";
	}
}

/**
 * Interactive thinking level picker — opens a searchable select list of
 * all thinking levels and applies the chosen one immediately.
 */
export async function runThinkingPicker(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const currentThinking = pi.getThinkingLevel();

	const thinkingItems: SearchableItem[] = ALL_THINKING_LEVELS.map((level) => {
		const isCurrent = level === currentThinking;
		return {
			value: level,
			label: isCurrent ? `${level} (current)` : level,
			description: getThinkingDescription(level),
		};
	});

	const choice = await searchableSelect<ThinkingLevel>(
		ctx,
		"Select Thinking Level",
		thinkingItems,
	);

	if (!choice) return;

	pi.setThinkingLevel(choice);
	ctx.ui.notify(`Thinking: ${choice}`, "info");
}
