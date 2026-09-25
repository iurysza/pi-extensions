import { entryKey, type MenuEntry } from "./types.js";

/** Move existing entries into a submenu, in the order listed by their keys. */
export function groupEntries(
	entries: readonly MenuEntry[],
	group: { key: string; label: string; children: readonly string[] },
): MenuEntry[] {
	const children = group.children.map((key) => {
		const matches = entries.filter((entry) => entryKey(entry) === key);
		if (matches.length !== 1) throw new Error(`Leader Key: expected one entry for ${key}`);
		return matches[0];
	});
	if (new Set(group.children).size !== group.children.length || entries.some((entry) => entryKey(entry) === group.key)) {
		throw new Error(`Leader Key: duplicate menu key ${group.key}`);
	}
	return [
		...entries.filter((entry) => !group.children.includes(entryKey(entry))),
		{ type: "group", group: { key: group.key, label: group.label, items: children } },
	];
}
