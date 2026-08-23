import assert from "node:assert/strict";
import test from "node:test";

import { LeaderKeyOverlay } from "../../extensions/leader-key/index.ts";
import { searchableSelect } from "../../extensions/leader-key/model-switcher.ts";

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

function createSearchablePicker({ alternateAction } = {}) {
	let component;
	let settled = false;
	let renderRequests = 0;
	const items = [
		{ value: "first", label: "First", description: "First description" },
		{ value: "second", label: "Second", description: "Second description" },
	];
	const ctx = {
		ui: {
			custom(factory) {
				return new Promise((resolve) => {
					component = factory(
						{ requestRender: () => renderRequests++ },
						{},
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
