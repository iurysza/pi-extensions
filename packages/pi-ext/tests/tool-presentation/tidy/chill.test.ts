import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { rendererHarness, context, theme, plain } from "./renderer-harness.js";
import { loadTidyChill } from "../../../extensions/tool-presentation/tidy/config.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const output = (text: string, details = {}) => ({ content: [{ type: "text" as const, text }], details });
async function start(h: Awaited<ReturnType<typeof rendererHarness>>, id: string, name = "memo_note") {
  await h.emit("tool_call", { toolCallId: id, toolName: name });
  await h.emit("tool_execution_start", { toolCallId: id, toolName: name });
}
async function finish(h: Awaited<ReturnType<typeof rendererHarness>>, id: string, name = "memo_note", result = output("Saved as #1.", { piTidyElapsedMs: 1000 }), isError = false) {
  await h.emit("tool_execution_end", { toolCallId: id, toolName: name, result, isError });
}

test("finished cards fold into one summary with recorded duration and red failures", async () => {
  const h = await rendererHarness({ chill: true });
  try {
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    const a = context("a", { line: "First" });
    const b = context("b", { line: "Second" });
    await start(h, "a"); await finish(h, "a");
    const first = renderers.renderResult!(output("Saved as #1."), { expanded: false, isPartial: false }, theme, a);
    assert.match(plain(first.render(80).join("\n")), /Worked · 1 tool · 1s/);
    await start(h, "b");
    assert.match(plain(first.render(80).join("\n")), /Working · 1 tool · 1s/);
    assert.equal(renderers.renderResult!(output("streaming"), { expanded: false, isPartial: true }, theme, b).render(80).length, 2);
    await finish(h, "b", "memo_note", output("Too long: 284 bytes, limit 280.", { piTidyElapsedMs: 2000 }));
    assert.deepEqual(first.render(80), []);
    const summary = renderers.renderResult!(output("failed"), { expanded: false, isPartial: false }, theme, b).render(80).join("\n");
    assert.match(plain(summary), /Worked · 2 tools · 3s · 1 failed/);
    assert.match(summary, /\x1b\[31m/);
    assert.deepEqual(renderers.renderCall!({}, theme, a).render(80), []);
  } finally { await h.emit("session_shutdown"); }
});

test("Ctrl+O expansion reveals every folded card and full original body", async () => {
  const h = await rendererHarness({ chill: true });
  try {
    await start(h, "a"); await finish(h, "a");
    await start(h, "b"); await finish(h, "b");
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    for (const id of ["a", "b"]) {
      const lines = renderers.renderResult!(output("full result\nsecond line"), { expanded: true, isPartial: false }, theme, context(id, { line: "Keep this" }, true)).render(80).join("\n");
      assert.match(plain(lines), /full result\s*\n\s*second line/);
      assert.doesNotMatch(plain(lines), /Worked/);
    }
  } finally { await h.emit("session_shutdown"); }
});

test("user and assistant text break groups, while thinking and nested calls do not", async () => {
  const h = await rendererHarness({ chill: true });
  try {
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    const render = (id: string) => plain(renderers.renderResult!(output("Saved"), { expanded: false, isPartial: false }, theme, context(id)).render(80).join("\n"));
    await start(h, "a"); await finish(h, "a");
    await h.emit("message_start", { message: { role: "assistant", content: [] } });
    await h.emit("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "reasoning" }] } });
    await h.emit("tool_execution_start", { toolCallId: "nested", toolName: "read", parentToolCallId: "code" });
    await h.emit("tool_execution_end", { toolCallId: "nested", toolName: "read", parentToolCallId: "code", result: output("nested") });
    await start(h, "b"); await finish(h, "b");
    assert.match(render("b"), /2 tools/);
    await h.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "Next step" }] } });
    await start(h, "c"); await finish(h, "c");
    assert.match(render("b"), /2 tools/);
    assert.match(render("c"), /1 tool/);
    await h.emit("message_start", { message: { role: "user", content: "Continue" } });
    await start(h, "d"); await finish(h, "d");
    assert.match(render("c"), /1 tool/);
    assert.match(render("d"), /1 tool/);
  } finally { await h.emit("session_shutdown"); }
});

test("parallel calls keep pending cards visible and summary ownership follows call order", async () => {
  const h = await rendererHarness({ chill: true });
  try {
    await start(h, "a"); await start(h, "b");
    await finish(h, "b", "memo_note", output("error", { piTidyElapsedMs: 0 }), true);
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    const later = renderers.renderResult!(output("result"), { expanded: false, isPartial: false }, theme, context("b"));
    assert.match(plain(later.render(80).join("\n")), /Working · 1 tool · <1s · 1 failed/);
    const pending = plain(renderers.renderResult!(output("partial"), { expanded: false, isPartial: true }, theme, context("a")).render(80).join("\n"));
    assert.match(pending, /\n· /);
    assert.doesNotMatch(pending, /Working|Worked/);
    await finish(h, "a");
    assert.match(plain(later.render(80).join("\n")), /Worked · 2 tools · 1s · 1 failed/);
    assert.deepEqual(renderers.renderResult!(output("result"), { expanded: false, isPartial: false }, theme, context("a")).render(80), []);
  } finally { await h.emit("session_shutdown"); }
});

test("replay groups restore per branch without modifying messages or inventing durations", async () => {
  const h = await rendererHarness({ chill: true });
  const branch = [
    { type: "message", message: { role: "user", content: "Start" } },
    { type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "a", name: "memo_note" }, { type: "toolCall", id: "b", name: "memo_note" }] } },
    { type: "message", message: { role: "toolResult", toolCallId: "a", toolName: "memo_note", ...output("Saved", { piTidyElapsedMs: 1000 }) } },
    { type: "message", message: { role: "toolResult", toolCallId: "b", toolName: "memo_note", ...output("Saved") } },
  ];
  const before = JSON.stringify(branch);
  try {
    for (const event of ["session_start", "session_tree"]) {
      await h.emit(event, {}, { sessionManager: { getBranch: () => branch } });
      const renderers = h.resolvers[0]("memo_note", () => undefined)!;
      const lines = renderers.renderResult!(output("Saved"), { expanded: false, isPartial: false }, theme, context("b")).render(80).join("\n");
      assert.match(plain(lines), /Worked · 2 tools(?! ·)/);
    }
    assert.equal(JSON.stringify(branch), before);
    await h.emit("session_tree", {}, { sessionManager: { getBranch: () => [] } });
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    assert.equal(renderers.renderResult!(output("Saved"), { expanded: false, isPartial: false }, theme, context("b")).render(80).length, 2);
  } finally { await h.emit("session_shutdown"); }
});

test("/chill toggles existing cards, requests redraw and neither saves nor reloads", async () => {
  const h = await rendererHarness();
  try {
    await start(h, "a"); await finish(h, "a");
    let redraws = 0;
    const renderers = h.resolvers[0]("memo_note", () => undefined)!;
    const ctx = { ...context("a"), invalidate: () => { redraws++; } };
    const card = renderers.renderResult!(output("Saved"), { expanded: false, isPartial: false }, theme, ctx);
    const normal = card.render(80);
    const notices: string[] = [];
    const commandCtx = { ui: { notify: (message: string) => notices.push(message) }, reload() { throw new Error("must not reload"); } };
    await h.commands.get("chill").handler("", commandCtx);
    assert.match(plain(card.render(80).join("\n")), /Worked/);
    await h.commands.get("chill").handler("", commandCtx);
    assert.deepEqual(card.render(80), normal);
    assert.equal(redraws, 2);
    assert.match(notices[0], /on for this session/);
    assert.match(notices[1], /off for this session/);
  } finally { await h.emit("session_shutdown"); }
});

test("chill config defaults false and only the literal boolean true enables it", async () => {
  const root = await mkdtemp(join(tmpdir(), "tidy-chill-"));
  const path = join(root, "config.json");
  try {
    assert.equal(loadTidyChill(path), false);
    for (const value of ["{", "null", "[]", '{}', '{"chill":false}', '{"chill":"true"}']) {
      await writeFile(path, value); assert.equal(loadTidyChill(path), false);
    }
    await writeFile(path, '{"chill":true,"icons":false}'); assert.equal(loadTidyChill(path), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
