/**
 * Shared types for leader-key extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface ActionItem {
	key: string; // single character shortcut
	label: string;
	description?: string;
	action: (ctx: ExtensionContext) => void | Promise<void>;
	shiftAction?: (ctx: ExtensionContext) => void | Promise<void>;
}

export interface ActionGroup {
	key: string; // chord key to open this group
	label: string;
	items: MenuEntry[];
}

export type TopLevelEntry =
	| { type: "group"; group: ActionGroup }
	| { type: "action"; key: string; label: string; description?: string; action: (ctx: ExtensionContext) => void | Promise<void>; shiftAction?: (ctx: ExtensionContext) => void | Promise<void>; expandableItems?: ActionItem[] };

/** Existing group children are ActionItems; nested groups and moved home entries use TopLevelEntry. */
export type MenuEntry = TopLevelEntry | ActionItem;

export function entryKey(entry: MenuEntry): string {
	return "type" in entry && entry.type === "group" ? entry.group.key : entry.key;
}
