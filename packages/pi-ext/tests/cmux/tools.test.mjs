import assert from "node:assert/strict";
import test from "node:test";
import { validateToolArguments } from "@earendil-works/pi-ai";
import { wireTools } from "../../extensions/cmux/tools.ts";

function browserTool() {
  const tools = new Map();
  const requests = [];
  wireTools({ registerTool: (tool) => tools.set(tool.name, tool) }, {
    async request(method, params) {
      requests.push({ method, params });
      return { found: true };
    },
  });
  const tool = tools.get("cmux_browser");
  assert.ok(tool);
  const validate = (args) => validateToolArguments(tool, {
    type: "toolCall", id: "find-test", name: tool.name, arguments: args,
  });
  return { tool, requests, validate };
}

test("cmux find preserves every supported selector key after Pi validation", async () => {
  const { tool, requests, validate } = browserTool();
  for (const findBy of ["role", "text", "label", "placeholder", "testid", "title"]) {
    const args = validate({ action: "find", find_by: findBy, find_value: "target", surface_id: "surface-1" });
    const result = await tool.execute("find-test", args);
    assert.deepEqual(requests.at(-1), {
      method: `browser.find.${findBy}`,
      params: { [findBy]: "target", surface_id: "surface-1" },
    });
    assert.equal(result.content[0].text, '{\n  "found": true\n}');
  }
});

test("Pi rejects invalid cmux enums and coerces optional nulls and numeric strings", async () => {
  const { tool, requests, validate } = browserTool();
  for (const findBy of ["invalid", 42, {}]) {
    assert.throws(() => validate({ action: "find", find_by: findBy, find_value: "target" }), /find_by/);
  }
  assert.deepEqual(validate({ action: "snapshot", max_depth: "3", compact: "true", surface_id: null }), {
    action: "snapshot", max_depth: 3, compact: true,
  });
  const args = validate({ action: "find", find_by: null, find_value: "target" });
  assert.equal(Object.hasOwn(args, "find_by"), false);
  const result = await tool.execute("find-test", args);
  assert.equal(result.details.error, true);
  assert.match(result.content[0].text, /find_by is required/);
  assert.deepEqual(requests, []);
});

test("cmux find rejects absent and non-string keys before making a request", async () => {
  const { tool, requests } = browserTool();
  for (const findBy of [undefined, "", 42, {}]) {
    const result = await tool.execute("find-test", { action: "find", find_by: findBy, find_value: "target" });
    assert.equal(result.details.error, true);
    assert.match(result.content[0].text, /find_by is required/);
  }
  assert.deepEqual(requests, []);
});
