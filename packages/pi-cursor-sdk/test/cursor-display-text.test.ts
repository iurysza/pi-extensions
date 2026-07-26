import { describe, expect, it } from "vitest";
import { sanitizeCursorDisplayLine, truncateCursorDisplayLine } from "../src/cursor-display-text.js";

describe("cursor display text", () => {
	it("removes C0, C1, and Unicode line-separator controls", () => {
		expect(sanitizeCursorDisplayLine("a\0b\u001bc\u007fd\u0085e\u2028f\u2029g\n\th")).toBe("a b c d e f g h");
	});

	it("bounds text after sanitizing controls", () => {
		const text = truncateCursorDisplayLine(`start\u0085${"x".repeat(100)}`, 20);
		expect(text).toHaveLength(20);
		expect(text).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u);
		expect(text.endsWith("…")).toBe(true);
	});

	it("keeps emoji boundaries intact and handles tiny maximum lengths", () => {
		expect(truncateCursorDisplayLine("ab😀cd", 4)).toBe("ab…");
		expect(truncateCursorDisplayLine("😀x", 2)).toBe("…");
		expect(truncateCursorDisplayLine("abc", 1)).toBe("…");
		expect(truncateCursorDisplayLine("abc", 0)).toBe("");
	});

	it("replaces lone surrogates before returning sanitized or truncated text", () => {
		expect(sanitizeCursorDisplayLine("a\uD800b\uDC00c😀")).toBe("a�b�c😀");
		expect(truncateCursorDisplayLine("a\uD800bc", 3)).toBe("a�…");
	});
});
