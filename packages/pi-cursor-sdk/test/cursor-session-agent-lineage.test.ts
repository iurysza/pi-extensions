import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE,
	parseCursorSessionAgentLineageEntryData,
	recordCursorSessionAgentLineage,
	registerCursorSessionAgentLineage,
	__testUtils as lineageTestUtils,
	type CursorSessionAgentLineageEntryData,
} from "../src/cursor-session-agent-lineage.js";
import { registerCursorSessionScope, __testUtils as scopeTestUtils } from "../src/cursor-session-scope.js";
import { createPiHarness } from "./helpers/pi-harness.js";

function lineageEntry(id: string, data: unknown, parentId: string | null = null): SessionEntry {
	return {
		type: "custom",
		id,
		parentId,
		timestamp: "2026-07-23T00:00:00.000Z",
		customType: CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE,
		data,
	};
}

function validData(overrides: Partial<CursorSessionAgentLineageEntryData> = {}): CursorSessionAgentLineageEntryData {
	return {
		version: 1,
		runtime: "local",
		agentId: "agent-1",
		sessionId: "session-1",
		sessionFile: "/tmp/session.jsonl",
		scopeKey: "/tmp/session.jsonl",
		cwd: "/tmp/project",
		timestamp: "2026-07-23T00:00:00.000Z",
		...overrides,
	};
}

describe("cursor-session-agent-lineage", () => {
	beforeEach(() => {
		scopeTestUtils.reset();
		lineageTestUtils.reset();
		vi.clearAllMocks();
	});

	it("ignores malformed lineage entries conservatively", () => {
		expect(parseCursorSessionAgentLineageEntryData(validData())).toEqual(validData());
		for (const malformed of [
			undefined,
			{ ...validData(), version: 2 },
			{ ...validData(), runtime: "cloud" },
			{ ...validData(), agentId: "bc-cloud" },
			{ ...validData(), sessionId: "" },
			{ ...validData(), sessionFile: 42 },
			{ ...validData(), scopeKey: "" },
			{ ...validData(), cwd: "" },
			{ ...validData(), timestamp: "not-a-date" },
		]) {
			expect(parseCursorSessionAgentLineageEntryData(malformed)).toBeUndefined();
		}
	});

	it("appends at the send boundary and deduplicates within one native pi session", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentLineage(pi);
		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionId: vi.fn(() => "session-1"),
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getEntries: vi.fn(() => []),
			},
		});

		recordCursorSessionAgentLineage("agent-1");
		recordCursorSessionAgentLineage("agent-1");

		expect(pi.appendEntry).toHaveBeenCalledTimes(1);
		expect(pi.appendEntry).toHaveBeenCalledWith(CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE, {
			version: 1,
			runtime: "local",
			agentId: "agent-1",
			sessionId: "session-1",
			sessionFile: "/tmp/session.jsonl",
			scopeKey: "/tmp/session.jsonl",
			cwd: "/tmp/project",
			timestamp: expect.any(String),
		});
	});

	it("does not let donor session lineage suppress a clone session's own agents", async () => {
		const donor = lineageEntry("lineage-donor", validData({ sessionId: "donor-session" }));
		const own = lineageEntry("lineage-own", validData({ agentId: "agent-own", sessionId: "clone-session" }), "lineage-donor");
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentLineage(pi);
		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionId: vi.fn(() => "clone-session"),
				getSessionFile: vi.fn(() => "/tmp/clone.jsonl"),
				getEntries: vi.fn(() => [donor, own]),
			},
		});

		recordCursorSessionAgentLineage("agent-own");
		recordCursorSessionAgentLineage("agent-1");

		expect(pi.appendEntry).toHaveBeenCalledTimes(1);
		expect(pi.appendEntry).toHaveBeenCalledWith(
			CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE,
			expect.objectContaining({ agentId: "agent-1", sessionId: "clone-session" }),
		);
	});

	it("reopens the same session ID with persisted lineage and only records new agents", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentLineage(pi);
		const entries: SessionEntry[] = [];
		pi.appendEntry.mockImplementation((customType: string, data: unknown) => {
			entries.push(lineageEntry(`lineage-${entries.length + 1}`, data));
		});
		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionId: vi.fn(() => "session-1"),
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getEntries: vi.fn(() => [...entries]),
			},
		});
		recordCursorSessionAgentLineage("agent-1");
		expect(entries).toHaveLength(1);

		await pi.runSessionShutdown();
		// Simulate process restart: same session file/entries, fresh in-memory registration.
		lineageTestUtils.reset();
		const pi2 = createPiHarness();
		registerCursorSessionScope(pi2);
		registerCursorSessionAgentLineage(pi2);
		await pi2.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionId: vi.fn(() => "session-1"),
				getSessionFile: vi.fn(() => "/tmp/session.jsonl"),
				getEntries: vi.fn(() => [...entries]),
			},
		});
		recordCursorSessionAgentLineage("agent-1");
		recordCursorSessionAgentLineage("agent-2");
		expect(pi2.appendEntry).toHaveBeenCalledTimes(1);
		expect(pi2.appendEntry).toHaveBeenCalledWith(
			CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE,
			expect.objectContaining({ agentId: "agent-2", sessionId: "session-1" }),
		);
	});

	it("drops append failures without throwing", async () => {
		const pi = createPiHarness();
		registerCursorSessionScope(pi);
		registerCursorSessionAgentLineage(pi);
		await pi.runSessionStart({
			cwd: "/tmp/project",
			sessionManager: {
				getSessionId: vi.fn(() => "session-1"),
				getSessionFile: vi.fn(() => undefined),
				getEntries: vi.fn(() => []),
			},
		});
		pi.appendEntry.mockImplementationOnce(() => {
			throw new Error("append failed");
		});
		expect(() => recordCursorSessionAgentLineage("agent-1")).not.toThrow();
		recordCursorSessionAgentLineage("agent-2");
		expect(pi.appendEntry).toHaveBeenCalledTimes(2);
	});
});
