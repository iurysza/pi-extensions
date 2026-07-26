import assert from "node:assert/strict";
import test from "node:test";
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
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 10_000,
} as const;
const newModel = { ...oldModel, id: "gpt-new", name: "New" };

const branch = [
  {
    type: "thinking_level_change",
    id: "00000001",
    parentId: null,
    timestamp: new Date(1_000).toISOString(),
    thinkingLevel: "low",
  },
  {
    type: "message",
    id: "00000002",
    parentId: "00000001",
    timestamp: new Date(2_000).toISOString(),
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model: "gpt-old",
      usage: {
        input: 17_000,
        output: 10,
        cacheRead: 8_000,
        cacheWrite: 0,
        totalTokens: 25_010,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2_000,
    },
  },
] as SessionEntry[];

function createHarness() {
  const handlers = new Map<string, (event: never, ctx: ExtensionContext) => unknown>();
  const busHandlers = new Map<string, Set<(data: unknown) => void>>();
  const busEvents: Array<{ channel: string; data: unknown }> = [];
  const statuses: Array<string | undefined> = [];
  const ctx = {
    mode: "tui",
    model: newModel,
    getContextUsage: () => ({ tokens: 100_000, contextWindow: 200_000, percent: 50 }),
    sessionManager: { getBranch: () => branch },
    modelRegistry: { find: () => undefined },
    ui: {
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
        const channelHandlers = busHandlers.get(channel) ?? new Set();
        channelHandlers.add(handler);
        busHandlers.set(channel, channelHandlers);
        return () => channelHandlers.delete(handler);
      },
    },
    on(event: string, handler: (event: never, ctx: ExtensionContext) => unknown) {
      handlers.set(event, handler);
    },
    getThinkingLevel: () => "high",
  } as unknown as ExtensionAPI;
  cacheHitPredictor(pi);
  return {
    pi,
    ctx,
    statuses,
    busEvents,
    async fire(event: string, data: unknown = {}) {
      await handlers.get(event)?.(data as never, ctx);
    },
  };
}

const waitForPrediction = () => new Promise((resolve) => setTimeout(resolve, 5));

test("coalesces a model clamp into one footer status", async () => {
  const harness = createHarness();
  await harness.fire("session_start");
  await harness.fire("thinking_level_select", { level: "high", previousLevel: "low" });
  await harness.fire("model_select", {
    model: newModel,
    previousModel: oldModel,
    source: "set",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.filter(Boolean).length, 1);
  assert.equal(
    harness.statuses.at(-1),
    "Cache hit prediction · gpt-new · high: cold lane (0% of ~100k)",
  );
});

test("clears only after a successful response on the predicted lane", async () => {
  const harness = createHarness();
  await harness.fire("model_select", {
    model: newModel,
    previousModel: oldModel,
    source: "set",
  });
  await waitForPrediction();
  const prediction = harness.statuses.at(-1);

  await harness.fire("after_provider_response", { status: 500, headers: {} });
  assert.equal(harness.statuses.at(-1), prediction);

  harness.ctx.model = oldModel as unknown as ExtensionContext["model"];
  await harness.fire("after_provider_response", { status: 200, headers: {} });
  assert.equal(harness.statuses.at(-1), prediction);

  harness.ctx.model = newModel as unknown as ExtensionContext["model"];
  await harness.fire("after_provider_response", { status: 204, headers: {} });
  assert.equal(harness.statuses.at(-1), undefined);
});

test("registers priority metadata and cleans up at shutdown", async () => {
  const harness = createHarness();
  const registrations = () => harness.busEvents.filter(({ channel }) => channel.endsWith("/register/v1"));
  assert.deepEqual(registrations().at(-1)?.data, {
    protocolVersion: 1,
    id: "pi-cache-hit-predictor",
    priority: 200,
  });
  harness.pi.events.emit("@iurysza/pi-ext/footer-slot/ready/v1", { protocolVersion: 1 });
  assert.equal(registrations().length, 2);

  await harness.fire("session_shutdown");
  assert.equal(harness.statuses.at(-1), undefined);
  assert.ok(harness.busEvents.some(({ channel }) => channel.endsWith("/unregister/v1")));
});
