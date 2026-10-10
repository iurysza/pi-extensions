import assert from "node:assert/strict";
import test from "node:test";
import { getCapabilities, setCapabilities, visibleWidth } from "@earendil-works/pi-tui";
import { cardSpecs, cardRenderers, renderCard, WidthAwareLines } from "../../../extensions/tool-presentation/tidy/cards/index.js";
import { context, plain, rendererHarness, theme } from "./renderer-harness.js";

const agent = { id: "abcdef12", url: "https://cursor.com/agents/bc-abcdef12-uuid", name: "docs", status: "idle",
  repo: "https://github.com/iurysza/pi-voice", ref: "main", model: "composer-2-5", elapsedMs: 26000, tools: 7,
  activity: "finished", prompt: "Review the docs", text: "# Result\n**plain text**, not Markdown", completionId: "completion-1" };
const message = (details: typeof agent & { error?: string } = agent) => ({ role: "custom", customType: "cursor-cloud-completion", display: true, timestamp: 1000, content: "Model-facing result unchanged", details });
const request = (h: Awaited<ReturnType<typeof rendererHarness>>, msg = message(), expanded = false, cardTheme = theme) => {
  const payload: any = { version: 1, customType: msg.customType, message: msg, expanded, theme: cardTheme };
  h.bus.emit("tidy:message-card:v1", payload);
  return payload.component;
};

test("cloud completion summary distinguishes finished, failed and cancelled runs", () => {
  const spec = cardSpecs.cursor_cloud_completion;
  assert.equal(spec.summary({ details: agent }, {}), "finished · 0:26 · 7 tools · pi-voice @ main");
  assert.equal(spec.summary({ details: { ...agent, tools: 1 } }, {}), "finished · 0:26 · 1 tool · pi-voice @ main");
  assert.equal(spec.summary({ details: { ...agent, status: "failed", elapsedMs: 12000, error: "Broken\nLong details" } }, {}), "failed · 0:12 · Error: Broken");
  assert.equal(spec.summary({ details: { ...agent, status: "cancelled", elapsedMs: 12000 } }, {}), "cancelled · 0:12 · 7 tools · pi-voice @ main");
  const rows = renderCard({ spec, args: { prompt: agent.prompt }, result: { details: agent } }).map(plain);
  assert.equal(rows.length, 2);
  assert.equal(rows[0], "󰅟 cursor cloud Review the docs");
  assert.match(rows[1], /^docs → finished/);
});

test("completion expands to plain metadata and reply with a rail on every wrapped row", () => {
  const spec = cardSpecs.cursor_cloud_completion;
  const rows = cardRenderers(spec, undefined, undefined, { mode: "default", icons: true, expandedMaxLines: 500 })
    .renderResult({ details: agent }, { expanded: true }, theme, context("completion", { prompt: agent.prompt }, true)).render(300).map(plain).map(line => line.trimEnd());
  assert.deepEqual(rows.slice(2), ["  │ id    abcdef12", "  │ repo  https://github.com/iurysza/pi-voice @ main", "  │ model composer-2-5",
    "  │ url   https://cursor.com/agents/bc-abcdef12-uuid", "  │", "  │ # Result", "  │ **plain text**, not Markdown"]);
  const longReply = { ...agent, text: "unformatted words ".repeat(30) };
  const wrapped = cardRenderers(spec, undefined, undefined, { mode: "default", icons: true, expandedMaxLines: 0 })
    .renderResult({ details: longReply }, { expanded: true }, theme, context("wrap", {}, true)).render(30).map(plain);
  assert.ok(wrapped.slice(2).every(row => row.startsWith("  │")));
  const capped = cardRenderers(spec, undefined, undefined, { mode: "default", icons: true, expandedMaxLines: 3 })
    .renderResult({ details: agent }, { expanded: true }, theme, context("cap", {}, true)).render(300).map(plain);
  assert.equal(capped.length, 6, "two summary rows, three body rows and limit note");
  assert.match(capped.at(-1)!, /more lines/);
});

test("card links depend on terminal capabilities and survive narrow summary fitting", () => {
  const caps = getCapabilities();
  try {
    setCapabilities({ ...caps, hyperlinks: true });
    for (const name of ["cursor_cloud_completion", "cursor_cloud_spawn", "cursor_cloud_send", "cursor_cloud_cancel", "cursor_cloud_status"]) {
      const details = name === "cursor_cloud_completion" ? agent : { agent, agents: [agent] };
      const lines = renderCard({ spec: cardSpecs[name], args: { id: agent.id, prompt: "Long prompt" }, result: { details } });
      const label = name === "cursor_cloud_completion" ? "Open in Cursor ↗" : "Open ↗";
      for (const width of [20, 28, 50, 150]) {
        const rows = new WidthAwareLines(lines).render(width);
        assert.ok(rows.every(row => visibleWidth(row) <= width));
        assert.ok(rows[1].includes(`\x1b]8;;${agent.url}\x07${label}\x1b]8;;\x07`), `${name} width ${width}`);
      }
    }
    assert.ok(!renderCard({ spec: cardSpecs.cursor_cloud_status, args: {}, result: { details: { agents: [agent] } } }).join("\n").includes("\x1b]8;;"));
    setCapabilities({ ...caps, hyperlinks: false });
    assert.ok(!renderCard({ spec: cardSpecs.cursor_cloud_completion, args: {}, result: { details: agent } }).join("\n").includes("Open in Cursor"));
    for (const name of ["cursor_cloud_spawn", "cursor_cloud_send", "cursor_cloud_cancel", "cursor_cloud_status"]) {
      assert.ok(cardSpecs[name].expanded!({ details: { agent } }, {}).includes(`url   ${agent.url}`));
    }
  } finally { setCapabilities(caps); }
});

test("tidy returns a completion component only while enabled and for supported protocol keys", async () => {
  for (const enabled of [true, false]) {
    const h = await rendererHarness({ enabled });
    try {
      const component = request(h);
      assert.equal(!!component, enabled);
      if (enabled) assert.match(plain(component.render(200).join("\n")), /Review the docs\s*\n.*finished/);
      for (const payload of [{ version: 2, customType: "cursor-cloud-completion" }, { version: 1, customType: "unknown" }]) {
        h.bus.emit("tidy:message-card:v1", payload);
        assert.equal((payload as any).component, undefined);
      }
    } finally { await h.emit("session_shutdown"); }
  }
});

test("assistant text folds a cloud completion with tools and counts cloud failures separately", async () => {
  const h = await rendererHarness({ chill: true, chillGraceMs: 5000 });
  try {
    const toolCards = [];
    for (const id of ["a", "b", "c"]) {
      await h.emit("tool_execution_start", { toolCallId: id, toolName: "memo_note" });
      const result = { content: [{ type: "text", text: "Saved" }], details: { piTidyElapsedMs: 1000 } };
      await h.emit("tool_execution_end", { toolCallId: id, toolName: "memo_note", result });
      toolCards.push(h.resolvers[0]("memo_note", () => undefined)!.renderResult!(result as any, { expanded: false, isPartial: false }, theme, context(id)));
    }
    const failed = message({ ...agent, status: "failed", error: "Oops" });
    await h.emit("message_start", { message: failed });
    const backgrounds: string[] = [];
    const errorTheme = { ...theme, bg: (key: string, row: string) => { backgrounds.push(key); return row; } };
    const card = request(h, failed, false, errorTheme);
    assert.match(plain(card.render(200).join("\n")), /failed · 0:26 · Error: Oops/);
    assert.ok(backgrounds.every(key => key === "toolErrorBg"));
    await h.emit("message_start", { message: { role: "assistant", content: [] } });
    await h.emit("message_update", { message: { role: "assistant", content: [{ type: "thinking", thinking: "Wait" }] } });
    assert.doesNotMatch(plain(card.render(200).join("\n")), /(?:memory|cursor cloud)(?: \d+)? · <?\d/);
    await h.emit("message_update", { message: { role: "assistant", content: [{ type: "text", text: "Here is the summary" }] } });
    const folded = card.render(200).join("\n");
    assert.match(plain(folded), /memory 3 · cursor cloud · 29s · 1 failed/);
    assert.match(folded, /\x1b\[31m/);
    for (const tool of toolCards) assert.deepEqual(tool.render(200), []);
    const expanded = request(h, failed, true);
    assert.match(plain(expanded.render(200).join("\n")), /│ \*\*plain text\*\*/);
    assert.doesNotMatch(plain(expanded.render(200).join("\n")), /(?:memory|cursor cloud)(?: \d+)? · <?\d/);
    const click = { type: "click", button: "left", x: 0, y: 0 };
    assert.deepEqual(card.handleMouse(click), { handled: true });
    assert.match(plain(toolCards[0].render(200).join("\n")), /Saved/);
  } finally { await h.emit("session_shutdown"); }
});

test("cloud-only grace folding requests a host redraw without visible widget content", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = await rendererHarness({ chill: true, chillGraceMs: 5000 });
  let redraws = 0;
  try {
    await h.emit("session_start", {}, { mode: "tui", hasUI: true, ui: { setWidget: (_id: string, factory: any) => {
      assert.deepEqual(factory({ requestRender: () => redraws++ }).render(80), []);
    } }, sessionManager: { getBranch: () => [] } });
    await h.emit("message_start", { message: message() });
    const component = request(h);
    assert.doesNotMatch(plain(component.render(200).join("\n")), /(?:memory|cursor cloud)(?: \d+)? · <?\d/);
    t.mock.timers.tick(5000);
    assert.match(plain(component.render(200).join("\n")), / cursor cloud · 26s/);
    assert.ok(redraws > 0);
  } finally { await h.emit("session_shutdown"); }
});

test("chill restores direct custom_message entries and repeated cloud follow-ups on each branch", async () => {
  const h = await rendererHarness({ chill: true });
  const first = message(), second = message({ ...agent, completionId: "completion-2", status: "failed", error: "Oops" });
  const entry = (msg: ReturnType<typeof message>) => ({ type: "custom_message", customType: msg.customType, content: msg.content,
    details: msg.details, display: true, timestamp: new Date(msg.timestamp).toISOString() });
  const branch = [entry(first), entry(second), { type: "message", message: { role: "assistant", content: [{ type: "text", text: "Summary" }] } }];
  const before = JSON.stringify(branch);
  try {
    for (const event of ["session_start", "session_tree"]) {
      await h.emit(event, {}, { sessionManager: { getBranch: () => branch } });
      assert.deepEqual(request(h, first).render(200), []);
      assert.match(plain(request(h, second).render(200).join("\n")), /cursor cloud 2 · 52s · 1 failed/);
      assert.equal(JSON.stringify(branch), before);
    }
    await h.emit("session_tree", {}, { sessionManager: { getBranch: () => [entry(first)] } });
    assert.match(plain(request(h, first).render(200).join("\n")), / cursor cloud · /);
  } finally { await h.emit("session_shutdown"); }
});
