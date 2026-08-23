import assert from "node:assert/strict";
import test from "node:test";

import {
	findWritingStyleCommands,
	hasWritingStyleMetadata,
	writingStyleLabel,
} from "../../extensions/leader-key/writing-styles.ts";

const writingStyle = `---
name: technical-writing
description: Technical writing rules
metadata:
  category: writing-style
---

# Technical writing
`;

const ordinarySkill = `---
name: coding-standards
description: Coding rules
---

# Coding standards
`;

test("recognizes writing-style metadata", () => {
	assert.equal(hasWritingStyleMetadata(writingStyle), true);
	assert.equal(hasWritingStyleMetadata(ordinarySkill), false);
	assert.equal(hasWritingStyleMetadata("---\nmetadata: [broken\n---"), false);
});

test("filters skill commands by their source metadata", () => {
	const commands = [
		{
			name: "skill:technical-writing",
			description: "Technical writing rules",
			source: "skill",
			sourceInfo: { path: "/skills/technical-writing/SKILL.md" },
		},
		{
			name: "skill:coding-standards",
			description: "Coding rules",
			source: "skill",
			sourceInfo: { path: "/skills/coding-standards/SKILL.md" },
		},
		{
			name: "technical-writing",
			description: "Extension command with the same name",
			source: "extension",
			sourceInfo: { path: "/extensions/technical-writing.ts" },
		},
	];
	const files = new Map([
		["/skills/technical-writing/SKILL.md", writingStyle],
		["/skills/coding-standards/SKILL.md", ordinarySkill],
	]);

	const styles = findWritingStyleCommands(commands, (path) => {
		const content = files.get(path);
		if (!content) throw new Error(`missing fixture: ${path}`);
		return content;
	});

	assert.deepEqual(styles.map((command) => command.name), ["skill:technical-writing"]);
});

test("omits the skill command prefix from display labels", () => {
	assert.equal(writingStyleLabel("skill:technical-writing"), "technical-writing");
	assert.equal(writingStyleLabel("technical-writing"), "technical-writing");
});
