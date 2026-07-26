import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCursorSharedReplayProducer } from "../src/cursor-shared-replay-producer.js";
import {
  __testUtils,
  canRenderCursorToolNatively,
  recordCursorNativeToolDisplay,
} from "../src/cursor-native-tool-display-state.js";

function fakeEvents() {
  const handlers = new Map<string, Set<(data: unknown) => void>>();
  const emitted: Array<{ channel: string; data: unknown }> = [];
  return {
    emitted,
    events: {
      emit(channel: string, data: unknown) {
        emitted.push({ channel, data });
        for (const handler of handlers.get(channel) ?? []) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void) {
        const channelHandlers = handlers.get(channel) ?? new Set();
        channelHandlers.add(handler);
        handlers.set(channel, channelHandlers);
        return () => channelHandlers.delete(handler);
      },
    } as ExtensionAPI["events"],
  };
}

afterEach(() => __testUtils.reset());

describe("Cursor shared replay producer", () => {
  it("registers repeatedly and accepts only advertised built-in capabilities", () => {
    const harness = fakeEvents();
    const producer = createCursorSharedReplayProducer(harness.events);
    expect(harness.emitted.filter(({ channel }) => channel.endsWith("/register/v1"))).toHaveLength(1);

    harness.events.emit("@iurysza/pi-ext/cursor-replay/ready/v1", {
      protocolVersion: 1,
      toolNames: ["read", "edit", "cursor", "future"],
    });
    expect(canRenderCursorToolNatively("read")).toBe(true);
    expect(canRenderCursorToolNatively("edit")).toBe(true);
    expect(canRenderCursorToolNatively("cursor")).toBe(false);
    producer.register();
    expect(harness.emitted.filter(({ channel }) => channel.endsWith("/register/v1"))).toHaveLength(2);
  });

  it("delivers a recorded result once and preserves recorded errors", () => {
    const harness = fakeEvents();
    createCursorSharedReplayProducer(harness.events);
    harness.events.emit("@iurysza/pi-ext/cursor-replay/ready/v1", {
      protocolVersion: 1,
      toolNames: ["read", "bash"],
    });
    expect(recordCursorNativeToolDisplay({
      id: "cursor-replay-read-1",
      toolName: "read",
      args: { path: "README.md" },
      result: { content: [{ type: "text", text: "recorded" }], details: { lines: 1 } },
      isError: false,
      terminate: true,
    })).toBe(true);

    const accept = vi.fn();
    const consume = () => harness.events.emit("@iurysza/pi-ext/cursor-replay/consume/v1", {
      protocolVersion: 1,
      toolCallId: "cursor-replay-read-1",
      toolName: "read",
      accept,
    });
    consume();
    expect(accept).toHaveBeenCalledWith({
      protocolVersion: 1,
      toolCallId: "cursor-replay-read-1",
      toolName: "read",
      isError: false,
      result: {
        content: [{ type: "text", text: "recorded" }],
        details: { lines: 1 },
        terminate: true,
      },
    });
    consume();
    expect(accept).toHaveBeenCalledTimes(1);
    expect(__testUtils.nativeToolResultCount()).toBe(0);
  });

  it("consumes mismatched state as an error instead of returning another tool's result", () => {
    const harness = fakeEvents();
    createCursorSharedReplayProducer(harness.events);
    __testUtils.registerNativeToolNameForTests("edit");
    recordCursorNativeToolDisplay({
      id: "cursor-replay-shared-id",
      toolName: "edit",
      args: {},
      result: { content: [{ type: "text", text: "wrong" }] },
      isError: false,
    });
    const accept = vi.fn();
    harness.events.emit("@iurysza/pi-ext/cursor-replay/consume/v1", {
      protocolVersion: 1,
      toolCallId: "cursor-replay-shared-id",
      toolName: "read",
      accept,
    });
    expect(accept.mock.calls[0]?.[0]).toMatchObject({
      isError: true,
      result: { content: [{ type: "text", text: expect.stringContaining("contained edit") }] },
    });
    expect(__testUtils.nativeToolResultCount()).toBe(0);
  });
});
