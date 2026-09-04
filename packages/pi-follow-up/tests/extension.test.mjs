import assert from "node:assert/strict";
import test from "node:test";

import { matchesKey } from "@earendil-works/pi-tui";
import {
  generateSuggestions,
  registerFollowUp,
} from "../src/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const SELECT_KEYS = {
  "tui.select.up": "up",
  "tui.select.down": "down",
  "tui.select.confirm": "enter",
  "tui.select.cancel": "escape",
};

function pickerKeybindings() {
  return {
    matches(data, id) {
      const key = SELECT_KEYS[id];
      return key ? matchesKey(data, key) : false;
    },
  };
}

function pickerTheme() {
  return {
    fg(_color, text) { return text; },
    bold(text) { return text; },
  };
}

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

function createHarness({
  generator,
  messages = branch(),
  config = { ...DEFAULT_CONFIG, threshold: 5 },
  configPath = "/tmp/pi-follow-up.json",
} = {}) {
  const handlers = new Map();
  const commands = new Map();
  const widgets = [];
  const pasted = [];
  const sent = [];
  const notifications = [];
  const customCalls = [];
  let resolveCustom;
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
      custom(factory, options) {
        customCalls.push({ factory, options });
        return new Promise((resolve) => { resolveCustom = resolve; });
      },
    },
  };
  const pi = {
    on(name, handler) { handlers.set(name, handler); },
    registerCommand(name, command) { commands.set(name, command); },
    sendUserMessage(text) { sent.push(text); },
  };
  registerFollowUp(pi, config, configPath, generator);
  return {
    ctx,
    commands,
    widgets,
    pasted,
    sent,
    notifications,
    customCalls,
    resolveCustom(value) { resolveCustom?.(value); },
    setBranch(value) { currentBranch = value; },
    async fire(name) { await handlers.get(name)?.({}, ctx); },
    async command(name) { await commands.get(name)?.handler("", ctx); },
    input(raw) { return terminalInput?.(raw); },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function latestWidgetText(harness) {
  const factory = harness.widgets.at(-1)?.content;
  if (!factory) return "";
  return factory({}, { fg: (_role, text) => text }).render(200).join("\n");
}

test("passes configured helper settings and only recent conversational context", async () => {
  const calls = [];
  const model = { provider: "test-provider", id: "test-model" };
  const ctx = {
    model: { provider: "active", id: "expensive" },
    modelRegistry: {
      find(provider, id) { calls.push({ kind: "find", provider, id }); return model; },
      async getApiKeyAndHeaders() { return { ok: true, apiKey: "test", headers: {} }; },
    },
  };
  const config = {
    ...DEFAULT_CONFIG,
    count: 4,
    prompt: "Custom prompt",
    provider: "test-provider",
    model: "test-model",
    thinking: "minimal",
  };
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
        content: [{ type: "toolCall", id: "next", name: "follow_up_suggestions", arguments: { suggestions: ["Add tests.", "Explain this.", "Ship it.", "Show the diff."] } }],
      };
    },
  );

  assert.deepEqual(result, ["Add tests.", "Explain this.", "Ship it.", "Show the diff."]);
  assert.deepEqual(calls[0], { kind: "find", provider: "test-provider", id: "test-model" });
  const request = calls[1];
  assert.equal(request.requestModel, model);
  assert.equal(request.requestContext.systemPrompt, "Custom prompt");
  assert.equal(request.options.reasoningEffort, "minimal");
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

test("reports the active persistent configuration", async () => {
  const h = createHarness({
    config: {
      ...DEFAULT_CONFIG,
      threshold: 42,
      recentMessages: 2,
      count: 4,
      provider: "test-provider",
      model: "test-model",
      thinking: "minimal",
    },
    configPath: "/tmp/custom-follow-up.json",
  });

  assert.deepEqual([...h.commands.keys()], ["follow-up"]);
  await h.command("follow-up");
  assert.deepEqual(h.notifications, [{
    text: "pi-follow-up: 42 chars, 2 messages, 4 suggestions, test-provider/test-model/minimal; config: /tmp/custom-follow-up.json",
    type: "info",
  }]);
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
  assert.match(latestWidgetText(h), /^Follow-up: "Add tests\." \+2 more · shift\+↑ open/m);
  assert.deepEqual(h.widgets.at(-1).options, { placement: "aboveEditor" });
  assert.equal(h.input("x"), undefined);
  assert.match(latestWidgetText(h), /^Follow-up: "Add tests\." \+2 more · shift\+↑ open/m);
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

test("releases a completed helper request with no suggestions", async () => {
  const signals = [];
  const h = createHarness({ generator: async (_ctx, _config, _context, signal) => {
    signals.push(signal);
    return signals.length === 1 ? undefined : ["one", "two", "three"];
  } });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();
  await h.fire("agent_settled");
  await flush();

  assert.equal(signals[0].aborted, false);
  assert.match(latestWidgetText(h), /^Follow-up: "one" \+2 more/);
});

test("shift+up stays inert while no suggestions exist", async () => {
  const h = createHarness({ generator: async () => undefined });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();

  assert.equal(h.input("\x1b[a"), undefined);
  assert.equal(h.customCalls.length, 0);
});

test("opens the overlay on shift+up and sends the selected suggestion", async () => {
  const h = createHarness({ generator: async () => ["one", "two", "three"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();

  assert.deepEqual(h.input("\x1b[a"), { consume: true });
  assert.equal(h.customCalls.length, 1);
  assert.deepEqual(h.customCalls[0].options, {
    overlay: true,
    overlayOptions: { anchor: "center", width: "90%", minWidth: 60, maxHeight: "85%" },
  });

  const results = [];
  const picker = h.customCalls[0].factory(null, pickerTheme(), pickerKeybindings(), (r) => results.push(r));
  picker.handleInput("\x1b[B");
  picker.handleInput("\r");
  assert.deepEqual(results, [{ action: "send", text: "two" }]);
  h.resolveCustom(results[0]);
  await flush();
  await flush();

  assert.deepEqual(h.sent, ["two"]);
  assert.equal(h.widgets.at(-1).content, undefined);
});

test("navigates with wrap, inserts with shift+enter, and keeps the widget after escape", async () => {
  const h = createHarness({ generator: async () => ["one", "two", "three"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();
  h.input("\x1b[a");

  const results = [];
  const picker = h.customCalls.at(-1).factory(null, pickerTheme(), pickerKeybindings(), (r) => results.push(r));
  picker.handleInput("\x1b[B");
  picker.handleInput("\x1b[B");
  picker.handleInput("\x1b[B");
  picker.handleInput("\x1b[A");
  picker.handleInput("\x1b[13;2u");
  assert.deepEqual(results, [{ action: "insert", text: "three" }]);
  h.resolveCustom(results[0]);
  await flush();
  await flush();

  assert.deepEqual(h.pasted, ["three"]);
  assert.deepEqual(h.sent, []);
  assert.match(latestWidgetText(h), /^Follow-up: "one" \+2 more/);

  h.input("\x1b[a");
  const closed = [];
  const picker2 = h.customCalls.at(-1).factory(null, pickerTheme(), pickerKeybindings(), (r) => closed.push(r));
  picker2.handleInput("\x1b");
  assert.deepEqual(closed, [null]);
  h.resolveCustom(null);
  await flush();
  await flush();

  assert.deepEqual(h.sent, []);
  assert.match(latestWidgetText(h), /^Follow-up: "one" \+2 more/);
});

test("wraps long suggestions with aligned continuation lines", async () => {
  const long = "alpha ".repeat(30).trimEnd();
  const h = createHarness({ generator: async () => [long, "short"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();
  h.input("\x1b[a");

  const picker = h.customCalls.at(-1).factory(null, pickerTheme(), pickerKeybindings(), () => {});
  const lines = picker.render(40);
  assert.equal(lines[0].trim(), "Follow-up");
  assert.ok(lines[3].startsWith("→ "));
  assert.ok(lines.slice(4, -2).some((line) => line.startsWith("  alpha")));
  assert.match(lines.at(-1), /1\/2/);
});

test("downgrades a stale overlay result instead of sending it", async () => {
  const h = createHarness({ generator: async () => ["one", "two", "three"] });
  await h.fire("session_start");
  await h.fire("agent_settled");
  await flush();
  h.input("\x1b[a");

  await h.fire("input");
  const results = [];
  const picker = h.customCalls.at(-1).factory(null, pickerTheme(), pickerKeybindings(), (r) => results.push(r));
  picker.handleInput("\r");
  assert.deepEqual(results, [null]);
  h.resolveCustom(null);
  await flush();
  await flush();

  assert.deepEqual(h.sent, []);
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
