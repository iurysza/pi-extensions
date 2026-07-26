/**
 * Assertion engine — assertions.json, failures.md, JSONL parsing.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

/** Run a set of checks and write assertions.json. */
export function runAssertions(dir, checks) {
	const results = [];
	let allOk = true;
	for (const check of checks) {
		try {
			const ok = check.fn();
			results.push({ id: check.id, ok, ...(ok ? {} : { error: check.error }) });
			if (!ok) allOk = false;
		} catch (e) {
			results.push({ id: check.id, ok: false, error: e.message });
			allOk = false;
		}
	}

	const assertions = {
		ok: allOk,
		checks: results,
		writtenAt: new Date().toISOString(),
	};

	writeFileSync(resolve(dir, "assertions.json"), JSON.stringify(assertions, null, 2));

	if (!allOk) {
		const failures = results.filter(r => !r.ok);
		const md = [
			"# Assertion Failures",
			"",
			...failures.map(f => `- **${f.id}**: ${f.error ?? "failed"}`),
			"",
			`Total: ${failures.length} failure(s)`,
		];
		writeFileSync(resolve(dir, "failures.md"), md.join("\n") + "\n");
	}

	return assertions;
}

/** Parse a JSONL file into an array of objects. */
export function parseJSONL(path) {
	if (!existsSync(path)) return [];
	try {
		const text = readFileSync(path, "utf-8");
		return text.split("\n").filter(Boolean).map(line => {
			try { return JSON.parse(line); } catch { return null; }
		}).filter(Boolean);
	} catch {
		return [];
	}
}

/** Find a session JSONL file in a session directory. */
export function findSessionJSONL(sessionDir) {
	if (!existsSync(sessionDir)) return null;
	for (const entry of readdirSync(sessionDir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			const found = findSessionJSONL(resolve(sessionDir, entry.name));
			if (found) return found;
		}
		if (entry.name.endsWith(".jsonl") && !entry.name.includes("events")) {
			return resolve(sessionDir, entry.name);
		}
	}
	return null;
}

/** Simple check: does text contain a required substring? */
export function assertContains(text, substring, id) {
	return { id, fn: () => text.includes(substring) };
}

/** Simple check: does a file exist? */
export function assertFileExists(path, id) {
	return { id, fn: () => existsSync(path) };
}

/** Check JSONL for required tool calls. */
export function assertJSONLToolCalls(jsonlPath, expectedTools) {
	return {
		id: "jsonl-tool-calls",
		fn: () => {
			const events = parseJSONL(jsonlPath);
			const toolCalls = events.filter(e => e.type === "tool_use" || e.toolCall);
			for (const expected of expectedTools) {
				const found = toolCalls.some(tc => {
					const name = tc.toolCall?.name ?? tc.name ?? tc.tool_name ?? "";
					return name === expected.name;
				});
				if (!found) return false;
			}
			return true;
		},
	};
}
