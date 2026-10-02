import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pinCacheBreakpoint } from "../src/claude-code-cache-breakpoint.js";

const recorded = readFileSync(resolve(import.meta.dirname, "fixtures/cli-2.1.282-request.json"));

function markers(body: any) {
	return body.messages.flatMap((message: any, index: number) =>
		Array.isArray(message.content)
			? message.content.flatMap((block: any, blockIndex: number) => (block.cache_control ? [[index, message.role, blockIndex]] : []))
			: [],
	);
}

describe("pinCacheBreakpoint", () => {
	it("moves Claude Code 2.1.282's marker from the date reminder onto the Query Frame", () => {
		const before = JSON.parse(recorded.toString());
		expect(markers(before)).toEqual([[4, "system", 0]]);
		const after = JSON.parse(pinCacheBreakpoint(recorded).toString());
		expect(markers(after)).toEqual([[3, "user", 0]]);
		expect(after.messages[3].content[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
		expect(after.system).toEqual(before.system);
		const strip = (body: any) => JSON.stringify(body, (key, value) => (key === "cache_control" ? undefined : value));
		expect(strip(after)).toBe(strip(before));
	});

	it("converts string content on the target", () => {
		const body = {
			messages: [
				{ role: "user", content: "hi" },
				{ role: "system", content: [{ type: "text", text: "date", cache_control: { type: "ephemeral" } }] },
			],
		};
		const after = JSON.parse(pinCacheBreakpoint(Buffer.from(JSON.stringify(body))).toString());
		expect(after.messages[0].content).toEqual([{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }]);
		expect(after.messages[1].content[0].cache_control).toBeUndefined();
	});

	it("returns the original bytes when there is nothing to move", () => {
		const invalid = Buffer.from("{not json");
		expect(pinCacheBreakpoint(invalid)).toBe(invalid);
		const unmarked = Buffer.from(JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] }));
		expect(pinCacheBreakpoint(unmarked)).toBe(unmarked);
		const pinned = Buffer.from(JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "hi", cache_control: { type: "ephemeral" } }] }] }));
		expect(pinCacheBreakpoint(pinned)).toBe(pinned);
	});
});
