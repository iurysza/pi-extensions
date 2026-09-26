import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import cacheHitPredictor from "../index.js";

const oldModel = {
  provider: "openai",
  api: "openai-responses",
  id: "gpt-old",
  name: "Old",
  reasoning: true,
  input: ["text"] as Array<"text">,
  baseUrl: "https://example.invalid",
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 10_000,
} as const;
const newModel = { ...oldModel, id: "gpt-new", name: "New" };
const warning = "<warning>󱘿</warning>";

let nextId = 1;
function baseEntry(type: string) {
  const id = String(nextId++);
  return { type, id, parentId: null, timestamp: new Date(Date.now()).toISOString() };
}
function thinkingChange(level: string): SessionEntry {
  return { ...baseEntry("thinking_level_change"), type: "thinking_level_change", thinkingLevel: level };
}
function assistant(model: string, prompt = 25_010, timestamp = Date.now()): Extract<SessionEntry, { type: "message" }> {
  return {
    ...baseEntry("message"), type: "message",
    message: {
      role: "assistant", content: [], api: "openai-responses", provider: "openai", model,
      usage: {
        input: prompt, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: prompt + 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop", timestamp,
    },
  };
}
function warmed(model: string) {
  // Runtime Pi has UsageEntry even when the minimum supported SDK does not.
  return { ...baseEntry("usage"), kind: "cache_warm", provider: "openai", model } as unknown as SessionEntry;
}

function createHarness(t: TestContext, options?: {
  branch?: SessionEntry[];
  contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
  minutes?: string;
  mode?: "tui" | "rpc";
}) {
  const previous = process.env.PI_CACHE_IDLE_MINUTES;
  if (options?.minutes === undefined) delete process.env.PI_CACHE_IDLE_MINUTES;
  else process.env.PI_CACHE_IDLE_MINUTES = options.minutes;
  const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
  const busHandlers = new Map<string, Set<(data: unknown) => void>>();
  const busEvents: Array<{ channel: string; data: unknown }> = [];
  const statuses: Array<string | undefined> = [];
  const branch = options?.branch ?? [thinkingChange("high"), assistant("gpt-old")];
  let thinkingLevel = "high";
  const ctx = {
    mode: options?.mode ?? "tui", model: oldModel,
    getContextUsage: () => options?.contextUsage === undefined
      ? { tokens: 100_000, contextWindow: 200_000, percent: 50 } : options.contextUsage,
    sessionManager: { getBranch: () => branch },
    ui: {
      theme: { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
      setStatus(key: string, value: string | undefined) {
        assert.equal(key, "pi-cache-hit-predictor");
        statuses.push(value);
      },
    },
  } as unknown as ExtensionContext;
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        busEvents.push({ channel, data });
        for (const handler of busHandlers.get(channel) ?? []) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void) {
        const listeners = busHandlers.get(channel) ?? new Set();
        listeners.add(handler);
        busHandlers.set(channel, listeners);
        return () => listeners.delete(handler);
      },
    },
    on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) { handlers.set(event, handler); },
    getThinkingLevel: () => thinkingLevel,
  } as unknown as ExtensionAPI;
  cacheHitPredictor(pi);
  const fire = async (event: string, data: unknown = {}) => { await handlers.get(event)?.(data as never, ctx); };
  t.after(async () => {
    await fire("session_shutdown");
    if (previous === undefined) delete process.env.PI_CACHE_IDLE_MINUTES;
    else process.env.PI_CACHE_IDLE_MINUTES = previous;
  });
  return {
    pi, ctx, statuses, busEvents, branch, fire,
    async select(model = newModel) {
      const previousModel = ctx.model;
      ctx.model = model;
      await fire("model_select", { model, previousModel, source: "set" });
    },
    async think(level: string, previousLevel: string) {
      thinkingLevel = level;
      await fire("thinking_level_select", { level, previousLevel });
    },
  };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

for (const contextUsage of [undefined, null]) {
  test(`shows only the amber database-clock for a cold switch, context=${contextUsage}`, async (t) => {
    const h = createHarness(t, { contextUsage });
    await h.fire("session_start");
    assert.equal(h.statuses.at(-1), undefined);
    await h.select();
    await settle();
    assert.equal(h.statuses.at(-1), warning);
  });
}

test("shows partial loss and hides it when switching back to the original warm lane", async (t) => {
  const h = createHarness(t, { branch: [thinkingChange("high"), assistant("gpt-new", 25_000), assistant("gpt-old", 100_000)] });
  await h.fire("session_start");
  await h.select();
  await settle();
  assert.equal(h.statuses.at(-1), warning);
  await h.select(oldModel);
  await settle();
  assert.equal(h.statuses.at(-1), undefined);
});

test("compares repeated cold selections against the last actual response", async (t) => {
  const h = createHarness(t);
  await h.fire("session_start");
  await h.select();
  await settle();
  await h.select({ ...newModel, id: "third" });
  await settle();
  assert.equal(h.statuses.at(-1), warning);
});

test("does not warn when a reasoning lane carries more cache", async (t) => {
  const h = createHarness(t, { branch: [
    thinkingChange("high"), assistant("gpt-old", 100_000),
    thinkingChange("low"), assistant("gpt-old", 25_000),
  ] });
  await h.fire("session_start");
  await h.think("high", "low");
  await settle();
  assert.equal(h.statuses.at(-1), undefined);
});

test("warns on a reasoning change and coalesces paired selection events", async (t) => {
  const h = createHarness(t);
  await h.fire("session_start");
  await h.think("low", "high");
  await h.select();
  await settle();
  assert.equal(h.statuses.filter(Boolean).length, 1);
  assert.equal(h.statuses.at(-1), warning);
});

test("preserves switch warning through errors, aborts, and responses on other lanes", async (t) => {
  const h = createHarness(t);
  await h.fire("session_start");
  await h.select();
  await settle();
  for (const stopReason of ["error", "aborted"]) {
    await h.fire("message_end", { message: { ...assistant(newModel.id).message, stopReason } });
    assert.equal(h.statuses.at(-1), warning);
  }
  await h.fire("message_end", { message: assistant(oldModel.id).message });
  assert.equal(h.statuses.at(-1), warning);
  await h.fire("message_end", { message: assistant(newModel.id).message });
  assert.equal(h.statuses.at(-1), undefined);
});

test("warns at the thirty-minute default without another user action and clears on fresh success", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  const h = createHarness(t);
  await h.fire("session_start");
  t.mock.timers.tick(1_799_000);
  assert.equal(h.statuses.at(-1), undefined);
  t.mock.timers.tick(1_000);
  assert.equal(h.statuses.at(-1), warning);
  await h.fire("message_end", { message: assistant(oldModel.id).message });
  assert.equal(h.statuses.at(-1), undefined);
});

test("counts long streaming time from request start, not response completion", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  const h = createHarness(t, { branch: [] });
  await h.fire("session_start");
  t.mock.timers.tick(1_801_000);
  await h.fire("message_end", { message: assistant(oldModel.id, 25_000, 1_000_000).message });
  assert.equal(h.statuses.at(-1), warning);
});

test("recognizes successful background warming without a message event", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  const h = createHarness(t);
  await h.fire("session_start");
  t.mock.timers.tick(1_800_000);
  assert.equal(h.statuses.at(-1), warning);
  h.branch.push(warmed(oldModel.id));
  h.branch.push({ ...baseEntry("custom"), customType: "unrelated", data: {} } as SessionEntry);
  t.mock.timers.tick(1_000);
  assert.equal(h.statuses.at(-1), undefined);
  t.mock.timers.tick(1_799_000);
  assert.equal(h.statuses.at(-1), warning);
});

test("does not let warming another model hide the selected lane's age", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  const h = createHarness(t);
  await h.fire("session_start");
  t.mock.timers.tick(1_800_000);
  h.branch.push(warmed(newModel.id));
  t.mock.timers.tick(1_000);
  assert.equal(h.statuses.at(-1), warning);
});

test("restores warming history and clears state on a new branch or compaction", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1_000_000 });
  const h = createHarness(t, { branch: [thinkingChange("high"), assistant(oldModel.id, 25_000, Date.now() - 1_801_000), warmed(oldModel.id)] });
  await h.fire("session_start");
  assert.equal(h.statuses.at(-1), undefined);
  t.mock.timers.tick(1_800_000);
  assert.equal(h.statuses.at(-1), warning);
  h.branch.length = 0;
  await h.fire("session_tree");
  assert.equal(h.statuses.at(-1), undefined);
  t.mock.timers.tick(1_800_000);
  assert.equal(h.statuses.at(-1), undefined);
  await h.fire("session_compact");
  assert.equal(h.statuses.at(-1), undefined);
});

test("honors a configured threshold and zero disables only idle warnings", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000_000 });
  const h = createHarness(t, { minutes: "1" });
  await h.fire("session_start");
  t.mock.timers.tick(60_000);
  assert.equal(h.statuses.at(-1), warning);
  process.env.PI_CACHE_IDLE_MINUTES = "0";
  await h.fire("session_start");
  t.mock.timers.tick(3_600_000);
  assert.equal(h.statuses.at(-1), undefined);
  await h.select();
  t.mock.timers.tick(0);
  assert.equal(h.statuses.at(-1), warning);
});

test("cancels queued selections and idle timers on restore, reset, and shutdown", async (t) => {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now: 1_000_000 });
  const h = createHarness(t);
  await h.fire("session_start");
  await h.select();
  await h.fire("model_select", { model: oldModel, source: "restore" });
  t.mock.timers.tick(0);
  assert.equal(h.statuses.at(-1), undefined);
  await h.select();
  h.branch.length = 0;
  await h.fire("session_tree");
  t.mock.timers.tick(0);
  assert.equal(h.statuses.at(-1), undefined);
  await h.select();
  await h.fire("session_shutdown");
  const count = h.statuses.length;
  t.mock.timers.tick(3_600_000);
  assert.equal(h.statuses.length, count);
});

test("registers inline context placement and disposes the ready listener", async (t) => {
  const h = createHarness(t);
  const registrations = () => h.busEvents.filter(({ channel }) => channel.endsWith("/register/v1"));
  assert.deepEqual(registrations().at(-1)?.data, {
    protocolVersion: 1, id: "pi-cache-hit-predictor", priority: 200, placement: "context",
  });
  h.pi.events.emit("@iurysza/pi-ext/footer-slot/ready/v1", { protocolVersion: 1 });
  assert.equal(registrations().length, 2);
  await h.fire("session_shutdown");
  h.pi.events.emit("@iurysza/pi-ext/footer-slot/ready/v1", { protocolVersion: 1 });
  assert.equal(registrations().length, 2);
  assert.ok(h.busEvents.some(({ channel }) => channel.endsWith("/unregister/v1")));
});

test("does not publish a warning outside the TUI", async (t) => {
  const h = createHarness(t, { mode: "rpc" });
  await h.fire("session_start");
  await h.select();
  await settle();
  assert.equal(h.statuses.at(-1), undefined);
});
