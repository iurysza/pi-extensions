import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { entryKey, type ActionGroup, type MenuEntry } from "./types.js";

export const COMMAND_MENU_COLLECT = "command-menu:collect:v1";

type CommandItem =
	| { key: string; label: string; command: { name: string; args?: string } }
	| { key: string; label: string; items: readonly CommandItem[] };

export interface CommandMenuGroup {
	id: string;
	key: string;
	label: string;
	items: readonly CommandItem[];
}

export interface CollectCommandMenusV1 {
	version: 1;
	add(group: unknown): void;
}

const SHORTCUT = /^[a-z]$/;
const COMMAND = /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/;

function parseItems(value: unknown, ancestors: Set<object>): CommandItem[] | undefined {
	if (!Array.isArray(value) || value.length === 0 || ancestors.has(value)) return;
	ancestors.add(value);
	const keys = new Set<string>();
	const items: CommandItem[] = [];
	for (const raw of value) {
		if (!raw || typeof raw !== "object") return;
		const item = raw as Partial<CommandItem> & { command?: { name?: unknown; args?: unknown }; items?: unknown };
		if (typeof item.key !== "string" || !SHORTCUT.test(item.key) || keys.has(item.key)
			|| typeof item.label !== "string" || !item.label.trim()) return;
		keys.add(item.key);
		if (item.command !== undefined && item.items === undefined) {
			if (!item.command || typeof item.command.name !== "string" || !COMMAND.test(item.command.name)
				|| (item.command.args !== undefined && (typeof item.command.args !== "string" || /[\r\n]/.test(item.command.args)))) return;
			items.push({ key: item.key, label: item.label, command: { name: item.command.name, args: typeof item.command.args === "string" ? item.command.args : undefined } });
		} else if (item.command === undefined && item.items !== undefined) {
			const children = parseItems(item.items, ancestors);
			if (!children) return;
			items.push({ key: item.key, label: item.label, items: children });
		} else return;
	}
	ancestors.delete(value);
	return items;
}

function parseGroup(value: unknown): CommandMenuGroup | undefined {
	if (!value || typeof value !== "object") return;
	const group = value as Partial<CommandMenuGroup>;
	if (typeof group.id !== "string" || !group.id.trim() || group.id !== group.id.trim()
		|| typeof group.key !== "string" || !SHORTCUT.test(group.key) || typeof group.label !== "string" || !group.label.trim()) return;
	const items = parseItems(group.items, new Set());
	if (!items) return;
	return { id: group.id, key: group.key, label: group.label, items };
}

/** Collect fresh descriptions synchronously; callbacks from earlier opens cannot mutate this menu. */
export function collectCommandMenus(
	pi: Pick<ExtensionAPI, "events" | "getCommands" | "sendUserMessage">,
	entries: MenuEntry[],
	notify: (message: string) => void,
	rootIds: readonly string[] = [],
): MenuEntry[] {
	const result = [...entries];
	const ids = new Set<string>();
	const keys = new Set(entries.map(entryKey));
	const existingMore = result.find((entry) => "type" in entry && entry.type === "group" && entry.group.key === "o" && entry.group.label === "More");
	let more: ActionGroup | undefined = existingMore && "type" in existingMore && existingMore.type === "group" ? existingMore.group : undefined;
	let accepting = true;
	const available = (name: string) => pi.getCommands().some((command) => command.name === name && command.source === "extension");
	const commandsAvailable = (items: readonly CommandItem[]): boolean => items.every((item) => "items" in item
		? commandsAvailable(item.items)
		: available(item.command.name));
	const adapt = (item: CommandItem): MenuEntry => {
		if ("items" in item) return { type: "group", group: { key: item.key, label: item.label, items: item.items.map(adapt) } };
		return {
			type: "action",
			key: item.key,
			label: item.label,
			action: (ctx: ExtensionContext) => {
				if (!available(item.command.name)) {
					ctx.ui.notify(`Leader Key: /${item.command.name} is no longer available`, "warning");
					return;
				}
				// Pi 0.85+ supports native command dispatch; this package's local 0.82 declarations lag behind.
				(pi.sendUserMessage as (content: string, options: { expandPromptTemplates: true }) => void)(
					`/${item.command.name}${item.command.args ? ` ${item.command.args}` : ""}`,
					{ expandPromptTemplates: true },
				);
			},
		};
	};
	const request: CollectCommandMenusV1 = {
		version: 1,
		add(value) {
			if (!accepting) return;
			const group = parseGroup(value);
			if (!group) {
				notify("Leader Key: ignored an invalid command-menu group");
				return;
			}
			const atRoot = rootIds.includes(group.id);
			const occupied = atRoot ? keys.has(group.key) : (keys.has("o") && !more) || more?.items.some((entry) => entryKey(entry) === group.key);
			if (ids.has(group.id) || occupied) {
				notify(`Leader Key: ignored ${group.id} (duplicate ID or occupied key ${group.key})`);
				return;
			}
			if (!commandsAvailable(group.items)) {
				notify(`Leader Key: ignored ${group.id} (extension command unavailable)`);
				return;
			}
			ids.add(group.id);
			if (atRoot) keys.add(group.key);
			else if (!more) {
				more = { key: "o", label: "More", items: [] };
				keys.add("o");
				result.push({ type: "group", group: more });
			}
			const entry: MenuEntry = { type: "group", group: { key: group.key, label: group.label, items: group.items.map(adapt) } };
			if (atRoot) result.push(entry);
			else more!.items.push(entry);
		},
	};
	try {
		pi.events.emit(COMMAND_MENU_COLLECT, request);
	} finally {
		accepting = false;
	}
	return result;
}
