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

export interface HomeSection { title: string; keys: readonly string[] }

/**
 * Order home entries by section. Unlisted entries keep their order after the sections,
 * so nothing disappears. `headings` maps an entry index to the divider drawn above it.
 */
export function sectionEntries(
	entries: readonly MenuEntry[],
	sections: readonly HomeSection[],
	footer: readonly string[],
): { entries: MenuEntry[]; headings: Map<number, string> } {
	const byKey = new Map(entries.map((entry) => [entryKey(entry), entry]));
	const placed = new Set<string>();
	const ordered: MenuEntry[] = [];
	const headings = new Map<number, string>();
	const take = (keys: readonly string[], title: string) => {
		const found = keys.filter((key) => byKey.has(key) && !placed.has(key));
		if (!found.length) return;
		headings.set(ordered.length, title);
		for (const key of found) { placed.add(key); ordered.push(byKey.get(key)!); }
	};
	for (const section of sections) take(section.keys, section.title);
	const rest = entries.map(entryKey).filter((key) => !placed.has(key) && !footer.includes(key));
	take(rest, "Other");
	take(footer, "");
	return { entries: ordered, headings };
}
