import assert from "node:assert/strict";
import test from "node:test";

import {
	createSkillProvider,
	expandSkillTag,
	handleSkillTagInput,
	selectSkill,
	skillSuggestions,
	SKILL_TAG,
} from "../../extensions/leader-key/skill-tag.ts";

const available = new Set(["skill:pr-review", "skill:testing"]);
const pi = { getCommands: () => [...available].map((name) => ({ name, source: "skill" })) };
const SKILLS = [{ name: "testing", description: "Run tests" }, { name: "pr-review", description: "Review PRs" }];

test("the skill tag is a dollar sign", () => {
	assert.equal(SKILL_TAG, "$");
});

test("choosing a skill keeps the draft, and choosing another replaces only its tag", () => {
	const initial = selectSkill("Review this diff", "pr-review");
	assert.equal(initial, "$pr-review Review this diff");
	assert.equal(selectSkill(initial, "testing"), "$testing Review this diff");
	assert.equal(selectSkill("/skill:pr-review Review this diff", "testing"), "$testing Review this diff");
	assert.equal(selectSkill("", "pr-review"), "$pr-review ");
	assert.equal(selectSkill("$pr-review\nReview this diff", "testing"), "$testing\nReview this diff");
});

test("native Pi skill expansion receives one leading slash command and the exact request", () => {
	const tagged = "$pr-review Review this diff\nKeep the details.";
	assert.deepEqual(expandSkillTag(tagged, available), { text: "/skill:pr-review Review this diff\nKeep the details." });
	assert.deepEqual(handleSkillTagInput(tagged, pi), { action: "transform", text: "/skill:pr-review Review this diff\nKeep the details." });
	assert.deepEqual(expandSkillTag("$pr-review\nReview this diff", available), { text: "/skill:pr-review \nReview this diff" });
	assert.deepEqual(expandSkillTag("$pr-review", available), { text: "/skill:pr-review" });
	assert.deepEqual(expandSkillTag("$pr-review  ", available), { text: "/skill:pr-review" });
	assert.deepEqual(handleSkillTagInput("ordinary draft", pi), { action: "continue" });
	assert.deepEqual(handleSkillTagInput("/skill:pr-review Review this diff", pi), { action: "continue" });
});

test("text that does not name a skill goes to the model as typed", () => {
	for (const text of ["$HOME is wrong", "$5 per month", "$pr-revie typo", "$", "$ alone"]) {
		assert.deepEqual(handleSkillTagInput(text, pi), { action: "continue" }, text);
	}
});

test("$ lists skills only at the start of the message", () => {
	assert.deepEqual(skillSuggestions(SKILLS, ["$"], 0, 1)?.items.map((i) => i.value), ["$pr-review", "$testing"]);
	assert.deepEqual(skillSuggestions(SKILLS, ["$te"], 0, 3)?.items.map((i) => i.value), ["$testing"]);
	assert.equal(skillSuggestions(SKILLS, ["$te"], 0, 3)?.prefix, "$te");
	assert.equal(skillSuggestions(SKILLS, ["$te"], 0, 3)?.items[0].description, "Run tests");
	assert.equal(skillSuggestions(SKILLS, ["say $te"], 0, 7), null);
	assert.equal(skillSuggestions(SKILLS, ["first", "$te"], 1, 3), null);
	assert.equal(skillSuggestions(SKILLS, ["$zzz"], 0, 4), null);
});

test("the provider inserts the skill plus a space and defers everything else", async () => {
	const calls = [];
	const base = {
		getSuggestions: async (...args) => { calls.push(["get", ...args]); return "base"; },
		applyCompletion: (...args) => { calls.push(["apply", ...args]); return "base-apply"; },
	};
	const provider = createSkillProvider(base, () => SKILLS);
	const signal = new AbortController().signal;

	assert.deepEqual(provider.triggerCharacters, ["$"]);
	const suggestions = await provider.getSuggestions(["$pr"], 0, 3, { signal });
	assert.deepEqual(provider.applyCompletion(["$pr do it"], 0, 3, suggestions.items[0], suggestions.prefix), {
		lines: ["$pr-review do it"], cursorLine: 0, cursorCol: 11,
	});
	assert.equal(calls.length, 0);

	assert.equal(await provider.getSuggestions(["@src"], 0, 4, { signal }), "base");
	assert.equal(provider.applyCompletion(["@src"], 0, 4, { value: "@src/a.ts", label: "a.ts" }, "@src"), "base-apply");
});
