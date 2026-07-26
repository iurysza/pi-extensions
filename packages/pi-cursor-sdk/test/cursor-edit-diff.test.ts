import { describe, expect, it } from "vitest";
import { resolveCursorEditDiff } from "../src/cursor-edit-diff.js";

describe("resolveCursorEditDiff", () => {
	it("prefers diffString over diff, unifiedDiff, and patch", () => {
		expect(resolveCursorEditDiff({
			diffString: "diff-string",
			diff: "diff",
			unifiedDiff: "unified",
			patch: "patch",
		})).toBe("diff-string");
	});

	it("falls back through diff, unifiedDiff, and patch", () => {
		expect(resolveCursorEditDiff({ diff: "diff-only" })).toBe("diff-only");
		expect(resolveCursorEditDiff({ unifiedDiff: "unified-only" })).toBe("unified-only");
		expect(resolveCursorEditDiff({ patch: "patch-only" })).toBe("patch-only");
	});

	it("skips empty strings and returns undefined when no diff is present", () => {
		expect(resolveCursorEditDiff({ diffString: "" })).toBeUndefined();
		expect(resolveCursorEditDiff(undefined)).toBeUndefined();
	});
});
