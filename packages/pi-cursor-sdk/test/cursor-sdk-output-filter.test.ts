import { describe, expect, it } from "vitest";
import { CURSOR_SDK_STARTUP_NOISE_PATTERNS, installCursorSdkOutputFilter, isCursorSdkStartupNoise } from "../src/cursor-sdk-output-filter.js";
import { installCursorSdkOutputFilter as installScriptCursorSdkOutputFilter } from "../scripts/lib/cursor-sdk-output-filter.mjs";

describe("isCursorSdkStartupNoise", () => {
	it.each(CURSOR_SDK_STARTUP_NOISE_PATTERNS)("filters startup noise containing %j", (pattern) => {
		expect(isCursorSdkStartupNoise(`prefix ${pattern} suffix`)).toBe(true);
	});

	it("filters [hooks] noise like provider integration tests", () => {
		expect(
			isCursorSdkStartupNoise(
				'[hooks] SessionStart trigger matcher "startup" is not supported in Cursor, hooks will fire for all triggers',
			),
		).toBe(true);
	});

	it("filters ignore-mapping initialization errors", () => {
		expect(
			isCursorSdkStartupNoise("Error initializing ignore mapping for /Users/dev/project: permission denied"),
		).toBe(true);
	});

	it("filters ripgrep path configuration warnings", () => {
		expect(
			isCursorSdkStartupNoise("Ripgrep path not configured. Call configureRipgrepPath() at startup."),
		).toBe(true);
	});

	it("does not filter unrelated provider output", () => {
		expect(isCursorSdkStartupNoise("VISIBLE non-startup stdout")).toBe(false);
		expect(isCursorSdkStartupNoise("Agent finished successfully")).toBe(false);
	});

	it("keeps the global filter installed until all overlapping installs are restored", () => {
		const originalStdoutWrite = process.stdout.write;
		const originalStderrWrite = process.stderr.write;
		const originalConsoleLog = console.log;
		const restoreFirst = installCursorSdkOutputFilter();
		const filteredStdoutWrite = process.stdout.write;
		const filteredStderrWrite = process.stderr.write;
		const filteredConsoleLog = console.log;
		const restoreSecond = installCursorSdkOutputFilter();
		try {
			expect(process.stdout.write).toBe(filteredStdoutWrite);
			expect(process.stderr.write).toBe(filteredStderrWrite);
			expect(console.log).toBe(filteredConsoleLog);

			restoreFirst();
			expect(process.stdout.write).toBe(filteredStdoutWrite);
			expect(process.stderr.write).toBe(filteredStderrWrite);
			expect(console.log).toBe(filteredConsoleLog);

			restoreSecond();
			expect(process.stdout.write).toBe(originalStdoutWrite);
			expect(process.stderr.write).toBe(originalStderrWrite);
			expect(console.log).toBe(originalConsoleLog);
		} finally {
			restoreFirst();
			restoreSecond();
			process.stdout.write = originalStdoutWrite;
			process.stderr.write = originalStderrWrite;
			console.log = originalConsoleLog;
		}
	});

	it("shares install state across provider and maintainer script wrappers", () => {
		const originalStdoutWrite = process.stdout.write;
		const originalStderrWrite = process.stderr.write;
		const restoreProvider = installCursorSdkOutputFilter();
		const filteredStdoutWrite = process.stdout.write;
		const filteredStderrWrite = process.stderr.write;
		const restoreScript = installScriptCursorSdkOutputFilter();
		try {
			expect(process.stdout.write).toBe(filteredStdoutWrite);
			expect(process.stderr.write).toBe(filteredStderrWrite);

			restoreProvider();
			expect(process.stdout.write).toBe(filteredStdoutWrite);
			expect(process.stderr.write).toBe(filteredStderrWrite);

			restoreScript();
			expect(process.stdout.write).toBe(originalStdoutWrite);
			expect(process.stderr.write).toBe(originalStderrWrite);
		} finally {
			restoreProvider();
			restoreScript();
			process.stdout.write = originalStdoutWrite;
			process.stderr.write = originalStderrWrite;
		}
	});
});
