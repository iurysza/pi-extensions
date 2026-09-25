import assert from "node:assert/strict";
import test from "node:test";
import leaderKeyExtension from "../../extensions/leader-key/index.ts";
import { stashDraft } from "../../extensions/leader-key/stash-draft.ts";

function editor(initial) {
	let text = initial;
	const notices = [];
	const ui = {
		getEditorText: () => text,
		setEditorText: (next) => { text = next; },
		notify: (message, level) => { notices.push({ message, level }); },
	};
	return { ui, text: () => text, notices };
}

test("stash copies exact multiline text, then clears the editor", () => {
	const draft = editor("first line\nsecond line  ");
	const copied = [];
	stashDraft(draft.ui, (text) => { copied.push(text); return true; });
	assert.deepEqual(copied, ["first line\nsecond line  "]);
	assert.equal(draft.text(), "");
	assert.equal(draft.notices[0].message, "Draft copied to clipboard.");
});

test("failed copy or empty input never destroys the draft", () => {
	const draft = editor("keep me");
	stashDraft(draft.ui, () => false);
	assert.equal(draft.text(), "keep me");
	assert.equal(draft.notices[0].level, "error");
	const blank = editor("");
	stashDraft(blank.ui, () => { throw new Error("should not copy empty input"); });
	assert.equal(blank.notices[0].message, "Nothing to stash");
});

test("Leader Key registers Ctrl+S only for the interactive editor", () => {
	const shortcuts = new Map();
	leaderKeyExtension({
		registerCommand() {},
		registerShortcut: (key, options) => shortcuts.set(key, options),
		on() {},
	});
	assert.ok(shortcuts.has("ctrl+x"));
	const handler = shortcuts.get("ctrl+s")?.handler;
	assert.equal(typeof handler, "function");
	const draft = editor("");
	handler({ mode: "json", ui: draft.ui });
	assert.equal(draft.notices.length, 0);
	handler({ mode: "tui", ui: draft.ui });
	assert.equal(draft.notices[0].message, "Nothing to stash");
});
