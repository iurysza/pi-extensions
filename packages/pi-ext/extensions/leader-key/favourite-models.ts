/**
 * Scoped Models Picker
 *
 * Reads the profile model catalog, grouping by tier when configured.
 * If no sidecar exists, shows only the current model with a hint.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { matchesKey, parseKey, Key, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { OverlayFrame, padToWidth } from "../shared/overlay.js";
import { ALL_THINKING_LEVELS } from "./model-switcher.js";
import { THINKING_ROLES } from "../shared/thinking-colors.js";
import { buildPickerViewModel, loadModelCatalog } from "./model-catalog.mjs";
import { withHerdrNavigationPassthrough } from "./herdr-navigation.js";

const TIER_LABELS = { workhorse: "Workhorse", frontier: "Frontier", budget: "Budget" } as const;

interface FavouriteModelEntry {
	label: string;
	provider: string;
	model: string;
	thinking?: ThinkingLevel;
	tier?: keyof typeof TIER_LABELS;
}

interface ModelRow {
	type: "model";
	fav: FavouriteModelEntry;
	modelIndex: number;
}

interface HeaderRow {
	type: "header";
	label: string;
}

type DisplayRow = ModelRow | HeaderRow;

function buildDisplayRows(favourites: FavouriteModelEntry[], tiered: boolean): DisplayRow[] {
	const providerCounts = new Map<string, number>();
	if (!tiered) {
		for (const { provider } of favourites) providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
	}

	const rows: DisplayRow[] = [];
	let lastGroup: string | undefined;
	for (const [modelIndex, fav] of favourites.entries()) {
		const group = tiered ? (fav.tier ? TIER_LABELS[fav.tier] : "Other") : fav.provider;
		if (group !== lastGroup) {
			rows.push({ type: "header", label: tiered ? group : `${group} (${providerCounts.get(group)})` });
			lastGroup = group;
		}
		rows.push({ type: "model", fav, modelIndex });
	}
	return rows;
}

function nextModelRow(rows: DisplayRow[], from: number, dir: -1 | 1): number {
	let i = from + dir;
	while (i >= 0 && i < rows.length) {
		if (rows[i].type === "model") return i;
		i += dir;
	}
	return from;
}

function nthModelRow(rows: DisplayRow[], n: number): number {
	let count = 0;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].type === "model") {
			if (count === n) return i;
			count++;
		}
	}
	return -1;
}

const THINKING_SHORTCUTS: Record<string, ThinkingLevel> = {
	o: "off",
	i: "minimal",
	l: "low",
	m: "medium",
	h: "high",
	x: "xhigh",
	a: "max",
};

function getPrintableKey(data: string): string | null {
	const parsed = parseKey(data);
	if (parsed && parsed.length === 1 && parsed >= " " && parsed <= "~") {
		return parsed.toLowerCase();
	}
	if (data.length === 1 && data >= " " && data <= "~") {
		return data.toLowerCase();
	}
	return null;
}

function loadScopedModels(pi: ExtensionAPI, ctx: ExtensionContext): { entries: FavouriteModelEntry[]; fallbackHint?: string } {
	return buildPickerViewModel({
		catalog: loadModelCatalog(),
		availableModels: ctx.modelRegistry.getAvailable(),
		currentModel: ctx.model,
		currentThinking: pi.getThinkingLevel(),
	});
}

interface PickerResult {
	fav: FavouriteModelEntry;
	thinking: ThinkingLevel;
}

export async function runFavouriteModels(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const { entries: favourites, fallbackHint } = loadScopedModels(pi, ctx);
	if (favourites.length === 0) {
		ctx.ui.notify(fallbackHint ?? "No scoped models available. Use /scoped-models or configure API keys", "warning");
		return;
	}

	const currentModel = ctx.model;
	const currentThinking = pi.getThinkingLevel();

	const thinkingIndices: number[] = favourites.map((fav) => {
		const idx = fav.thinking ? ALL_THINKING_LEVELS.indexOf(fav.thinking) : -1;
		return idx >= 0 ? idx : ALL_THINKING_LEVELS.indexOf(currentThinking);
	});

	const tiered = favourites.some((fav) => fav.tier !== undefined);
	const rows = buildDisplayRows(favourites, tiered);
	const longestLabel = tiered ? Math.max(...favourites.map((fav) => visibleWidth(fav.label))) : 0;
	const firstModelRow = rows.findIndex((r) => r.type === "model");

	const selected = await withHerdrNavigationPassthrough(() => ctx.ui.custom<PickerResult | null>(
		(tui, theme, _kb, done) => {
			let highlightedIndex = firstModelRow >= 0 ? firstModelRow : 0;
			const th = theme;

			const getModelIndex = (): number => {
				const row = rows[highlightedIndex];
				return row?.type === "model" ? row.modelIndex : -1;
			};

			return {
				render: (width: number) => {
					const f = new OverlayFrame(width, th);
					const lines: string[] = [];

					lines.push(f.top());
					lines.push(f.row(th.fg("accent", th.bold("Scoped Models"))));
					lines.push(f.separator());

					// Leave room for the shortcut, active dot, and longest thinking tag.
					const labelWidth = Math.min(longestLabel, Math.max(0, f.innerWidth - 19));
					for (let i = 0; i < rows.length; i++) {
						const row = rows[i];

						if (row.type === "header") {
							const header = tiered ? row.label : `──${` ${row.label} `.padEnd(f.innerWidth - 2, "─")}`;
							lines.push(f.rowTruncated(tiered ? th.fg("muted", th.bold(header)) : th.fg("dim", header)));
							continue;
						}

						const fav = row.fav;
						const isHighlighted = i === highlightedIndex;
						const mi = row.modelIndex;

						const isCurrent =
							currentModel?.provider === fav.provider &&
							currentModel?.id === fav.model;

						const name = tiered ? truncateToWidth(fav.label, labelWidth) : fav.label;
						const label = isHighlighted ? th.fg("accent", th.bold(name)) : th.fg("text", name);
						const currentBadge = isCurrent ? th.fg("success", "●") : " ";

						const thinking = ALL_THINKING_LEVELS[thinkingIndices[mi]];
						const thinkingRole = THINKING_ROLES[thinking] ?? "dim";
						const thinkingTag = isHighlighted
							? th.fg("dim", "‹") + th.fg(thinkingRole, ` ${thinking} `) + th.fg("dim", "›")
							: (tiered ? "  " : "") + th.fg(thinkingRole, thinking);

						const num = th.fg("dim", mi < 9 ? `${mi + 1}` : "·");
						const nameAndBadge = tiered ? `${padToWidth(label, labelWidth)} ${currentBadge}` : `${label}${isCurrent ? ` ${currentBadge}` : ""}`;
						lines.push(f.rowTruncated(`${isHighlighted ? "> " : "  "}${num} ${nameAndBadge}  ${thinkingTag}`));
					}

					lines.push(f.separator());
					if (fallbackHint) lines.push(f.rowTruncated(th.fg("warning", fallbackHint)));
					const provider = tiered ? favourites[getModelIndex()]?.provider : undefined;
					lines.push(f.rowTruncated(th.fg("dim", `${provider ? `${provider} · ` : ""}j/k move · 1–9 jump · ←/→ thinking`)));
					lines.push(f.rowTruncated(th.fg("dim", "o/i/l/m/h/x/a thinking · Enter select · Esc cancel")));
					lines.push(f.bottom());

					return lines;
				},
				invalidate: () => {},
				handleInput: (data: string) => {
					if (matchesKey(data, "escape") || matchesKey(data, Key.ctrl("c"))) {
						done(null);
						return;
					}

					if (matchesKey(data, "backspace")) {
						done(null);
						return;
					}

					const key = getPrintableKey(data);

					if (matchesKey(data, "up") || matchesKey(data, Key.ctrl("p")) || key === "k") {
						highlightedIndex = nextModelRow(rows, highlightedIndex, -1);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "down") || matchesKey(data, Key.ctrl("n")) || key === "j") {
						highlightedIndex = nextModelRow(rows, highlightedIndex, 1);
						tui.requestRender();
						return;
					}

					if (matchesKey(data, "left")) {
						const mi = getModelIndex();
						if (mi >= 0) {
							thinkingIndices[mi] = (thinkingIndices[mi] - 1 + ALL_THINKING_LEVELS.length) % ALL_THINKING_LEVELS.length;
							tui.requestRender();
						}
						return;
					}
					if (matchesKey(data, "right")) {
						const mi = getModelIndex();
						if (mi >= 0) {
							thinkingIndices[mi] = (thinkingIndices[mi] + 1) % ALL_THINKING_LEVELS.length;
							tui.requestRender();
						}
						return;
					}

					if (key) {
						const num = parseInt(key, 10);
						const modelCount = rows.filter((r) => r.type === "model").length;
						if (num >= 1 && num <= Math.min(9, modelCount)) {
							const target = nthModelRow(rows, num - 1);
							if (target >= 0) highlightedIndex = target;
							tui.requestRender();
							return;
						}
					}

					if (key) {
						const shortcutThinking = THINKING_SHORTCUTS[key];
						if (shortcutThinking) {
							const mi = getModelIndex();
							if (mi >= 0) {
								thinkingIndices[mi] = ALL_THINKING_LEVELS.indexOf(shortcutThinking);
								tui.requestRender();
							}
							return;
						}
					}

					if (matchesKey(data, "enter")) {
						const row = rows[highlightedIndex];
						if (row?.type === "model") {
							done({
								fav: row.fav,
								thinking: ALL_THINKING_LEVELS[thinkingIndices[row.modelIndex]],
							});
						}
					}
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

	if (!selected) return;

	const modelInfo = ctx.modelRegistry.find(selected.fav.provider, selected.fav.model);
	if (!modelInfo) {
		ctx.ui.notify(`Model ${selected.fav.provider}/${selected.fav.model} not found in registry`, "error");
		return;
	}

	const ok = await pi.setModel(modelInfo);
	if (!ok) {
		ctx.ui.notify(`No API key available for ${selected.fav.provider}/${selected.fav.model}`, "warning");
		return;
	}
	pi.setThinkingLevel(selected.thinking);

	ctx.ui.notify(
		`Switched to ${selected.fav.label} (thinking: ${selected.thinking})`,
		"info",
	);
}
