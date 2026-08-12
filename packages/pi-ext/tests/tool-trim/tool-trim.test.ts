import assert from "node:assert/strict";
import test from "node:test";

import toolTrim from "../../extensions/tool-trim/tool-trim.ts";

test("removes rejected sem tools and aliases on session and turn start", () => {
	const handlers = new Map<string, () => void>();
	let active = [
		"read",
		"sem_diff",
		"sem_context",
		"mcp__pi__sem_eval",
		"sem_impact",
		"sem_entities",
	];
	const writes: string[][] = [];

	toolTrim({
		getActiveTools: () => active,
		setActiveTools: (tools: string[]) => {
			active = tools;
			writes.push(tools);
		},
		on: (event: string, handler: () => void) => handlers.set(event, handler),
	} as never);

	handlers.get("session_start")?.();
	assert.deepEqual(active, ["read", "sem_context", "sem_impact", "sem_entities"]);

	active = ["read", "sem_log", "sem_blame"];
	handlers.get("turn_start")?.();
	assert.deepEqual(active, ["read"]);
	assert.equal(writes.length, 2);
});

test("does not rewrite an already-clean active tool list", () => {
	const handlers = new Map<string, () => void>();
	let writes = 0;

	toolTrim({
		getActiveTools: () => ["read", "sem_context", "sem_impact", "sem_entities"],
		setActiveTools: () => writes++,
		on: (event: string, handler: () => void) => handlers.set(event, handler),
	} as never);

	handlers.get("session_start")?.();
	assert.equal(writes, 0);
});
