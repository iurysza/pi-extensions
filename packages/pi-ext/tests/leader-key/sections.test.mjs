import test from "node:test";
import assert from "node:assert/strict";
import { sectionEntries } from "../../extensions/leader-key/layout.ts";

const action = (key) => ({ type: "action", key, label: key, action() {} });
const keys = (entries) => entries.map((entry) => entry.key ?? entry.group.key);

test("orders home by section, keeps unlisted entries, and pins the footer", () => {
	const input = ["s", "q", "o", "x", "k", "m", "e"].map(action);
	const { entries, headings } = sectionEntries(input, [
		{ title: "Find", keys: ["k", "e"] },
		{ title: "Agent", keys: ["m", "c"] },
	], ["o", "q"]);
	assert.deepEqual(keys(entries), ["k", "e", "m", "s", "x", "o", "q"]);
	assert.deepEqual([...headings], [[0, "Find"], [2, "Agent"], [3, "Other"], [5, ""]]);
});

test("skips empty sections and never duplicates an entry", () => {
	const { entries, headings } = sectionEntries([action("a")], [
		{ title: "Empty", keys: ["z"] },
		{ title: "One", keys: ["a"] },
		{ title: "Again", keys: ["a"] },
	], []);
	assert.deepEqual(keys(entries), ["a"]);
	assert.deepEqual([...headings], [[0, "One"]]);
});
