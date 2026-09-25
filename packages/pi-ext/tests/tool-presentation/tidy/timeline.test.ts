import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildToolBlock, createTidyExtension, fitToolLine } from "../../../extensions/tool-presentation/tidy/index.js";
import { clockLabel, readToolTiming, ToolTimeline } from "../../../extensions/tool-presentation/tidy/timeline.js";

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
const rows = (component: any, width = 72): string[] => component.render(width).map(plain);
const start = new Date(2026, 8, 24, 14, 32, 0).getTime();
const args = { path: "src/file.ts", reasoning: "inspect the source" };
const theme = { bg: (_name: string, text: string) => text };

async function harness(isReplayCall?: (id: string) => boolean) {
  const events = new Map<string, Function>();
  const tools = new Map<string, any>();
  await createTidyExtension({
    loadState: () => ({ enabled: true, source: "default" }),
    loadMode: () => "default",
    loadIcons: () => true,
    isReplayCall,
    createIntegration: () => ({
      async initialize() { return { skipTidyTools: new Set(), commit() {} } as any; },
      async run() { throw new Error("not used"); },
    }),
  })({
    on: (name: string, fn: Function) => events.set(name, fn),
    registerTool: (tool: any) => tools.set(tool.name, tool),
    registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {},
  } as any);
  return {
    events,
    tools,
    emit: (name: string, event: any = {}, ctx?: any) => events.get(name)!(event, ctx),
    settled: (id: string, details: any, name = "read", isError = false) => tools.get(name).renderResult(
      { content: [{ type: "text", text: "one\ntwo" }], details },
      { isPartial: false }, theme, { toolCallId: id, args, isError },
    ),
  };
}

function recorded(toolCallId: string, piTidyStartedAt: number, piTidyShowTimestamp: boolean) {
  return { toolCallId, details: { piTidyStartedAt, piTidyShowTimestamp, piTidyElapsedMs: 800 } };
}

test("minute grouping follows starts, not result order or render order", () => {
  const timeline = new ToolTimeline();
  timeline.start("first", start);
  timeline.start("second", start + 10_000);
  timeline.start("next-minute", start + 60_000);
  timeline.finish("second", start + 61_000);
  timeline.finish("first", start + 62_000);
  assert.equal(timeline.get("first")!.showTimestamp, true);
  assert.equal(timeline.get("second")!.showTimestamp, false);
  assert.equal(timeline.get("next-minute")!.showTimestamp, true);
  timeline.start("first", start + 180_000);
  assert.equal(timeline.get("first")!.startedAt, start);
  assert.equal(timeline.finish("first", start + 600_000)!.elapsedMs, 62_000);
});

test("restore only seeds the active branch and handles out-of-order completion", () => {
  const timeline = new ToolTimeline();
  timeline.restore([recorded("later", start + 60_000, true), recorded("earlier", start, true)]);
  timeline.start("same-minute", start + 70_000);
  assert.equal(timeline.get("same-minute")!.showTimestamp, false);
  timeline.restore([recorded("earlier", start, true)]);
  assert.equal(timeline.get("later"), undefined);
  timeline.start("fork", start + 30_000);
  assert.equal(timeline.get("fork")!.showTimestamp, false);
  timeline.restore([]);
  timeline.start("new-session", start + 31_000);
  assert.equal(timeline.get("new-session")!.showTimestamp, true);
});

test("clock labels are local HH:mm and minute grouping includes the date", () => {
  assert.equal(clockLabel(new Date(2026, 8, 24, 0, 5).getTime()), "00:05");
  assert.equal(clockLabel(start), "14:32");
  const timeline = new ToolTimeline();
  timeline.start("today", start);
  timeline.start("tomorrow", new Date(2026, 8, 25, 14, 32).getTime());
  assert.equal(timeline.get("tomorrow")!.showTimestamp, true);
  timeline.start("clock-adjusted", start - 60_000);
  assert.equal(timeline.get("clock-adjusted")!.showTimestamp, true);
  assert.equal(timeline.finish("clock-adjusted", start - 120_000)!.elapsedMs, 0);
});

test("legacy and malformed timing never become invented timestamps or durations", () => {
  for (const details of [undefined, null, {}, { piTidyElapsedMs: null }, { piTidyElapsedMs: "123" },
    { piTidyElapsedMs: -1 }, { piTidyElapsedMs: NaN }, { piTidyStartedAt: Infinity }, { piTidyStartedAt: 1e20 }]) {
    assert.equal(readToolTiming(details), undefined);
  }
  assert.deepEqual(readToolTiming({ piTidyElapsedMs: 0 }), {
    startedAt: undefined, elapsedMs: 0, showTimestamp: false,
  });
  assert.equal(readToolTiming({ piTidyStartedAt: start, piTidyShowTimestamp: "true" })!.showTimestamp, false);
});

test("every built-in gets a duration and an icon-only label in every layout", () => {
  const glyphs = { read: "󰈙", grep: "󰱼", find: "󰥨", ls: "󰉋", write: "󰆓", edit: "󱇧", bash: "󰆍" };
  for (const [name, glyph] of Object.entries(glyphs)) {
    for (const mode of ["default", "reasoning", "result"] as const) {
      for (const isError of [false, true]) {
        const output = buildToolBlock(name, args, { content: [{ type: "text", text: "result" }] }, {
          mode, isError, elapsedMs: 3_100,
        }).map(plain);
        assert.ok(output[0].startsWith(`${glyph} `));
        assert.equal(output[0].startsWith(`${glyph} ${name} `), false);
        assert.ok(output.at(-1)!.endsWith(" · 3s"));
        assert.equal(output.some((line) => line.startsWith(" ")), false);
      }
    }
    const iconless = buildToolBlock(name, args, {}, { icons: false, elapsedMs: 3_100 }).map(plain);
    assert.ok(iconless[0].startsWith(`${name} `));
  }
  assert.match(plain(buildToolBlock("custom", args, {})[0]), /^󱁤 custom /);
});

test("rendering before execution does not count argument streaming as tool runtime", async (t) => {
  const h = await harness();
  let now = start;
  t.mock.method(Date, "now", () => now);
  const read = h.tools.get("read");
  const live = read.renderCall(args, theme, { toolCallId: "streaming", isPartial: true, invalidate() {} });
  assert.deepEqual(rows(live), ["· 󰈙 inspect the source", "src/file.ts → preparing"]);
  now += 30_000;
  await h.emit("tool_execution_start", { toolName: "read", toolCallId: "streaming", args });
  now += 2_000;
  assert.match(rows(live)[0], /^── 14:32 ─/);
  assert.equal(rows(live).at(-1), "src/file.ts → 2s");
  const patch = await h.emit("tool_result", { toolName: "read", toolCallId: "streaming", details: { existing: true } });
  assert.deepEqual(patch.details, {
    existing: true, piTidyStartedAt: start + 30_000, piTidyShowTimestamp: true, piTidyElapsedMs: 2_000,
  });
  await h.emit("tool_execution_end", { toolName: "read", toolCallId: "streaming" });
  now += 20_000;
  const completed = h.settled("streaming", patch.details);
  assert.equal(rows(completed).at(-1), "src/file.ts → 2 lines · 2s");
  const baseline = rows(completed);
  now += 300_000;
  completed.invalidate();
  assert.deepEqual(rows(completed), baseline);
  assert.deepEqual(rows(h.settled("streaming", patch.details)), baseline);
  await h.emit("session_shutdown");
});

test("registered renderers place one plain divider per minute across turns and reload", async (t) => {
  const h = await harness();
  let now = start;
  t.mock.method(Date, "now", () => now);
  const results: any[] = [];
  for (const [id, when, expectedDivider] of [["first", start, true], ["second", start + 10_000, false], ["third", start + 180_000, true]] as const) {
    now = when;
    await h.emit("tool_execution_start", { toolName: "read", toolCallId: id, args });
    now += 300;
    const patch = await h.emit("tool_result", { toolName: "read", toolCallId: id });
    await h.emit("tool_execution_end", { toolName: "read", toolCallId: id });
    const output = rows(h.settled(id, patch.details));
    assert.equal(output[0].startsWith("──"), expectedDivider);
    assert.equal(output.at(-1), "src/file.ts → 2 lines · <1s");
    results.push({ type: "message", message: { role: "toolResult", toolName: "read", toolCallId: id, details: patch.details } });
    await h.emit("turn_end");
  }
  const restored = await harness();
  await restored.emit("session_start", { reason: "reload" }, { sessionManager: { getBranch: () => results } });
  for (const entry of results.reverse()) {
    assert.deepEqual(rows(restored.settled(entry.message.toolCallId, entry.message.details)), rows(h.settled(entry.message.toolCallId, entry.message.details)));
  }
  now = start + 190_000;
  await restored.emit("tool_execution_start", { toolName: "read", toolCallId: "after-reload", args });
  const patch = await restored.emit("tool_result", { toolName: "read", toolCallId: "after-reload" });
  assert.equal(patch.details.piTidyShowTimestamp, false);
  await restored.emit("session_tree", {}, { sessionManager: { getBranch: () => [] } });
  await restored.emit("tool_execution_start", { toolName: "read", toolCallId: "new-branch", args });
  assert.equal((await restored.emit("tool_result", { toolName: "read", toolCallId: "new-branch" })).details.piTidyShowTimestamp, true);
});

test("dividers stay outside tool backgrounds and fit narrow widths", async () => {
  const h = await harness();
  const detail = recorded("narrow", start, true).details;
  const component = h.tools.get("read").renderResult({ output: "one\ntwo", details: detail }, {}, {
    bg: (_name: string, text: string) => `\x1b[42m${text}\x1b[49m`,
  }, { toolCallId: "narrow", args });
  for (const width of [1, 2, 8, 12, 28, 72, 140]) {
    const output: string[] = component.render(width);
    assert.ok(output.every((line) => visibleWidth(line) <= width));
    assert.doesNotMatch(output[0], /\x1b\[42m/);
    assert.match(output[2], /\x1b\[42m/);
    if (width >= 28) assert.match(plain(output.at(-1)!), /2 lines · <1s$/);
  }
});

test("narrow result summaries preserve the duration suffix", () => {
  const block = buildToolBlock("grep", { pattern: "long pattern", path: "src" }, {
    output: "a.ts:1:one\nb.ts:2:two\nc.ts:3:three",
  }, { elapsedMs: 8_000 });
  for (const width of [8, 12, 20, 28, 72]) {
    const fitted = fitToolLine(block[1], width);
    assert.ok(visibleWidth(fitted) <= width);
    assert.match(plain(fitted), /· 8s$/);
  }
});

test("provider-native replay does not claim its playback duration as execution time", async () => {
  const h = await harness((id) => id === "replay");
  await h.emit("tool_execution_start", { toolName: "read", toolCallId: "replay", args });
  assert.equal(await h.emit("tool_result", { toolName: "read", toolCallId: "replay" }), undefined);
  await h.emit("tool_execution_end", { toolName: "read", toolCallId: "replay" });
  assert.deepEqual(rows(h.settled("replay", undefined)), ["󰈙 src/file.ts → 2 lines"]);
});

test("old results omit unknown timing even after call hydration", async () => {
  const h = await harness();
  const read = h.tools.get("read");
  read.renderCall(args, theme, { toolCallId: "old", isPartial: true, invalidate() {} });
  const old = h.settled("old", undefined);
  assert.deepEqual(rows(old), ["󰈙 inspect the source", "src/file.ts → 2 lines"]);
  const legacy = h.settled("legacy", { piTidyElapsedMs: 8_000 });
  assert.deepEqual(rows(legacy), ["󰈙 inspect the source", "src/file.ts → 2 lines · 8s"]);
  await h.emit("session_shutdown");
});

test("failed executions get the same clock and duration display", async (t) => {
  const h = await harness();
  let now = start;
  t.mock.method(Date, "now", () => now);
  await h.emit("tool_execution_start", { toolName: "edit", toolCallId: "error", args });
  now += 1_200;
  const patch = await h.emit("tool_result", { toolName: "edit", toolCallId: "error", isError: true });
  await h.emit("tool_execution_end", { toolName: "edit", toolCallId: "error", isError: true });
  const output = rows(h.settled("error", patch.details, "edit", true));
  assert.match(output[0], /^── 14:32 ─/);
  assert.match(output.at(-1)!, /→ one · 1s$/);
});
