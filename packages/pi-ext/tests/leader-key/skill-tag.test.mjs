import assert from "node:assert/strict";
import test from "node:test";

import { expandSkillTag, handleSkillTagInput, selectSkill, SKILL_TAG } from "../../extensions/leader-key/skill-tag.ts";

const available = new Set(["skill:pr-review", "skill:testing"]);

function input(text, editorText = "") {
	const notifications = [];
	let draft = editorText;
	const pi = { getCommands: () => [...available].map((name) => ({ name, source: "skill" })) };
	const ctx = { ui: { getEditorText: () => draft, setEditorText: (value) => { draft = value; }, notify: (...args) => notifications.push(args) } };
	return { result: handleSkillTagInput(text, pi, ctx), draft: () => draft, notifications };
}

test("choosing a skill keeps the draft, and choosing another replaces only its tag", () => {
	const initial = selectSkill("Review this diff", "pr-review");
	assert.equal(initial, `${SKILL_TAG} pr-review Review this diff`);
	assert.equal(selectSkill(initial, "testing"), `${SKILL_TAG} testing Review this diff`);
	assert.equal(selectSkill("/skill:pr-review Review this diff", "testing"), `${SKILL_TAG} testing Review this diff`);
	assert.equal(selectSkill("", "pr-review"), `${SKILL_TAG} pr-review `);
	assert.equal(selectSkill(`${SKILL_TAG} pr-review\nReview this diff`, "testing"), `${SKILL_TAG} testing\nReview this diff`);
});

test("native Pi skill expansion receives one leading slash command and the exact request", () => {
	const tagged = `${SKILL_TAG} pr-review Review this diff\nKeep the details.`;
	assert.deepEqual(expandSkillTag(tagged, available), { text: "/skill:pr-review Review this diff\nKeep the details." });
	assert.deepEqual(input(tagged).result, { action: "transform", text: "/skill:pr-review Review this diff\nKeep the details." });
	assert.deepEqual(expandSkillTag(`${SKILL_TAG} pr-review\nReview this diff`, available), { text: "/skill:pr-review \nReview this diff" });
	assert.deepEqual(expandSkillTag(`${SKILL_TAG} pr-review`, available), { text: "/skill:pr-review" });
	assert.deepEqual(input(`${SKILL_TAG} pr-review`).result, { action: "transform", text: "/skill:pr-review" });
	assert.deepEqual(expandSkillTag(`${SKILL_TAG} pr-review  `, available), { text: "/skill:pr-review" });
	assert.deepEqual(input("ordinary draft").result, { action: "continue" });
	assert.deepEqual(input("/skill:pr-review Review this diff").result, { action: "continue" });
});

test("an edited or missing skill name does not become a model prompt", () => {
	for (const tagged of [`${SKILL_TAG} pr-revie Review this diff`, SKILL_TAG]) {
		const state = input(tagged);
		assert.deepEqual(state.result, { action: "handled" });
		assert.equal(state.draft(), tagged);
		assert.equal(state.notifications.length, 1);
		assert.equal(state.notifications[0][1], "warning");
	}
});

test("a rejected tag does not overwrite text entered while submission was processing", () => {
	const state = input(`${SKILL_TAG} unknown My original request`, "New typing");
	assert.deepEqual(state.result, { action: "handled" });
	assert.equal(state.draft(), `${SKILL_TAG} unknown My original request\nNew typing`);
});
