import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { renderVccSections } from "../../extensions/shared/vcc-sections.ts";

// pi-vcc ships raw TypeScript; load it through Pi's own jiti, as Pi does at runtime.
const piEntry = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { createJiti } = createRequire(piEntry)("jiti");
const jiti = createJiti(import.meta.url);
const { normalize } = await jiti.import("@sting8k/pi-vcc/src/core/normalize");
const { filterNoise } = await jiti.import("@sting8k/pi-vcc/src/core/filter-noise");
const { buildSections } = await jiti.import("@sting8k/pi-vcc/src/core/build-sections");

const messages = [
	{ role: "user", content: [{ type: "text", text: "Fix the handoff crash in main.ts" }], timestamp: 1 },
	{
		role: "assistant",
		content: [{ type: "text", text: "Looking at main.ts now." }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 2,
	},
	{ role: "user", content: [{ type: "text", text: "Also add a test" }], timestamp: 3 },
];

describe("renderVccSections", () => {
	it("renders the real pi-vcc section shape without crashing", () => {
		const data = buildSections({ blocks: filterNoise(normalize(messages)) });
		const out = renderVccSections(data);
		assert.match(out, /Fix the handoff crash/);
		assert.match(out, /Also add a test/);
	});

	it("treats missing or renamed fields as empty instead of throwing", () => {
		assert.equal(renderVccSections({ sessionGoal: ["old"] }), "");
		assert.equal(renderVccSections(undefined), "");
		assert.equal(renderVccSections({ commits: ["abc fix"], briefTranscript: "brief" }), "[Commits]\n- abc fix\n\n---\n\nbrief");
	});
});
