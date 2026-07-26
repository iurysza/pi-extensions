import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PRODUCTION_DIRS = ["src", "scripts", "shared"] as const;
const SOURCE_FILE_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const IGNORED_FILES = new Set(["src/cursor-fallback-models.generated.ts"]);

const FORBIDDEN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
	{ label: "double assertion through unknown", pattern: /\bas\s+unknown\s+as\b/ },
	{ label: "any assertion", pattern: /\bas\s+any\b/ },
	{ label: "never assertion", pattern: /\bas\s+never\b/ },
	{ label: "explicit any annotation", pattern: /:\s*any\b/ },
	{ label: "Record<string, any>", pattern: /\bRecord\s*<\s*string\s*,\s*any\s*>/ },
	{ label: "ts-ignore", pattern: /@ts-ignore\b/ },
	{ label: "production ts-expect-error", pattern: /@ts-expect-error\b/ },
];

function extension(path: string): string {
	const index = path.lastIndexOf(".");
	return index === -1 ? "" : path.slice(index);
}

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (path.includes("node_modules") || path.includes("dist")) continue;
		const stats = statSync(path);
		if (stats.isDirectory()) {
			files.push(...listSourceFiles(path));
		} else if (SOURCE_FILE_EXTENSIONS.has(extension(path)) && !path.match(/\.d\.[cm]?ts$/) && !IGNORED_FILES.has(path)) {
			files.push(path);
		}
	}
	return files;
}

describe("production typing safety", () => {
	it("does not use broad unsafe TypeScript escape hatches in production code", () => {
		const violations: string[] = [];
		for (const file of PRODUCTION_DIRS.flatMap((dir) => listSourceFiles(dir))) {
			const lines = readFileSync(file, "utf8").split(/\r?\n/);
			for (const [index, line] of lines.entries()) {
				for (const { label, pattern } of FORBIDDEN_PATTERNS) {
					if (pattern.test(line)) violations.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
