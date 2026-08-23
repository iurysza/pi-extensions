import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { LeaderKeyOverlay } from "../../extensions/leader-key/index.ts";
import { withHerdrNavigationPassthrough } from "../../extensions/leader-key/herdr-navigation.ts";
import {
	filterSearchableItems,
	getSearchableWindow,
	searchableSelect,
} from "../../extensions/leader-key/model-switcher.ts";

const inheritedHerdrPaneId = process.env.HERDR_PANE_ID;
delete process.env.HERDR_PANE_ID;
test.after(() => {
	if (inheritedHerdrPaneId === undefined) delete process.env.HERDR_PANE_ID;
	else process.env.HERDR_PANE_ID = inheritedHerdrPaneId;
});

const CTRL_H = "\b";
const CTRL_J = "\n";
const CTRL_K = "\v";
const CTRL_L = "\f";
const ENTER = "\r";
const SHIFT_ENTER = "\x1b[13;2u";
const UP = "\x1b[A";
const DOWN = "\x1b[B";

const noop = () => {};

function action(key, label) {
	return { key, label, action: noop };
}

function createOverlay(entries) {
	let selected;
	return {
		overlay: new LeaderKeyOverlay(entries, {}, (result) => {
			selected = result;
		}),
		selected: () => selected,
	};
}

function createSearchablePicker({
	alternateAction,
	items = [
		{ value: "first", label: "First", description: "First description" },
		{ value: "second", label: "Second", description: "Second description" },
	],
	theme = {},
} = {}) {
	let component;
	let settled = false;
	let renderRequests = 0;
	const ctx = {
		ui: {
			custom(factory) {
				return new Promise((resolve) => {
					component = factory(
						{ requestRender: () => renderRequests++ },
						theme,
						{},
						(value) => {
							settled = true;
							resolve(value);
						},
					);
				});
			},
		},
	};
	const result = searchableSelect(ctx, "Test picker", items, undefined, undefined, alternateAction);
	assert.ok(component, "picker component should be created synchronously");
	return {
		component,
		result,
		settled: () => settled,
		renderRequests: () => renderRequests,
	};
}

test("Herdr passthrough metadata follows the overlay lifetime", async (t) => {
	const tempDir = mkdtempSync(join(tmpdir(), "leader-key-navigation-"));
	const fakeHerdr = join(tempDir, "herdr");
	const logPath = join(tempDir, "calls.log");
	const previousBinPath = process.env.HERDR_BIN_PATH;

	writeFileSync(fakeHerdr, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$HERDR_TEST_LOG\"\n");
	chmodSync(fakeHerdr, 0o755);
	process.env.HERDR_PANE_ID = "test:pane";
	process.env.HERDR_BIN_PATH = fakeHerdr;
	process.env.HERDR_TEST_LOG = logPath;

	t.after(() => {
		delete process.env.HERDR_PANE_ID;
		delete process.env.HERDR_TEST_LOG;
		if (previousBinPath === undefined) delete process.env.HERDR_BIN_PATH;
		else process.env.HERDR_BIN_PATH = previousBinPath;
		rmSync(tempDir, { recursive: true, force: true });
	});

	let closeOverlay;
	const result = withHerdrNavigationPassthrough(() => new Promise((resolve) => {
		closeOverlay = resolve;
	}));

	const opened = readFileSync(logPath, "utf8").trim().split("\n");
	assert.deepEqual(opened, [
		`pane report-metadata test:pane --source pi-leader-key --token pi_leader_key_navigation=${process.pid}`,
	]);

	closeOverlay("closed");
	assert.equal(await result, "closed");

	const closed = readFileSync(logPath, "utf8").trim().split("\n");
	assert.deepEqual(closed, [
		`pane report-metadata test:pane --source pi-leader-key --token pi_leader_key_navigation=${process.pid}`,
		"pane report-metadata test:pane --source pi-leader-key --clear-token pi_leader_key_navigation",
	]);
});

test("Ctrl+J/K/H/L navigate groups and expanded palette entries", () => {
	const groupAction = action("a", "Group action");
	const firstChild = action("f", "First child");
	const secondChild = action("s", "Second child");
	const { overlay, selected } = createOverlay([
		{ type: "group", group: { key: "g", label: "Group", items: [groupAction] } },
		{
			type: "action",
			key: "e",
			label: "Expandable",
			action: noop,
			expandableItems: [firstChild, secondChild],
		},
	]);

	overlay.handleInput(CTRL_L);
	overlay.handleInput(CTRL_H);
	overlay.handleInput(CTRL_J);
	overlay.handleInput(CTRL_L);
	overlay.handleInput(CTRL_J);
	overlay.handleInput(CTRL_K);
	overlay.handleInput(CTRL_H);
	overlay.handleInput(CTRL_L);
	overlay.handleInput(CTRL_J);
	overlay.handleInput(CTRL_L);

	assert.equal(selected(), secondChild);
});

test("Ctrl+L runs plain palette actions and Ctrl+H closes the root", () => {
	const plain = action("p", "Plain");
	const selectedAction = createOverlay([{ type: "action", ...plain }]);
	selectedAction.overlay.handleInput(CTRL_L);
	assert.equal(selectedAction.selected()?.label, "Plain");
	assert.equal(selectedAction.selected()?.action, noop);

	const cancelled = createOverlay([{ type: "action", ...plain }]);
	cancelled.overlay.handleInput(CTRL_H);
	assert.equal(cancelled.selected(), null);
});

test("arrow, Tab, Enter, and Escape palette controls still work", () => {
	const firstChild = action("f", "First child");
	const secondChild = action("s", "Second child");
	const expanded = createOverlay([
		{
			type: "action",
			key: "e",
			label: "Expandable",
			action: noop,
			expandableItems: [firstChild, secondChild],
		},
	]);
	expanded.overlay.handleInput("\t");
	expanded.overlay.handleInput(DOWN);
	expanded.overlay.handleInput(UP);
	expanded.overlay.handleInput(ENTER);
	assert.equal(expanded.selected(), firstChild);

	const cancelled = createOverlay([{ type: "action", ...action("p", "Plain") }]);
	cancelled.overlay.handleInput("\x1b");
	assert.equal(cancelled.selected(), null);
});

test("search matches category names and preserves grouped order", () => {
	const writing = { id: "writing-style", label: "Writing & voice", order: 0 };
	const planning = { id: "planning-architecture", label: "Planning & architecture", order: 1 };
	const items = [
		{ value: "adr", label: "ADR", category: planning },
		{ value: "bro", label: "Bro", category: writing },
		{ value: "rephrase", label: "Rephrase", category: writing },
	];

	assert.deepEqual(
		filterSearchableItems(items, "writing").map((item) => item.value),
		["bro", "rephrase"],
	);
	assert.deepEqual(
		filterSearchableItems(items, "").map((item) => item.value),
		["bro", "rephrase", "adr"],
	);
});

test("grouped picker renders dividers and category-only search results", async () => {
	const writing = { id: "writing-style", label: "Writing & voice", order: 0 };
	const planning = { id: "planning-architecture", label: "Planning & architecture", order: 1 };
	const picker = createSearchablePicker({
		items: [
			{ value: "adr", label: "ADR", category: planning },
			{ value: "bro", label: "Bro", category: writing },
		],
		theme: {
			fg: (_role, text) => text,
			bold: (text) => text,
		},
	});

	assert.match(picker.component.render(80).join("\n"), /── Writing & voice/);
	assert.match(picker.component.render(80).join("\n"), /── Planning & architecture/);
	for (const character of "planning") picker.component.handleInput(character);
	const filtered = picker.component.render(80).join("\n");
	assert.doesNotMatch(filtered, /Writing & voice/);
	assert.match(filtered, /Planning & architecture/);
	picker.component.handleInput("\x1b");
	assert.equal(await picker.result, null);
});

test("category dividers count toward the visible row budget", () => {
	const writing = { id: "writing-style", label: "Writing & voice", order: 0 };
	const planning = { id: "planning-architecture", label: "Planning & architecture", order: 1 };
	const items = [
		{ value: "bro", label: "Bro", category: writing },
		{ value: "rephrase", label: "Rephrase", category: writing },
		{ value: "adr", label: "ADR", category: planning },
	];

	const window = getSearchableWindow(items, 0, 3);
	assert.deepEqual(window.items.map((item) => item.value), ["bro", "rephrase"]);
	assert.equal(window.endIndex, 2);
});

test("Ctrl+J/K move and Ctrl+L expands then selects searchable items", async () => {
	const picker = createSearchablePicker();
	picker.component.handleInput(CTRL_J);
	picker.component.handleInput(CTRL_K);
	picker.component.handleInput(CTRL_J);
	picker.component.handleInput(CTRL_L);
	assert.equal(picker.settled(), false);
	assert.ok(picker.renderRequests() > 0);
	picker.component.handleInput(CTRL_L);

	assert.equal(await picker.result, "second");
});

test("Ctrl+H collapses a searchable item then goes back", async () => {
	const picker = createSearchablePicker();
	picker.component.handleInput(CTRL_L);
	picker.component.handleInput(CTRL_H);
	assert.equal(picker.settled(), false);
	picker.component.handleInput(CTRL_H);

	assert.equal(await picker.result, null);
});

test("searchable picker arrows, Backspace, Enter, Tab, and Shift+Enter still work", async () => {
	const selected = createSearchablePicker();
	selected.component.handleInput(DOWN);
	selected.component.handleInput(UP);
	selected.component.handleInput("z");
	selected.component.handleInput("\x7f");
	selected.component.handleInput(ENTER);
	assert.equal(await selected.result, "first");

	let alternateValue;
	const alternate = createSearchablePicker({
		alternateAction: {
			label: "open",
			run: (value) => {
				alternateValue = value;
			},
		},
	});
	alternate.component.handleInput("\t");
	assert.equal(alternate.settled(), false);
	alternate.component.handleInput(SHIFT_ENTER);
	assert.equal(await alternate.result, null);
	assert.equal(alternateValue, "first");
});
