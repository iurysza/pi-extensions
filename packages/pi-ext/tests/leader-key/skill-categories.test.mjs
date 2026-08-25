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

const knowledgeBaseSkill = `---
name: kb-manager
description: Knowledge management
metadata:
  category: knowledge-base
---

# Knowledge Base Manager
`;

const workKnowledgeSkill = `---
name: sumup-work
description: Work knowledge
metadata:
  category: work-knowledge
---

# SumUp Work
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

test("creates categories for arbitrary declared metadata values", () => {
	const commands = [
		{
			name: "skill:unmanaged",
			description: "Unmanaged",
			source: "skill",
			sourceInfo: { path: "/skills/unmanaged/SKILL.md" },
		},
		{
			name: "skill:sumup-work",
			description: "Work knowledge",
			source: "skill",
			sourceInfo: { path: "/skills/sumup-work/SKILL.md" },
		},
		{
			name: "skill:kb-manager",
			description: "Knowledge management",
			source: "skill",
			sourceInfo: { path: "/skills/kb-manager/SKILL.md" },
		},
		{
			name: "skill:adr",
			description: "Architecture decisions",
			source: "skill",
			sourceInfo: { path: "/skills/adr/SKILL.md" },
		},
	];
	const files = new Map([
		["/skills/unmanaged/SKILL.md", ordinarySkill],
		["/skills/sumup-work/SKILL.md", workKnowledgeSkill],
		["/skills/kb-manager/SKILL.md", knowledgeBaseSkill],
		["/skills/adr/SKILL.md", planningSkill],
	]);

	const categorized = categorizeSkillCommands(commands, (path) => {
		const content = files.get(path);
		if (!content) throw new Error(`missing fixture: ${path}`);
		return content;
	});

	assert.deepEqual(
		categorized.map(({ command, category }) => [command.name, category.id, category.label]),
		[
			["skill:adr", "planning-architecture", "Planning & architecture"],
			["skill:kb-manager", "knowledge-base", "Knowledge Base"],
			["skill:sumup-work", "work-knowledge", "Work Knowledge"],
			["skill:unmanaged", "other", "Other"],
		],
	);
});

test("omits the skill command prefix from display labels", () => {
	assert.equal(skillCommandLabel("skill:technical-writing"), "technical-writing");
	assert.equal(skillCommandLabel("technical-writing"), "technical-writing");
});
