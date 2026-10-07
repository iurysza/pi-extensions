import assert from "node:assert/strict";
import test from "node:test";
import { Text } from "@earendil-works/pi-tui";
import { cardSpecs } from "../../../extensions/tool-presentation/tidy/cards/index.js";
import { context, plain, rendererHarness, theme } from "./renderer-harness.js";

const result = { content: [{ type: "text" as const, text: "fixture output" }], details: {} };

test("one tidy resolver selects every exact spec and valid MCP names", async () => {
  const h = await rendererHarness();
  try {
    assert.equal(h.resolvers.length, 1);
    for (const name of [...Object.keys(cardSpecs), "mcp__notion__search", "mcp__cloudflare_docs__search"]) {
      const renderers = h.resolvers[0](name, () => undefined)!;
      assert.equal(renderers.renderShell, "self", name);
      const lines = renderers.renderResult!(result, { expanded: false, isPartial: false }, theme, context("fixture", { query: "docs" })).render(80);
      assert.equal(lines.length, 2, name);
    }
  } finally { await h.emit("session_shutdown"); }
});

test("unknown, near-match, malformed MCP and disabled tools return next unchanged", async () => {
  const original = { renderCall: () => new Text("original", 0, 0) };
  const enabled = await rendererHarness();
  const disabled = await rendererHarness({ enabled: false });
  try {
    for (const name of ["unknown", "agent", "Agent_extra", "mcp__", "mcp__server", "constructor", "toString"]) {
      assert.equal(enabled.resolvers[0](name, () => original), original, name);
      assert.equal(enabled.resolvers[0](name, () => undefined), undefined, name);
    }
    for (const name of ["read", "Agent", "memo_note", "mcp__notion__search"]) {
      assert.equal(disabled.resolvers[0](name, () => original), original, name);
    }
    assert.equal(disabled.tools.size, 0);
    assert.ok(!disabled.commands.has("chill"));
  } finally { await enabled.emit("session_shutdown"); await disabled.emit("session_shutdown"); }
});

test("resolver never executes a tool or changes schemas, arguments, content or details", async () => {
  const h = await rendererHarness();
  try {
    const args = Object.freeze({ query: "docs", reasoning: "inspect docs" });
    const frozen = Object.freeze({ content: Object.freeze([Object.freeze({ type: "text" as const, text: "original" })]), details: Object.freeze({ unchanged: true }) });
    const original = { execute() { throw new Error("rendering must not execute"); }, parameters: Object.freeze({ type: "object" }), renderResult: () => new Text("native", 0, 0) };
    const before = JSON.stringify({ args, frozen, original });
    const renderers = h.resolvers[0]("web_search", () => original)!;
    assert.ok(!("execute" in renderers));
    assert.ok(!("parameters" in renderers));
    for (const expanded of [false, true]) {
      renderers.renderResult!(frozen as any, { expanded, isPartial: false }, theme, context("fixture", args, expanded)).render(80);
    }
    assert.equal(JSON.stringify({ args, frozen, original }), before);
  } finally { await h.emit("session_shutdown"); }
});

test("expanded questions, plans and Agent progress retain native state and views", async () => {
  const h = await rendererHarness();
  try {
    for (const name of ["ask_user", "cursor_ask_question", "choose_visual_artifact_direction", "plannotator_submit_plan", "plannotator_mark_done", "Agent", "SubagentWorkflow", "get_subagent_result"]) {
      const original = {
        renderShell: "self" as const,
        renderCall: (_args: any, _theme: any, ctx: any) => { ctx.state.native = true; return new Text("native call", 0, 0); },
        renderResult: (_result: any, options: any, _theme: any, ctx: any) => {
          assert.equal(ctx.state.native, true);
          assert.equal(options.expanded, true);
          if (ctx.lastComponent) assert.ok(ctx.lastComponent instanceof Text);
          return new Text("native result", 0, 0);
        },
      };
      const renderers = h.resolvers[0](name, () => original)!;
      const ctx = context(name, { question: "Pick", description: "Run" }, true);
      for (const isPartial of [false, true]) {
        const lines = renderers.renderResult!(result, { expanded: true, isPartial }, theme, ctx).render(80).join("\n");
        assert.match(plain(lines), /native call\s*\nnative result/, name);
        assert.equal(ctx.state.native, undefined, "native state stays separate from card state");
      }
    }
  } finally { await h.emit("session_shutdown"); }
});

test("image results retain the original expanded renderer even with a spec body", async () => {
  const h = await rendererHarness();
  try {
    const renderers = h.resolvers[0]("fetch_content", () => ({ renderResult: () => new Text("native image view", 0, 0) }))!;
    const imageResult = { content: [{ type: "image" as const, data: "fixture", mimeType: "image/png" }], details: {} };
    assert.match(renderers.renderResult!(imageResult, { expanded: true, isPartial: false }, theme, context("image", {}, true)).render(80).join("\n"), /native image view/);
  } finally { await h.emit("session_shutdown"); }
});

test("codemode nested calls appear only in the expanded spec body", async () => {
  const h = await rendererHarness();
  try {
    const renderers = h.resolvers[0]("codemode", () => undefined)!;
    const data = { content: [{ type: "text" as const, text: "Script completed" }], details: { calls: [{ name: "read", status: "done" }] } };
    const args = { code: "await read({path: 'file.ts'})" };
    const collapsed = renderers.renderResult!(data, { expanded: false, isPartial: false }, theme, context("code", args)).render(120).join("\n");
    assert.doesNotMatch(collapsed, /await read|Script completed/);
    const expanded = renderers.renderResult!(data, { expanded: true, isPartial: false }, theme, context("code", args, true)).render(120).join("\n");
    assert.match(expanded, /await read/);
    assert.match(expanded, /read/);
  } finally { await h.emit("session_shutdown"); }
});
