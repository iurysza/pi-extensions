/**
 * Pi-Telescope Types
 *
 * Core interfaces for the fuzzy finder provider system.
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

/**
 * An action available for a provider's items.
 */
export interface ProviderAction {
	/** Key to trigger this action (single char, e.g. "o") */
	key: string;
	/** Display label */
	label: string;
	/** Optional description */
	description?: string;
}

/**
 * A data provider for the telescope fuzzy finder.
 *
 * Each provider supplies a list of items, defines how they're displayed,
 * searched, previewed, and what happens on selection.
 */
export interface TelescopeProvider<T = any> {
	/** Unique identifier */
	name: string;
	/** Display icon (emoji) */
	icon: string;
	/** Short description */
	description: string;

	/** Load all items. Called once when the provider is activated. */
	load(cwd: string): Promise<T[]> | T[];

	/** Extract searchable text from an item (used by fuzzy matcher). */
	getSearchText(item: T): string;

	/** Format item for display in the list. May include ANSI via theme. */
	getDisplayText(item: T, theme: Theme, highlighted?: string): string;

	/** Handle item selection (open file, run command, etc.) */
	onSelect(item: T, ctx: ExtensionContext): void | Promise<void>;

	/** Return preview lines for the selected item. Null = no preview.
	 *  Theme is provided for rich rendering (e.g. Markdown, styled pills). */
	getPreview?(item: T, maxLines: number, theme?: Theme): string[] | Promise<string[]> | null;

	/**
	 * If true, telescope calls search() on each keystroke instead of
	 * filtering the pre-loaded list. Used for grep/ripgrep.
	 */
	supportsDynamicSearch?: boolean;

	/** Dynamic search — called when supportsDynamicSearch is true. */
	search?(query: string, cwd: string): Promise<T[]>;

	/** Handle multi-select (Enter with multiple selected items). */
	onMultiSelect?(items: T[], ctx: ExtensionContext): void | Promise<void>;

	/** Provider-specific actions (shown in action picker via Ctrl+E). */
	actions?: ProviderAction[];

	/** Handle a custom action. actionKey matches ProviderAction.key. */
	onAction?(actionKey: string, items: T[], ctx: ExtensionContext): void | Promise<void>;

	/** Key for frecency tracking. Defaults to getSearchText if not provided. */
	getFrecencyKey?(item: T): string;
}

/** A scored item after fuzzy matching. */
export interface ScoredItem<T = any> {
	item: T;
	score: number;
	/** Character indices that matched the query (for highlighting). */
	indices: number[];
}

/** Options passed to openTelescope. */
export interface TelescopeOptions {
	/** All available provider factories, for Ctrl+R switching. */
	allProviders?: Record<string, () => TelescopeProvider>;
	/** Initial query text. */
	initialQuery?: string;
}
