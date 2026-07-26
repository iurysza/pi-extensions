import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  FOOTER_SLOT_HOST_READY,
  FOOTER_SLOT_REGISTER,
  createFooterSlotRegistry,
  packFooterStatuses,
} from "../../extensions/custom-footer/footer-slots.js";

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

describe("footer slot registry", () => {
  it("accepts producers loaded before or after the host", () => {
    const events = fakeEvents();
    events.on(FOOTER_SLOT_HOST_READY, () => {
      events.emit(FOOTER_SLOT_REGISTER, {
        protocolVersion: 1,
        id: "early",
        priority: 200,
      });
    });

    const registry = createFooterSlotRegistry(events);
    registry.announceHost();
    assert.equal(registry.priorities.get("early"), 200);

    events.emit(FOOTER_SLOT_REGISTER, {
      protocolVersion: 1,
      id: "late",
      priority: 100,
    });
    assert.equal(registry.priorities.get("late"), 100);
  });

  it("ignores malformed registrations and clears session metadata", () => {
    const events = fakeEvents();
    const registry = createFooterSlotRegistry(events);
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 2, id: "wrong", priority: 999 });
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 1, id: "", priority: 999 });
    events.emit(FOOTER_SLOT_REGISTER, { protocolVersion: 1, id: "nan", priority: Number.NaN });
    assert.equal(registry.priorities.size, 0);
    registry.priorities.set("temporary", 1);
    registry.clear();
    assert.equal(registry.priorities.size, 0);
  });
});

describe("packFooterStatuses", () => {
  it("packs whole slots by descending priority", () => {
    const statuses = new Map([
      ["legacy", "legacy"],
      ["token", "tokens"],
      ["cache", "cache"],
    ]);
    const priorities = new Map([["cache", 200], ["token", 100]]);
    assert.equal(packFooterStatuses(statuses, priorities, 20, " · "), " cache · tokens");
  });

  it("omits all lower priorities once the next slot does not fit", () => {
    const statuses = new Map([
      ["high", "high"],
      ["middle", "middle-is-wide"],
      ["low", "x"],
    ]);
    const priorities = new Map([["high", 200], ["middle", 100], ["low", 0]]);
    assert.equal(packFooterStatuses(statuses, priorities, 12, " · "), " high");
  });

  it("truncates only the highest-priority slot and respects ANSI width", () => {
    const statuses = new Map([
      ["high", "\u001b[31mhighest-priority-value\u001b[39m"],
      ["low", "low"],
    ]);
    const priorities = new Map([["high", 200], ["low", 100]]);
    const packed = packFooterStatuses(statuses, priorities, 9, " · ");
    assert.ok(packed);
    assert.equal(visibleWidth(packed), 9);
    assert.ok(!packed.includes("low"));
  });

  it("sanitizes multiline legacy statuses", () => {
    const packed = packFooterStatuses(new Map([["legacy", "one\ntwo\tthree"]]), new Map(), 40, " · ");
    assert.equal(packed, " one two three");
  });
});
