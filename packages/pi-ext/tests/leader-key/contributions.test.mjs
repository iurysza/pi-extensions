import assert from "node:assert/strict";
import test from "node:test";

import { collectCommandMenus, COMMAND_MENU_COLLECT } from "../../extensions/leader-key/contributions.ts";
import { LeaderKeyOverlay } from "../../extensions/leader-key/index.ts";

const group = (id = "sample", key = "z") => ({
	id, key, label: "Sample",
	items: [{ key: "o", label: "Open", command: { name: "sample", args: "open" } }],
});

function fixture() {
	const listeners = new Set();
	const messages = [];
	const warnings = [];
	const commands = new Set(["sample"]);
	const pi = {
		events: {
			on(_event, callback) {
				listeners.add(callback);
				return () => listeners.delete(callback);
			},
			emit(event, request) {
				assert.equal(event, COMMAND_MENU_COLLECT);
				for (const callback of listeners) callback(request);
			},
		},
		getCommands: () => [...commands].map((name) => ({ name, source: "extension" })),
		sendUserMessage: (text, options) => messages.push({ text, options }),
	};
	const ctx = { ui: { notify: (...args) => warnings.push(args) } };
	const collect = (entries = [], rootIds = []) => collectCommandMenus(pi, entries, (message) => ctx.ui.notify(message, "warning"), rootIds);
	return { pi, ctx, collect, commands, messages, warnings };
}

test("collects fresh groups in either load order without a permanent registry", () => {
	const { pi, collect } = fixture();
	const empty = collect();
	assert.deepEqual(empty, []);
	const dispose = pi.events.on(COMMAND_MENU_COLLECT, (request) => request.add(group()));
	assert.equal(collect().length, 1);
	assert.equal(collect().length, 1);
	dispose();
	assert.deepEqual(collect(), []);
	pi.events.on(COMMAND_MENU_COLLECT, (request) => request.add(group()));
	assert.equal(collect().length, 1);
});

test("Team and Voice can contribute distinct root submenus", () => {
	const { pi, collect, commands, ctx, messages } = fixture();
	commands.add("team");
	commands.add("voice");
	pi.events.on(COMMAND_MENU_COLLECT, (request) => request.add({ ...group("themed-agents", "g"), label: "Team", items: [{ key: "o", label: "Open", command: { name: "team", args: "open" } }] }));
	pi.events.on(COMMAND_MENU_COLLECT, (request) => request.add({ ...group("pi-voice", "v"), label: "Voice", items: [{ key: "s", label: "Start", command: { name: "voice", args: "start" } }] }));
	const entries = collect([], ["themed-agents", "pi-voice"]);
	assert.deepEqual(entries.map((entry) => entry.group.key), ["g", "v"]);
	for (const [key, child] of [["g", "o"], ["v", "s"]]) {
		let selected;
		const overlay = new LeaderKeyOverlay(entries, {}, (item) => { selected = item; });
		overlay.handleInput(key);
		overlay.handleInput(child);
		selected.action(ctx);
	}
	assert.deepEqual(messages.map(({ text }) => text), ["/team open", "/voice start"]);
});

test("extension menus may nest command branches inside More", () => {
	const { pi, collect, ctx, messages, commands, warnings } = fixture();
	const cyclic = [];
	cyclic.push({ key: "c", label: "Cycle", items: cyclic });
	pi.events.on(COMMAND_MENU_COLLECT, (request) => {
		request.add({ id: "invalid", key: "i", label: "Invalid", items: cyclic });
		request.add({ id: "duplicate", key: "d", label: "Duplicate", items: [
			{ key: "a", label: "First", command: { name: "sample" } },
			{ key: "a", label: "Second", command: { name: "sample" } },
		] });
		request.add({ id: "nested", key: "z", label: "Tools", items: [
			{ key: "b", label: "Browse", items: [{ key: "o", label: "Open", command: { name: "sample", args: "open" } }] },
		] });
	});
	const entries = collect();
	assert.deepEqual(entries.map((entry) => entry.group.key), ["o"]);
	assert.equal(warnings.length, 2);
	let selected;
	const overlay = new LeaderKeyOverlay(entries, {}, (item) => { selected = item; });
	for (const key of ["o", "z", "b", "o"]) overlay.handleInput(key);
	selected.action(ctx);
	assert.deepEqual(messages.map(({ text }) => text), ["/sample open"]);
	commands.delete("sample");
	selected.action(ctx);
	assert.equal(messages.length, 1);
	assert.match(warnings.at(-1)[0], /no longer available/);
});

test("More reuses a prearranged home group and rejects occupied child keys", () => {
	const { pi, collect, warnings } = fixture();
	pi.events.on(COMMAND_MENU_COLLECT, (request) => {
		request.add(group("one", "z"));
		request.add(group("two", "z"));
	});
	const entries = collect([{ type: "group", group: { key: "o", label: "More", items: [{ type: "action", key: "r", label: "Review", action() {} }] } }]);
	assert.deepEqual(entries.map((entry) => entry.group.key), ["o"]);
	assert.deepEqual(entries[0].group.items.map((entry) => entry.type === "group" ? entry.group.key : entry.key), ["r", "z"]);
	assert.equal(warnings.length, 1);
});

test("invalid, duplicated, colliding and unavailable contributions cannot displace existing keys", () => {
	const { pi, collect, warnings } = fixture();
	pi.events.on(COMMAND_MENU_COLLECT, (request) => {
		request.add({ ...group("bad", "b"), items: [{ key: "o", label: "Open", command: { name: "sample" } }, { key: "o", label: "Again", command: { name: "sample" } }] });
		request.add({ ...group("unsafe", "u"), items: [{ key: "x", label: "Unsafe", command: { name: "sample", args: "open\n/quit" } }] });
		request.add({ ...group("wrong-key", "b"), items: [{ key: 42, label: "Wrong", command: { name: "sample" } }] });
		request.add(group("occupied", "g"));
		request.add(group("sample", "z"));
		request.add(group("sample", "a"));
		request.add(group("different", "z"));
		request.add({ ...group("missing", "x"), items: [{ key: "m", label: "Missing", command: { name: "missing" } }] });
	});
	const entries = collect([{ type: "action", key: "g", label: "Pinned", action() {} }], ["occupied"]);
	assert.deepEqual(entries.map((entry) => entry.type === "group" ? entry.group.key : entry.key), ["g", "o"]);
	assert.deepEqual(entries[1].group.items.map((entry) => entry.group.key), ["z"]);
	assert.equal(warnings.length, 7);
});

test("late additions cannot alter an open menu", async () => {
	const { pi, collect } = fixture();
	let captured;
	pi.events.on(COMMAND_MENU_COLLECT, (request) => { captured = request; queueMicrotask(() => request.add(group())); });
	const entries = collect();
	await Promise.resolve();
	assert.deepEqual(entries, []);
	captured.add(group());
	assert.deepEqual(collect().map((entry) => entry.group.key), []);
});

test("closing the overlay precedes registered-command dispatch without touching the editor", () => {
	const { pi, collect, ctx, commands, messages, warnings } = fixture();
	pi.events.on(COMMAND_MENU_COLLECT, (request) => request.add(group()));
	const entries = collect([{ type: "action", key: "e", label: "Extensions", action() {} }]);
	assert.deepEqual(entries.map((entry) => entry.type === "group" ? entry.group.key : entry.key), ["e", "o"]);
	let selected;
	let closed = false;
	const overlay = new LeaderKeyOverlay(entries, {}, (action) => { selected = action; closed = true; });
	overlay.handleInput("o"); // More
	overlay.handleInput("z"); // Sample
	overlay.handleInput("o"); // Open
	assert.equal(closed, true);
	assert.equal(messages.length, 0);
	selected.action(ctx);
	assert.deepEqual(messages, [{ text: "/sample open", options: { expandPromptTemplates: true } }]);
	commands.delete("sample");
	selected.action(ctx);
	assert.equal(messages.length, 1);
	assert.match(warnings.at(-1)[0], /no longer available/);
});
