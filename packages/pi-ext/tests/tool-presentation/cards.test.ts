import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { cardSpecs, specForTool, renderCard, WidthAwareLines, cardRenderers, cardRuntime } from "../../extensions/tool-presentation/tidy/cards/index.js";
import { cardParts, ExpandedCard, layoutBody } from "../../extensions/tool-presentation/tidy/cards/card.js";
import { mcpSummary } from "../../extensions/tool-presentation/tidy/cards/specs/mcp.js";
import { visibleWidth } from "@earendil-works/pi-tui";

const fixtures = [
  ...JSON.parse(readFileSync(resolve(process.cwd(), "tests/tool-presentation/card-fixtures.json"), "utf8")),
  ...JSON.parse(readFileSync(resolve(process.cwd(), "tests/tool-presentation/card-contract-fixtures.json"), "utf8")),
];
const plain = (v: string) => v.replace(/\x1b\[[0-9;]*m/g, "");
for (const fixture of fixtures) {
  test(`${fixture.name}: ${fixture.source.session ? "real-session" : "source-contract"} ${fixture.state} fixture renders a two-line card`, () => {
    const spec = specForTool({ name: fixture.name })!;
    assert.ok(spec);
    const before = JSON.stringify(fixture);
    for (const mode of ["default", "reasoning", "result"] as const) {
      const lines = renderCard({ spec, args: fixture.args, result: fixture.result }, { mode });
      assert.equal(lines.length, mode === "default" ? 2 : 1);
      assert.ok(lines[0].includes(spec.icon));
      assert.ok(!lines.some((l) => plain(l).includes("undefined")));
      for (const width of [1, 20, 60, 120]) {
        assert.ok(new WidthAwareLines(lines).render(width).every((l) => visibleWidth(l) <= width));
      }
    }
    assert.equal(JSON.stringify(fixture), before, "presentation leaves the entire result unchanged");
  });
}
for (const [name, spec] of Object.entries(cardSpecs)) {
  test(`${name}: missing/streaming data and icons-off remain compact`, () => {
    const args = { question: "Example?", title: "Example", line: "Example", name: "Example", note: "Example.", range: "0-1", regex: "example", agent_id: "example", step: 1 };
    const pending = renderCard({ spec, args, result: {} }, { isPartial: true, elapsedMs: 3000 });
    assert.equal(pending.length, 2);
    assert.ok(plain(pending[0]).startsWith("· "));
    const noIcon = renderCard({ spec, args, result: {} }, { icons: false });
    assert.ok(plain(noIcon[0]).startsWith(spec.label));
    assert.ok(!noIcon[0].includes(spec.icon));
    assert.ok(spec.label.length <= 8);
  });
}
test("counts of one are singular and cards without a target have no dangling arrow", () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const ask = renderCard({ spec: specForTool({ name: "ask_user" })!, args: { question: "Pick", options: [{ title: "a" }] }, result: { content: [{ type: "text", text: "a" }], details: { answer: "a" } } }, { icons: false });
  assert.match(strip(ask[1]), /^1 option →/);
  const code = renderCard({ spec: specForTool({ name: "codemode" })!, args: { code: "// one" }, result: { content: [{ type: "text", text: "ok" }], details: { calls: [{ name: "read", status: "done" }] } } }, { icons: false });
  assert.match(strip(code[1]), /^1 call →/);
  const note = renderCard({ spec: specForTool({ name: "memo_note" })!, args: { line: "x" }, result: { content: [{ type: "text", text: "Saved #0" }] } }, { icons: false });
  assert.doesNotMatch(strip(note[1]), /^\s*→/);
});

test("memory summaries use verified CLI wording", () => {
  const text = (text: string) => ({ content: [{ type: "text", text }] });
  assert.equal(cardSpecs.memo_note.summary(text("Saved as #83.\n\nCompress memories #82-83 into one line."), {}), "saved #83 · nap requested");
  assert.equal(cardSpecs.memo_nap.summary(text("80-83 saved.\nNothing left to compress."), {}), "merged");
  assert.equal(cardSpecs.memo_recall.summary(text("#1 redacted\n3 matches."), {}), "3 matches");
  assert.ok(cardSpecs.memo_note.failed!(text("Too long: 284 bytes, limit 280.")));
  // Zoom has no session evidence. These test only the conservative parser contract.
  assert.equal(cardSpecs.memo_zoom.summary(text("#0-7 left\n#8-15 right"), {}), "2 halves");
  assert.equal(cardSpecs.memo_zoom.summary(text("Unknown node"), {}), "Unknown node");
});
test("semantic failure paints the row red without changing Pi's isError", () => {
  const result = { content: [{ type: "text", text: "Failed: EACCES\nfull error" }], details: { error: true }, isError: false };
  const backgrounds: string[] = [];
  const theme = { fg: (_key: string, t: string) => t, bg: (key: string, t: string) => { backgrounds.push(key); return t; } };
  const component = cardRenderers(cardSpecs.wtf).renderResult(result, { expanded: true }, theme, { args: { note: "Record failure" }, isError: false });
  assert.ok(component.render(80).join("\n").includes("full error"));
  assert.ok(backgrounds.every((key) => key === "toolErrorBg"));
  assert.equal(result.isError, false);
  assert.deepEqual(result.details, { error: true });
});
test("cancelled questions and rejected plans are semantic failures", () => {
  for (const name of ["ask_user", "choose_visual_artifact_direction", "cursor_ask_question"]) assert.ok(cardSpecs[name].failed!({ details: { cancelled: true } }));
  assert.ok(cardSpecs.plannotator_submit_plan.failed!({ details: { approved: false } }));
  assert.ok(cardSpecs.plannotator_mark_done.failed!({ details: { completed: false } }));
});
test("expanded output is pretty printed and keeps every line until render", () => {
  const spec = cardSpecs.cmux_browser;
  const result = { content: [{ type: "text", text: Array.from({ length: 512 }, (_, i) => String(i)).join("\n") }], details: { fullOutputPath: "/tmp/full.txt" } };
  const lines = renderCard({ spec, args: { action: "snapshot" }, result }, { expanded: true });
  assert.equal(lines.length, 2 + 512 + 1);
  assert.match(plain(lines.at(-1)!), /full output: \/tmp\/full.txt/);
  const json = renderCard({ spec, args: {}, result: { content: [{ type: "text", text: '{"ok":true}' }] } }, { expanded: true });
  assert.ok(json.some((line) => line.includes('"ok": true')));
});
test("expanded cards wrap long lines instead of cutting them off", () => {
  const long = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
  const result = { content: [{ type: "text", text: long }] };
  const card = new ExpandedCard(() => cardParts({ spec: cardSpecs.cmux_browser, args: { action: "snapshot" }, result }, { expanded: true }));
  const rows = card.render(30).map(plain);
  assert.ok(rows.every((row) => visibleWidth(row) <= 30));
  assert.ok(!rows.slice(2).some((row) => row.includes("…")), "body rows are never cut");
  assert.equal(rows.slice(2).map((row) => row.trim()).join(" "), long, "all words survive");
  assert.ok(rows.slice(2).every((row) => row.startsWith("  ")), "continuation rows keep the indent");
});
test("the expanded limit counts wrapped rows and keeps the full output note", () => {
  const result = { content: [{ type: "text", text: Array.from({ length: 50 }, (_, i) => `line ${i} ${"x ".repeat(20)}`).join("\n") }], details: { fullOutputPath: "/tmp/full.txt" } };
  const parts = () => cardParts({ spec: cardSpecs.cmux_browser, args: { action: "snapshot" }, result }, { expanded: true });
  const rows = new ExpandedCard(parts, undefined, () => 10).render(30).map(plain);
  // Head, then ten body rows, then the hidden-line note, then the full output path.
  assert.equal(rows.length, 2 + 10 + 2);
  assert.match(rows.at(-2)!, /45 more lines/);
  assert.match(rows.at(-1)!, /full output: \/tmp\/full.txt/);
  assert.equal(new ExpandedCard(parts, undefined, () => 0).render(30).filter((row) => /more line/.test(row)).length, 0, "0 means no limit");
});
test("layoutBody shows the start of one line that is longer than the limit", () => {
  const rows = layoutBody([`  ${"word ".repeat(40)}`], 20, 3).map(plain);
  assert.equal(rows.length, 4);
  assert.match(rows.at(-1)!, /1 more line\b/);
});
test("expanded cards reuse their rows until width, limit or content changes", () => {
  let calls = 0;
  const parts = () => { calls++; return { head: ["h"], body: ["  a"], tail: [] }; };
  let limit = 500;
  const card = new ExpandedCard(parts, undefined, () => limit);
  const first = card.render(40);
  assert.equal(card.render(40), first, "same array, no re-wrap");
  assert.notEqual(card.render(41), first);
  limit = 1;
  assert.notEqual(card.render(41), card.render(40));
  assert.ok(calls >= 4);
});
test("codemode keeps script and nested calls out of collapsed view", () => {
  const fixture = fixtures.find((f: any) => f.name === "codemode" && f.state === "success");
  const collapsed = renderCard({ spec: cardSpecs.codemode, args: fixture.args, result: fixture.result });
  assert.equal(collapsed.length, 2);
  assert.ok(!collapsed.join("\n").includes("text('"));
  assert.ok(!collapsed.join("\n").includes("Script completed"));
  const expanded = renderCard({ spec: cardSpecs.codemode, args: fixture.args, result: fixture.result }, { expanded: true });
  assert.ok(expanded.length > 2);
  assert.ok(expanded.some((line) => line.includes("✓")));
});
test("MCP summary heuristics do not collapse raw JSON into the transcript", () => {
  const r = (value: any) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
  assert.equal(mcpSummary(r([1, 2])), "2 items");
  assert.equal(mcpSummary(r({ results: [1, 2] })), "2 results");
  assert.equal(mcpSummary(r({ title: "Example" })), '"Example"');
  assert.equal(mcpSummary(r({ ok: true, data: {} })), "2 fields");
  assert.equal(specForTool({ name: "mcp__cloudflare_docs__search", annotations: { readOnlyHint: true } })!.target({ query: "docs" }), 'cf docs · "docs"');
});
function api(known: string[] = []) {
  const tools: any[] = known.map((name) => ({ name }));
  const hooks = new Map<string, any[]>();
  return { tools, hooks, pi: { events: {}, on: (name: string, fn: any) => { hooks.set(name, [...hooks.get(name) ?? [], fn]); }, getAllTools: () => tools, registerTool: (tool: any) => tools.push(tool) } as any };
}
test("card clock observes stable hooks, deduplicates listeners, and stops timers", () => {
  const { pi, hooks } = api();
  const runtime = cardRuntime(pi);
  assert.equal(cardRuntime({ ...pi }), runtime, "event bus shares one clock");
  assert.ok([...hooks.values()].every((handlers) => handlers.length === 1));
  hooks.get("tool_call")![0]({ toolCallId: "call" });
  assert.equal(typeof runtime.timeline.get("call")?.startedAt, "number");
  const timer = setInterval(() => {}, 1000); timer.unref();
  runtime.timers.set("call", timer);
  try {
    assert.equal(hooks.get("tool_result")![0]({ toolCallId: "call" }), undefined, "no result override");
    assert.equal(runtime.timers.size, 0);
    assert.ok(runtime.timeline.get("call")!.elapsedMs! >= 0);
  } finally { clearInterval(timer); }
  for (const event of ["turn_end", "session_shutdown"]) {
    const timer = setInterval(() => {}, 1000); timer.unref();
    runtime.timers.set("partial", timer);
    try { hooks.get(event)![0](); assert.equal(runtime.timers.size, 0); }
    finally { clearInterval(timer); }
  }
});
test("late presentation loading still suppresses synthetic Cursor replay timing", () => {
  const { pi, hooks } = api(); const runtime = cardRuntime(pi);
  assert.equal(cardRuntime(pi, undefined, (id) => id === "replay"), runtime);
  hooks.get("tool_call")![0]({ toolCallId: "replay" });
  hooks.get("tool_result")![0]({ toolCallId: "replay" });
  assert.equal(runtime.timeline.get("replay"), undefined);
  hooks.get("tool_call")![0]({ toolCallId: "live" });
  assert.equal(typeof runtime.timeline.get("live")?.startedAt, "number");
});
test("card replay restores recorded timing but never invents missing duration", () => {
  const { pi, hooks } = api(); const runtime = cardRuntime(pi);
  const messages = [
    { type: "message", message: { role: "user", content: "Example" } },
    { type: "message", message: { role: "toolResult", toolCallId: "timed", details: { piTidyElapsedMs: 42 } } },
    { type: "message", message: { role: "toolResult", toolCallId: "untimed", details: {} } },
  ];
  const before = JSON.stringify(messages);
  for (const event of ["session_start", "session_tree"]) {
    hooks.get(event)![0]({}, { sessionManager: { getBranch: () => messages } });
    assert.equal(runtime.timeline.get("timed")?.elapsedMs, 42);
    assert.equal(runtime.timeline.get("untimed"), undefined);
  }
  assert.equal(JSON.stringify(messages), before);
});
