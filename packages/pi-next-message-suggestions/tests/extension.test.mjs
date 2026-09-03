import assert from "node:assert/strict";
import test from "node:test";

import {
  generateSuggestions,
  registerNextMessageSuggestions,
} from "../src/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

function assistant(text) {
  return {
    role: "assistant",
    content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text }],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: 1,
  };
}

function branch(text = "long answer") {
  return [
    { type: "message", message: { role: "user", content: "First request", timestamp: 1 } },
    { type: "message", message: assistant("Prior answer") },
    { type: "message", message: { role: "toolResult", content: [{ type: "text", text: "excluded tool output" }], toolCallId: "tool", toolName: "read", isError: false, timestamp: 2 } },
    { type: "message", message: { role: "user", content: "Latest request", timestamp: 3 } },
    { type: "message", message: assistant(text) },
  ];
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createHarness({ generator, messages = branch() } = {}) {
  const handlers = new Map();
  const flags = new Map([
    ["next-message-suggestions-threshold", "5"],
    ["next-message-suggestions-recent-messages", "3"],
    ["next-message-suggestions-count", "3"],
    ["next-message-suggestions-prompt", DEFAULT_CONFIG.prompt],
    ["next-message-suggestions-provider", DEFAULT_CONFIG.provider],
    ["next-message-suggestions-model", DEFAULT_CONFIG.model],
    ["next-message-suggestions-thinking", DEFAULT_CONFIG.thinking],
  ]);
  const widgets = [];
  const pasted = [];
  const sent = [];
  const notifications = [];
  let terminalInput;
  let currentBranch = messages;
  const ctx = {
    mode: "tui",
    sessionManager: {
      getBranch: () => currentBranch,
      getLeafId: () => currentBranch.at(-1)?.message?.timestamp ?? null,
    },
    ui: {
      setWidget(key, content, options) { widgets.push({ key, content, options }); },
      onTerminalInput(handler) { terminalInput = handler; return () => { terminalInput = undefined; }; },
      pasteToEditor(text) { pasted.push(text); },
      notify(text, type) { notifications.push({ text, type }); },
    },
  };
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerFlag(name, options) { if (!flags.has(name)) flags.set(name, options.default); },
    registerCommand() {},
    getFlag(name) { return flags.get(name); },
    sendUserMessage(text) { sent.push(text); },
  };
  registerNextMessageSuggestions(pi, generator);
  return {
    ctx,
    flags,
    widgets,
    pasted,
    sent,
    notifications,
    setBranch(value) { currentBranch = value; },
    async fire(name) { await handlers.get(name)?.({}, ctx); },
    input(raw) { return terminalInput?.(raw); },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function latestWidgetText(harness) {
  const factory = harness.widgets.at(-1)?.content;
  if (!factory) return "";
  return factory({}, { fg: (_role, text) => text }).render(200).join("\n");
}

test("passes only recent conversational context to the fixed helper model", async () => {
  const calls = [];
  const model = { provider: "openai-codex", id: "gpt-5.6-luna" };
  const ctx = {
    model: { provider: "active", id: "expensive" },
    modelRegistry: {
      find(provider, id) { calls.push({ kind: "find", provider, id }); return model; },
      async getApiKeyAndHeaders() { return { ok: true, apiKey: "test", headers: {} }; },
    },
  };
  const config = { ...DEFAULT_CONFIG, count: 4 };
  const result = await generateSuggestions(
    ctx,
    config,
    [
      { role: "assistant", text: "Prior answer" },
      { role: "user", text: "Latest request" },
      { role: "assistant", text: "Current answer" },
    ],
    new AbortController().signal,
    async (requestModel, requestContext, options) => {
      calls.push({ kind: "request", requestModel, requestContext, options });
      return {
        ...assistant(""),
        content: [{ type: "toolCall", id: "next", name: "next_message_suggestions", arguments: { suggestions: ["Add tests.", "Explain this.", "Ship it.", "Show the diff."] } }],
      };
    },
  );

  assert.deepEqual(result, ["Add tests.", "Explain this.", "Ship it.", "Show the diff."]);
  assert.deepEqual(calls[0], { kind: "find", provider: "openai-codex", id: "gpt-5.6-luna" });
  const request = calls[1];
  assert.equal(request.requestModel, model);
  assert.equal(request.options.reasoningEffort, "low");
  assert.equal(request.options.toolChoice, "required");
  assert.equal(request.requestContext.tools[0].constrainedSampling.strict, "require");
  assert.equal(request.requestContext.tools[0].parameters.properties.suggestions.minItems, 4);
  assert.equal(request.requestContext.tools[0].parameters.properties.suggestions.maxItems, 4);
  assert.deepEqual(request.requestContext.messages.map((message) => [message.role, message.content[0].text]), [
    ["assistant", "Prior answer"],
    ["user", "Latest request"],
    ["assistant", "Current answer"],
  ]);
});

test("shows passive suggestions only after an eligible completed response", async () => {
  const gate = deferred();
  const seen = [];
  const h = createHarness({ generator: async (_ctx, config, context, signal) => {
    seen.push({ config, context, signal });
    return gate.promise;
  } });
  await h.fire("session_start");
  await h.fire("agent_settled");
  assert.equal(h.widgets.at(-1).content, undefined);
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].context, [
    { role: "assistant", text: "Prior answer" },
    { role: "user", text: "Latest request" },
    { role: "assistant", text: "long answer" },
  ]);

  gate.resolve(["Add tests.", "Explain the trade-off.", "Ship it."]);
  await flush();
  assert.match(latestWidgetText(h), /shift\+↑ choose/);
  assert.match(latestWidgetText(h), /· Add tests\./);
  assert.deepEqual(h.widgets.at(-1).options, { placement: "aboveEditor" });
  assert.equal(h.input("x"), undefined);
  assert.match(latestWidgetText(h), /· Add tests\./);
});

test("suppresses stale generation results when a new user message arrives", async () => {
  const gate = deferred();
  const h = createHarness({ generator: async () => gate.promise });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await h.fire("input");
  gate.resolve(["one", "two", "three"]);
  await flush();
  assert.equal(h.widgets.at(-1).content, undefined);
});

test("focuses, navigates, inserts, sends, and dismisses passive suggestions", async () => {
  const h = createHarness({ generator: async () => ["one", "two", "three"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();

  assert.deepEqual(h.input("\x1b[a"), { consume: true });
  assert.match(latestWidgetText(h), /› one/);
  assert.match(latestWidgetText(h), /enter send/);
  h.input("\x1b[B");
  assert.match(latestWidgetText(h), /› two/);
  h.input("\x1b[13;2u");
  assert.deepEqual(h.pasted, ["two"]);
  assert.match(latestWidgetText(h), /shift\+↑ choose/);

  h.input("\x1b[a");
  h.input("\x1b");
  assert.match(latestWidgetText(h), /shift\+↑ choose/);
  h.input("\x1b[a");
  h.input("\r");
  assert.deepEqual(h.sent, ["one"]);
  assert.equal(h.widgets.at(-1).content, undefined);
});

test("remains silent when optional generation fails or is below threshold", async () => {
  const failures = createHarness({ generator: async () => { throw new Error("network"); } });
  await failures.fire("session_start");
  await failures.fire("agent_settled");
  await flush();
  assert.equal(failures.widgets.at(-1).content, undefined);
  assert.deepEqual(failures.notifications, []);

  const skipped = createHarness({ messages: branch("tiny") });
  await skipped.fire("session_start");
  await skipped.fire("agent_settled");
  assert.equal(skipped.widgets.at(-1).content, undefined);
});

test("removes the widget and input listener at session shutdown", async () => {
  const h = createHarness({ generator: async () => ["one", "two", "three"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();
  await h.fire("session_shutdown");
  assert.equal(h.widgets.at(-1).content, undefined);
  assert.equal(h.input("\x1b[a"), undefined);
});
