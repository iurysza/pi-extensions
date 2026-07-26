import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CURSOR_REPLAY_CONSUME,
  CURSOR_REPLAY_HOST_READY,
  CURSOR_REPLAY_PRODUCER_REGISTER,
  CURSOR_REPLAY_TOOL_NAMES,
  createCursorReplayBroker,
} from "../../extensions/tool-presentation/cursor-replay-broker.js";
import { wrapSourceForCursorReplay } from "../../extensions/tool-presentation/index.js";
import type { SourceToolDefinition } from "../../extensions/tool-presentation/tidy/tool-composition.js";

function fakeEvents() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  return {
    emit(channel: string, data: unknown) {
      for (const handler of handlers.get(channel) ?? []) handler(data);
    },
    on(channel: string, handler: (data: unknown) => void) {
      const channelHandlers = handlers.get(channel) ?? new Set();
      channelHandlers.add(handler);
      handlers.set(channel, channelHandlers);
      return () => channelHandlers.delete(handler);
    },
  } as ExtensionAPI["events"];
}

function registerProducer(events: ExtensionAPI["events"], replayItems = new Map<string, any>()) {
  const sharedTools = new Set<string>();
  events.on(CURSOR_REPLAY_HOST_READY, (data) => {
    const ready = data as { protocolVersion?: unknown; toolNames?: unknown };
    if (ready.protocolVersion !== 1 || !Array.isArray(ready.toolNames)) return;
    sharedTools.clear();
    for (const toolName of ready.toolNames) if (typeof toolName === "string") sharedTools.add(toolName);
  });
  events.on(CURSOR_REPLAY_CONSUME, (data) => {
    const request = data as {
      protocolVersion?: unknown;
      toolCallId?: unknown;
      toolName?: unknown;
      accept?: (delivery: unknown) => void;
    };
    if (
      request.protocolVersion !== 1
      || typeof request.toolCallId !== "string"
      || typeof request.toolName !== "string"
      || typeof request.accept !== "function"
    ) return;
    const item = replayItems.get(request.toolCallId);
    if (!item) return;
    replayItems.delete(request.toolCallId);
    request.accept({
      protocolVersion: 1,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      ...item,
    });
  });
  const register = () => events.emit(CURSOR_REPLAY_PRODUCER_REGISTER, {
    protocolVersion: 1,
    producer: "@iurysza/pi-cursor-sdk",
  });
  return { register, sharedTools, replayItems };
}

function sourceTool(name: string, onExecute: () => unknown): SourceToolDefinition {
  return {
    name,
    parameters: { type: "object", properties: {} },
    execute: onExecute,
  };
}

describe("Cursor replay handshake", () => {
  it("does not advertise capabilities before tool ownership is active", () => {
    const events = fakeEvents();
    let readyEvents = 0;
    events.on(CURSOR_REPLAY_HOST_READY, () => { readyEvents += 1; });
    const broker = createCursorReplayBroker(events);
    broker.announceHost();
    assert.equal(readyEvents, 0);
    broker.activate();
    assert.equal(readyEvents, 1);
  });

  it("discovers a producer loaded before the host", () => {
    const events = fakeEvents();
    const producer = registerProducer(events);
    producer.register();
    const broker = createCursorReplayBroker(events);
    broker.activate();
    assert.deepEqual([...producer.sharedTools], [...CURSOR_REPLAY_TOOL_NAMES]);
  });

  it("discovers a producer loaded after the host", () => {
    const events = fakeEvents();
    const broker = createCursorReplayBroker(events);
    broker.activate();
    const producer = registerProducer(events);
    producer.register();
    assert.equal(broker.isProducerRegistered(), true);
    assert.deepEqual([...producer.sharedTools], [...CURSOR_REPLAY_TOOL_NAMES]);
  });
});

describe("Cursor replay execution", () => {
  it("consumes a recorded result exactly once without native execution", async () => {
    const events = fakeEvents();
    const broker = createCursorReplayBroker(events);
    const producer = registerProducer(events, new Map([
      ["cursor-replay-read-1", {
        isError: false,
        result: { content: [{ type: "text", text: "recorded" }], details: { source: "Cursor" } },
      }],
    ]));
    producer.register();
    let executions = 0;
    const wrapped = wrapSourceForCursorReplay(sourceTool("read", () => {
      executions += 1;
      return { content: [{ type: "text", text: "native" }] };
    }), (id, name) => broker.consume(id, name));

    assert.deepEqual(await wrapped.execute("cursor-replay-read-1", {}, undefined, undefined, undefined), {
      content: [{ type: "text", text: "recorded" }],
      details: { source: "Cursor" },
      terminate: true,
    });
    assert.equal(executions, 0);
    assert.throws(
      () => wrapped.execute("cursor-replay-read-1", {}, undefined, undefined, undefined),
      /No recorded Cursor read result/,
    );
    assert.equal(executions, 0);
  });

  it("fails closed for missing replay state on every built-in", () => {
    const events = fakeEvents();
    const broker = createCursorReplayBroker(events);
    let executions = 0;
    for (const name of CURSOR_REPLAY_TOOL_NAMES) {
      const wrapped = wrapSourceForCursorReplay(sourceTool(name, () => {
        executions += 1;
      }), (id, toolName) => broker.consume(id, toolName));
      assert.throws(
        () => wrapped.execute(`cursor-replay-${name}-missing`, {}, undefined, undefined, undefined),
        new RegExp(`No recorded Cursor ${name} result`),
      );
    }
    assert.equal(executions, 0);
  });

  it("delegates ordinary Pi calls and rethrows recorded Cursor errors", async () => {
    const events = fakeEvents();
    const broker = createCursorReplayBroker(events);
    const producer = registerProducer(events, new Map([
      ["cursor-replay-bash-error", {
        isError: true,
        result: { content: [{ type: "text", text: "recorded command failed" }] },
      }],
    ]));
    producer.register();
    let executions = 0;
    const wrapped = wrapSourceForCursorReplay(sourceTool("bash", () => {
      executions += 1;
      return { content: [] };
    }), (id, name) => broker.consume(id, name));

    await wrapped.execute("ordinary-bash", {}, undefined, undefined, undefined);
    assert.equal(executions, 1);
    assert.throws(
      () => wrapped.execute("cursor-replay-bash-error", {}, undefined, undefined, undefined),
      /recorded command failed/,
    );
    assert.equal(executions, 1);
  });
});
