import assert from "node:assert/strict";
import test from "node:test";

import {
	categorizeSkillCommands,
	parseSkillCategory,
	skillCommandLabel,
} from "../../extensions/leader-key/skill-categories.ts";

const writingStyle = `---
name: technical-writing
description: Technical writing rules
metadata:
  category: writing-style
---

# Technical writing
`;

const planningSkill = `---
name: adr
description: Architecture decisions
metadata:
  category: planning-architecture
---

# ADR
`;

const ordinarySkill = `---
name: unmanaged
description: Unmanaged third-party skill
---

# Unmanaged
`;

test("parses category metadata", () => {
	assert.equal(parseSkillCategory(writingStyle), "writing-style");
	assert.equal(parseSkillCategory(ordinarySkill), undefined);
	assert.equal(parseSkillCategory("---\nmetadata: [broken\n---"), undefined);
});

test("categorizes and orders skill commands", () => {
	const commands = [
		{
			name: "skill:unmanaged",
			description: "Unmanaged",
			source: "skill",
			sourceInfo: { path: "/skills/unmanaged/SKILL.md" },
		},
		{
			name: "skill:adr",
			description: "Architecture decisions",
			source: "skill",
			sourceInfo: { path: "/skills/adr/SKILL.md" },
		},
		{
			name: "skill:technical-writing",
			description: "Technical writing rules",
			source: "skill",
			sourceInfo: { path: "/skills/technical-writing/SKILL.md" },
		},
		{
			name: "technical-writing",
			description: "Extension command with the same name",
			source: "extension",
			sourceInfo: { path: "/extensions/technical-writing.ts" },
		},
	];
	const files = new Map([
		["/skills/unmanaged/SKILL.md", ordinarySkill],
		["/skills/adr/SKILL.md", planningSkill],
		["/skills/technical-writing/SKILL.md", writingStyle],
	]);

	const categorized = categorizeSkillCommands(commands, (path) => {
		const content = files.get(path);
		if (!content) throw new Error(`missing fixture: ${path}`);
		return content;
	});

	assert.deepEqual(
		categorized.map(({ command, category }) => [command.name, category.id]),
		[
			["skill:technical-writing", "writing-style"],
			["skill:adr", "planning-architecture"],
			["skill:unmanaged", "other"],
		],
	);
});

test("omits the skill command prefix from display labels", () => {
	assert.equal(skillCommandLabel("skill:technical-writing"), "technical-writing");
	assert.equal(skillCommandLabel("technical-writing"), "technical-writing");
});
