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
  reasoning: true,
  input: ["text"],
  cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 10_000,
} as const;
const newModel = { ...oldModel, id: "gpt-new", name: "New" };

const testTheme = {
  fg(color: string, text: string) {
    return `<${color}>${text}</${color}>`;
  },
};

let nextId = 1;

function baseEntry(type: string) {
  const id = nextId.toString(16).padStart(8, "0");
  const parentId = nextId === 1 ? null : (nextId - 1).toString(16).padStart(8, "0");
  nextId += 1;
  return {
    type,
    id,
    parentId,
    timestamp: new Date(nextId * 1_000).toISOString(),
  };
}

function thinkingChange(level: string): SessionEntry {
  return {
    ...baseEntry("thinking_level_change"),
    type: "thinking_level_change",
    thinkingLevel: level,
  };
}

function assistant(
  model: string,
  prompt: number,
  cacheRead: number,
): Extract<SessionEntry, { type: "message" }> {
  return {
    ...baseEntry("message"),
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model,
      usage: {
        input: prompt - cacheRead,
        output: 10,
        cacheRead,
        cacheWrite: 0,
        totalTokens: prompt + 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: nextId * 1_000,
    },
  };
}

function createHarness(options?: {
  branch?: SessionEntry[];
  contextUsage?: { tokens: number; contextWindow: number; percent: number } | null;
}) {
  nextId = 1;
  const handlers = new Map<
    string,
    (event: never, ctx: ExtensionContext) => unknown
  >();
  const busHandlers = new Map<string, Set<(data: unknown) => void>>();
  const busEvents: Array<{ channel: string; data: unknown }> = [];
  const statuses: Array<string | undefined> = [];
  const branch = options?.branch ?? [
    thinkingChange("high"),
    assistant("gpt-old", 25_010, 8_000),
  ];
  const contextUsage = options?.contextUsage === undefined
    ? { tokens: 100_000, contextWindow: 200_000, percent: 50 }
    : options.contextUsage;
  const ctx = {
    mode: "tui",
    model: newModel,
    getContextUsage: () => contextUsage,
    sessionManager: { getBranch: () => branch },
    modelRegistry: { find: () => undefined },
    ui: {
      theme: testTheme,
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
    branch,
    async fire(event: string, data: unknown = {}) {
      await handlers.get(event)?.(data as never, ctx);
    },
  };
}

const waitForPrediction = () => new Promise((resolve) => setTimeout(resolve, 5));

function assistantMessage(
  branch: SessionEntry[],
  overrides: Record<string, unknown> = {},
) {
  const entry = branch[branch.length - 1] as Extract<SessionEntry, { type: "message" }>;
  return { ...entry.message, ...overrides };
}

test("shows a full cache drop when switching to a cold model", async () => {
  const harness = createHarness();
  await harness.fire("session_start");
  await harness.fire("model_select", {
    model: newModel,
    previousModel: oldModel,
    source: "set",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.at(-1), "󰆼 ↓25k/25k");
});

test("shows a partial drop when switching to a smaller cached lane", async () => {
  const harness = createHarness({
    branch: [
      thinkingChange("high"),
      assistant("gpt-old", 25_010, 8_000),
      assistant("gpt-new", 100_010, 24_000),
    ],
  });
  await harness.fire("session_start");
  await harness.fire("model_select", {
    model: oldModel,
    previousModel: newModel,
    source: "set",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.at(-1), "󰆼 ↓75k/100k");
});

test("shows a warm destination with no loss", async () => {
  const harness = createHarness({
    branch: [
      thinkingChange("low"),
      assistant("gpt-old", 25_010, 8_000),
      thinkingChange("high"),
      assistant("gpt-old", 100_010, 24_000),
      thinkingChange("low"),
      assistant("gpt-old", 25_010, 8_000),
    ],
  });
  await harness.fire("session_start");
  (harness.ctx as any).model = oldModel;
  await harness.fire("thinking_level_select", {
    level: "high",
    previousLevel: "low",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.at(-1), "󰆼 ↓0/25k");
});

test("coalesces paired model and thinking changes into one status", async () => {
  const harness = createHarness();
  await harness.fire("session_start");
  await harness.fire("thinking_level_select", {
    level: "high",
    previousLevel: "low",
  });
  await harness.fire("model_select", {
    model: newModel,
    previousModel: oldModel,
    source: "set",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.filter(Boolean).length, 1);
  assert.equal(harness.statuses.at(-1), "󰆼 ↓25k/25k");
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

  await harness.fire("message_end", {
    message: assistantMessage(harness.branch, { model: newModel.id, stopReason: "error" }),
  });
  assert.equal(harness.statuses.at(-1), prediction);

  await harness.fire("message_end", {
    message: assistantMessage(harness.branch, { model: newModel.id, stopReason: "aborted" }),
  });
  assert.equal(harness.statuses.at(-1), prediction);

  await harness.fire("message_end", {
    message: assistantMessage(harness.branch, { model: oldModel.id, stopReason: "stop" }),
  });
  assert.equal(harness.statuses.at(-1), prediction);

  await harness.fire("message_end", {
    message: assistantMessage(harness.branch, { model: newModel.id, stopReason: "stop" }),
  });
  assert.equal(harness.statuses.at(-1), undefined);
});

test("falls back to legacy text when context usage is unavailable", async () => {
  const harness = createHarness({ contextUsage: null });
  await harness.fire("session_start");
  await harness.fire("model_select", {
    model: newModel,
    previousModel: oldModel,
    source: "set",
  });
  await waitForPrediction();
  assert.equal(harness.statuses.at(-1), "󰆼 cold");
});

test("registers priority metadata and cleans up at shutdown", async () => {
  const harness = createHarness();
  const registrations = () =>
    harness.busEvents.filter(({ channel }) => channel.endsWith("/register/v1"));
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
