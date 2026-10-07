import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rendererHarness, context, theme } from "./renderer-harness.js";

const fixtures = [
  ...JSON.parse(readFileSync("tests/tool-presentation/card-fixtures.json", "utf8")),
  ...JSON.parse(readFileSync("tests/tool-presentation/card-contract-fixtures.json", "utf8")),
];
const baseline = JSON.parse(readFileSync("tests/tool-presentation/card-renderer-baseline.json", "utf8"));

test("chill off matches every step 2 fixture byte-for-byte at narrow and wide widths", async () => {
  const h = await rendererHarness();
  try {
    for (const [index, fixture] of fixtures.entries()) {
      const renderers = h.resolvers[0](fixture.name, () => undefined)!;
      for (const expected of baseline[index]) {
        const ctx = { ...context("fixture", fixture.args, expected.expanded), isError: fixture.state === "error" };
        assert.deepEqual(renderers.renderResult!(fixture.result, { expanded: expected.expanded, isPartial: false }, theme, ctx).render(expected.width), expected.lines, `${fixture.name} width ${expected.width}`);
      }
    }
    for (const [name, original] of h.tools) {
      const renderers = h.resolvers[0](name, () => original)!;
      const result = { content: [{ type: "text" as const, text: "fixture" }], details: {} };
      for (const expanded of [false, true]) {
        const args = { path: "fixture.ts", command: "echo fixture", pattern: "fixture", reasoning: "check fixture" };
        const options = { expanded, isPartial: false };
        assert.deepEqual(renderers.renderResult!(result, options, theme, context("builtin", args, expanded)).render(80), original.renderResult(result, options, theme, context("builtin", args, expanded)).render(80), name);
      }
    }
  } finally { await h.emit("session_shutdown"); }
});
