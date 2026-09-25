import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager, createEventBus } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { createToolPresentation } from "../../extensions/tool-presentation/index.js";
import { CONVERSATION_TIMELINE_ENTRY, readTimelineEntry, renderTimelineEntry } from "../../extensions/tool-presentation/conversation-timeline.js";

const start = new Date(2026, 8, 24, 14, 32).getTime();
const user = () => ({ role: "user", content: [{ type: "text", text: "Fix the tests" }], timestamp: Date.now() });
const assistant = (text = "", stopReason = "stop") => ({
  role: "assistant", content: text ? [{ type: "text", text }] : [], stopReason, timestamp: Date.now(),
});
const theme = { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text };
const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "").trimEnd();
const integration = () => ({
  async initialize() { return { skipTidyTools: new Set(), commit() {} } as any; },
  async run() { throw new Error("not used"); },
});

async function harness({ enabled = true, manager = SessionManager.inMemory(), mode = "json" } = {}) {
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const renderers = new Map<string, Function>();
  const working: (string | undefined)[] = [];
  const ctx = {
    mode, sessionManager: manager,
    ui: { notify() {}, setWorkingMessage: (message?: string) => working.push(message) },
  };
  const appended: any[] = [];
  await createToolPresentation({
    loadState: () => ({ enabled, source: "default" }), loadIcons: () => true, loadMode: () => "default",
    createIntegration: integration,
  })({
    events: createEventBus(),
    on(name: string, handler: Function) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerEntryRenderer(name: string, renderer: Function) { renderers.set(name, renderer); },
    appendEntry(name: string, data: any) { manager.appendCustomEntry(name, data); appended.push(data); },
    registerCommand() {}, registerShortcut() {}, registerMessageRenderer() {}, getAllTools: () => [],
  } as any);
  async function fire(name: string, event: any = {}) {
    let result: any;
    for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx) ?? result;
    // Pi persists finalized messages after extension handlers have run.
    if (name === "message_end") manager.appendMessage(event.message);
    return result;
  }
  await fire("session_start", { reason: "startup" });
  return { fire, tools, renderers, appended, manager, working };
}

test("host enables the conversation timeline only when tidy is enabled", async () => {
  const on = await harness();
  assert.ok(on.renderers.has(CONVERSATION_TIMELINE_ENTRY));
  const off = await harness({ enabled: false });
  assert.equal(off.renderers.has(CONVERSATION_TIMELINE_ENTRY), false);
  await off.fire("message_start", { message: user() });
  await off.fire("agent_start");
  await off.fire("agent_settled");
  assert.deepEqual(off.appended, []);
});

test("messages and built-in tools share minute groups without splitting streaming messages", async (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  const h = await harness();
  await h.fire("agent_start");
  const request = user();
  await h.fire("message_start", { message: request });
  await h.fire("message_end", { message: request });
  await h.fire("message_start", { message: assistant() });
  assert.deepEqual(h.appended, [{ kind: "minute", at: start }]);
  now += 60_000;
  await h.fire("message_update", { message: assistant("Checking the implementation") });
  now += 60_000;
  await h.fire("message_update", { message: assistant("Checking the implementation and callers") });
  assert.deepEqual(h.appended.map((e) => e.at), [start, start + 60_000]);
  await h.fire("message_end", { message: assistant("Checking the implementation and callers") });
  const args = { path: "test.ts", reasoning: "inspect the test" };
  await h.fire("tool_execution_start", { toolName: "read", toolCallId: "read", args });
  now += 700;
  const patch = await h.fire("tool_result", { toolName: "read", toolCallId: "read" });
  assert.equal(patch.details.piTidyShowTimestamp, true);
  const result = { role: "toolResult", toolName: "read", toolCallId: "read", content: [{ type: "text", text: "one" }], details: patch.details, timestamp: now };
  await h.fire("message_end", { message: result });
  await h.fire("tool_execution_end", { toolName: "read", toolCallId: "read", result });
  const output = h.tools.get("read").renderResult(result, {}, theme, { toolCallId: "read", args }).render(60).map(plain);
  assert.match(output[0], /^── 14:34 ─/);
  assert.equal(output.at(-1), "test.ts → 1 lines · <1s");
  await h.fire("message_start", { message: assistant() });
  await h.fire("message_update", { message: assistant("Fixed") });
  await h.fire("message_end", { message: assistant("Fixed") });
  await h.fire("agent_end", { messages: [assistant("Fixed")] });
  assert.equal(h.appended.length, 2, "agent_end is not the completion boundary");
  now += 1_300;
  await h.fire("agent_settled");
  assert.deepEqual(h.appended.at(-1), { kind: "run-end", at: now, startedAt: start, elapsedMs: 122_000, outcome: "completed" });
  await h.fire("agent_settled");
  assert.equal(h.appended.length, 3);
  // Custom entries must never enter model context.
  const context = JSON.stringify(h.manager.buildSessionContext().messages);
  assert.doesNotMatch(context, /pi-conversation-timeline|run-end|Completed in/);
});

test("a message marker suppresses a same-minute tool divider", async (t) => {
  t.mock.method(Date, "now", () => start);
  const h = await harness();
  await h.fire("message_start", { message: user() });
  await h.fire("tool_execution_start", { toolName: "bash", toolCallId: "shell", args: { command: "true" } });
  const patch = await h.fire("tool_result", { toolName: "bash", toolCallId: "shell" });
  assert.equal(patch.details.piTidyShowTimestamp, false);
});

test("retry and queued continuation loops keep one total; idle time is excluded", async (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  const h = await harness();
  await h.fire("agent_start");
  now += 20_000;
  await h.fire("agent_end", { messages: [assistant("", "error")] });
  now += 10_000;
  await h.fire("agent_start");
  now += 30_000;
  await h.fire("agent_end", { messages: [assistant("Done")] });
  await h.fire("agent_start");
  now += 10_000;
  await h.fire("agent_end", { messages: [assistant("Follow-up done")] });
  await h.fire("agent_settled");
  assert.equal(h.appended.length, 1);
  assert.equal(h.appended[0].elapsedMs, 70_000);
  assert.equal(h.appended[0].outcome, "completed");
  now += 600_000;
  await h.fire("agent_start");
  now += 2_000;
  await h.fire("agent_end", { messages: [assistant("Done")] });
  await h.fire("agent_settled");
  assert.equal(h.appended[1].elapsedMs, 2_000);
});

test("failed and aborted runs are not labelled completed", async (t) => {
  t.mock.method(Date, "now", () => start);
  for (const [stopReason, outcome] of [["error", "failed"], ["aborted", "stopped"], ["length", "stopped"]]) {
    const h = await harness();
    await h.fire("agent_start");
    await h.fire("agent_end", { messages: [assistant("", stopReason)] });
    await h.fire("agent_settled");
    assert.equal(h.appended.at(-1).outcome, outcome);
  }
});

test("reload and tree navigation restore only the active branch without adding entries", async (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  const h = await harness();
  const request = user();
  await h.fire("message_start", { message: request });
  await h.fire("message_end", { message: request });
  const branchPoint = h.manager.getLeafId()!;
  now += 180_000;
  await h.fire("message_start", { message: assistant("Later") });
  await h.fire("message_end", { message: assistant("Later") });
  const before = h.manager.getEntries().length;
  const restored = await harness({ manager: h.manager });
  assert.equal(h.manager.getEntries().length, before);
  await restored.fire("message_start", { message: user() });
  assert.deepEqual(restored.appended, []);
  h.manager.branch(branchPoint);
  await restored.fire("session_tree");
  await restored.fire("message_start", { message: user() });
  assert.deepEqual(restored.appended, [{ kind: "minute", at: now }]);
});

test("the working indicator updates only in TUI and releases its timer at settlement and shutdown", async (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  const callbacks: Function[] = [];
  const cleared: unknown[] = [];
  const timers: unknown[] = [];
  t.mock.method(globalThis, "setInterval", (callback: Function) => {
    callbacks.push(callback);
    const timer = { unref() {} };
    timers.push(timer);
    return timer as any;
  });
  t.mock.method(globalThis, "clearInterval", (timer: unknown) => cleared.push(timer));
  const h = await harness({ mode: "tui" });
  await h.fire("agent_start");
  await h.fire("agent_start");
  assert.equal(callbacks.length, 1);
  assert.equal(h.working.at(-1), "Working · <1s");
  now += 61_000;
  callbacks[0]();
  assert.equal(h.working.at(-1), "Working · 1m 01s");
  await h.fire("agent_settled");
  assert.equal(h.working.at(-1), undefined);
  assert.deepEqual(cleared, [timers[0]]);
  await h.fire("agent_start");
  await h.fire("session_shutdown");
  callbacks[1]();
  assert.equal(h.working.at(-1), undefined);
  assert.equal(h.appended.length, 1, "shutdown must not invent a completed run");
  const headless = await harness();
  await headless.fire("agent_start");
  await headless.fire("agent_settled");
  assert.equal(callbacks.length, 2);
  assert.deepEqual(headless.working, []);
});

test("turn totals appear only from five minutes, including after reload", async (t) => {
  let now = start;
  t.mock.method(Date, "now", () => now);
  for (const [stopReason, label] of [["stop", "Completed in"], ["aborted", "Stopped after"], ["error", "Failed after"]]) {
    for (const elapsedMs of [0, 9_000, 299_999, 300_000, 300_001, 360_000]) {
      now = start;
      const h = await harness();
      await h.fire("agent_start");
      now += elapsedMs;
      await h.fire("agent_end", { messages: [assistant("Done", stopReason)] });
      await h.fire("agent_settled");
      const data = h.appended.at(-1);
      assert.equal(data.elapsedMs, elapsedMs, "short turns still retain their timing");
      const restored = await harness({ manager: h.manager });
      const saved = h.manager.getBranch().find((entry) => entry.type === "custom");
      for (const [host, entry] of [[h, { data }], [restored, saved]] as const) {
        const component = host.renderers.get(CONVERSATION_TIMELINE_ENTRY)!(entry, {}, theme);
        if (elapsedMs < 300_000) {
          assert.equal(component, undefined, "hidden totals must not create a transcript spacer");
        } else {
          assert.equal(component.render(72)[0], `${label} ${elapsedMs < 360_000 ? "5m 00s" : "6m 00s"}`);
        }
      }
    }
  }
});

test("clock dividers use visible borders while timestamps and completion totals remain dim", async () => {
  const h = await harness();
  const calls: { color: string; text: string }[] = [];
  const palette = {
    fg(color: string, text: string) {
      calls.push({ color, text });
      return `\x1b[${color === "border" ? "90" : "37"}m${text}\x1b[39m`;
    },
  };
  const renderer = h.renderers.get(CONVERSATION_TIMELINE_ENTRY)!;
  const divider = renderer({ data: { kind: "minute", at: start } }, {}, palette);
  for (const width of [1, 5, 8, 28, 72]) {
    calls.length = 0;
    const [line] = divider.render(width);
    assert.equal(visibleWidth(line), width);
    if (width > 1) assert.ok(calls.some(({ color, text }) => color === "border" && text.includes("─")));
    assert.ok(calls.filter(({ text }) => /─/.test(text)).every(({ color }) => color === "border"));
    if (width >= 9) assert.ok(calls.some(({ color, text }) => color === "dim" && text.includes("14:32")));
  }
  calls.length = 0;
  renderer({ data: { kind: "run-end", at: start, startedAt: start, elapsedMs: 300_000, outcome: "completed" } }, {}, palette).render(72);
  assert.deepEqual(calls, [{ color: "dim", text: "Completed in 5m 00s" }]);
});

test("saved timeline entries render stably at narrow widths and reject malformed data", async () => {
  const h = await harness();
  const renderer = h.renderers.get(CONVERSATION_TIMELINE_ENTRY)!;
  for (const value of [null, {}, { kind: "minute", at: "12" }, { kind: "minute", at: Infinity }, { kind: "run-end", at: start }]) {
    assert.equal(readTimelineEntry(value), undefined);
    assert.equal(renderer({ data: value }, {}, theme), undefined);
  }
  for (const data of [
    { kind: "minute", at: start } as const,
    { kind: "run-end", at: start + 302_000, startedAt: start, elapsedMs: 302_000, outcome: "completed" } as const,
  ]) {
    const component = renderer({ data }, {}, theme);
    for (const width of [1, 8, 28, 72]) {
      const first = component.render(width);
      assert.ok(first.every((line: string) => visibleWidth(line) <= width));
      component.invalidate();
      assert.deepEqual(component.render(width), first);
    }
  }
  assert.equal(renderTimelineEntry({ kind: "run-end", at: start, startedAt: start, elapsedMs: 122_000, outcome: "completed" }, 72), "Completed in 2m 02s");
});
