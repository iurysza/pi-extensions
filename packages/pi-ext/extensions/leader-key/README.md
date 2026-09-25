# Leader Key menus

In the main Pi editor, Ctrl+S copies the current draft to the system clipboard and clears the editor only after a successful copy. Paste to restore it. This is a single clipboard slot: another copy replaces the draft. Empty input and copy failures leave the editor unchanged. Ctrl+S keeps its existing meaning inside Pi's model, thinking, and session pickers. Only text is copied, not attachments.

`Ctrl+X` opens the home menu. `e` keeps the searchable Extensions command picker. `o` opens More when an extension contributes a menu or home entries are placed there. Team and Voice remain at the root with `g` and `v`.

## Select a skill

Skills and Writing style insert `󱚊 name` before the current draft. Selecting another skill replaces only that tag. The glyph is Material Design Nerd Font `md-book_cog` (U+F168A). For example, selecting `pr-review` while editing `Review this diff` yields `󱚊 pr-review Review this diff`.

On interactive submission, Leader Key checks that the skill still exists and translates the tag into Pi's native `/skill:pr-review` command. An unknown tag stays in the editor with a warning. A valid tag can be sent without a request; Pi then loads the skill and starts a model turn. Typed `/skill:name` commands still work. The tag is editable text, not a styled editor component.

## Register an extension menu

Other extensions contribute without importing Leader Key. Register each slash command with `pi.registerCommand`, then listen for `command-menu:collect:v1`:

```ts
pi.events.on("command-menu:collect:v1", (data) => {
	if (!data || typeof data !== "object" || (data as { version?: unknown }).version !== 1) return;
	const request = data as { version: 1; add(group: unknown): void };
	request.add({
		id: "example-tools",
		key: "z",
		label: "Tools",
		items: [
			{ key: "b", label: "Browse", items: [
				{ key: "o", label: "Open tools", command: { name: "tools-open", args: "recent" } },
			] },
		],
	});
});
```

This appears at `Ctrl+X → o More → z Tools → b Browse → o Open tools`. A group can contain command items or further groups. The handler must call `add` synchronously. Leader Key closes collection when the event returns. Subscribe when your extension loads. Pi clears extension listeners on reload; call the returned disposer if you stop contributing before reload. Each palette open starts a fresh collection.

`id` is a nonempty unique string. Keys are distinct lowercase letters among siblings; labels must be nonempty. `command.name` must name an available extension command and contain only letters, digits, `:`, `.`, `_`, or `-`, starting with a letter or digit. Optional `args` cannot contain newlines. Leader Key rejects invalid groups, duplicate IDs, occupied keys, duplicate sibling keys, cycles, and missing commands with a warning. A command removed after opening the palette is not invoked.

The command runs through Pi's native slash-command dispatcher after the overlay closes. This needs Pi 0.85.1 or newer for `sendUserMessage(..., { expandPromptTemplates: true })`. It does not edit the user's prompt. Only the IDs in `ROOT_EXTENSION_MENU_IDS` in `index.ts` bypass More; other registered menus use More by default.

## Rearrange the home menu

Edit `HOME_GROUPS` in `index.ts` to move existing home entries by their shortcut keys. The action code stays where it is. For example:

```ts
const HOME_GROUPS = [
	{ key: "b", label: "Build", children: ["c", "r"] },
	{ key: "o", label: "More", children: ["b"] },
];
```

This puts Spec and Review under Build, then puts Build under More. Entries move in the order listed. A child key must identify exactly one entry at its current level. A new group key cannot already be used at that level. Leave `o` for More so extension menus can join it. `groupEntries` in `layout.ts` also works on any group's `items` when rearranging a nested menu directly.

Inside the overlay, a letter enters a group or runs an action. Enter and Ctrl+L select the highlighted entry. Ctrl+H, Backspace, and Escape go back one level; at home they close the overlay. Tab expands an expandable action at any level.
