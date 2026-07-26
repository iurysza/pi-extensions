#!/usr/bin/env node
/**
 * Validate assistant presence and usage fields in pi session JSONL files under a smoke directory.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPLAY_TOOL_NOT_FOUND = [
	"Tool grep not found",
	"Tool cursor not found",
	"Tool find not found",
	"Tool ls not found",
];

function printHelp() {
	console.log(`Validate assistant presence and usage metadata in pi smoke session JSONL files.

Usage:
  node scripts/validate-smoke-jsonl.mjs <smoke-dir>
  SMOKE_DIR=/tmp/pi-cursor-smoke node scripts/validate-smoke-jsonl.mjs

Arguments:
  smoke-dir                     Directory containing smoke session subdirs and JSONL files.
                                Defaults to SMOKE_DIR when the positional arg is omitted.

Options:
  -h, --help                    Show this help.
  --replay-errors               Also fail when JSONL contains native replay "Tool * not found" errors.
  --replay-errors-only          Scan only for native replay "Tool * not found" errors (skip usage checks).

Exit codes:
  0  every enforced invariant passed for the selected mode(s)
  1  invalid arguments, unreadable directory, invalid JSONL, empty/no-assistant files, usage validation failures, or replay tool errors
  2  no JSONL files found under the smoke directory

Enforced invariants (default mode):
  - each scanned JSONL file contains parseable JSONL records
  - each scanned JSONL file contains at least one persisted assistant message
  - every persisted assistant message has usage metadata
  - assistant usage input/output/totalTokens/cacheRead/cacheWrite are non-negative numbers

Replay error scan (--replay-errors / --replay-errors-only):
  - no persisted error toolResult or error assistant message contains "Tool grep/cursor/find/ls not found"
  - successful tool/file reads that mention those strings in docs are ignored

Notes:
  - Prints one JSON summary line per scanned session file (usage mode) or one replay summary line (replay-only mode).
  - Does not print session message contents or secrets.`);
}

function fail(message) {
	console.error(`validate-smoke-jsonl: ${message}`);
	process.exit(1);
}

function collectJsonlFiles(root) {
	const files = [];
	function walk(dir) {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			const st = statSync(path);
			if (st.isDirectory()) walk(path);
			else if (path.endsWith(".jsonl")) files.push(path);
		}
	}
	walk(root);
	return files.sort();
}

function isNonNegativeNumber(value) {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isBadUsage(usage) {
	return (
		!usage ||
		typeof usage !== "object" ||
		!isNonNegativeNumber(usage.input) ||
		!isNonNegativeNumber(usage.output) ||
		!isNonNegativeNumber(usage.totalTokens) ||
		!isNonNegativeNumber(usage.cacheRead) ||
		!isNonNegativeNumber(usage.cacheWrite)
	);
}

function parseJsonlFile(file) {
	const lines = readFileSync(file, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const records = [];
	let parseErrorCount = 0;
	for (const line of lines) {
		try {
			records.push(JSON.parse(line));
		} catch {
			parseErrorCount += 1;
		}
	}
	return { lineCount: lines.length, records, parseErrorCount };
}

function getMessageText(message) {
	if (!message || typeof message !== "object") return "";
	const parts = [];
	if (typeof message.errorMessage === "string") parts.push(message.errorMessage);
	if (Array.isArray(message.content)) {
		for (const block of message.content) {
			if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
		}
	}
	return parts.join("\n");
}

function isReplayErrorMessage(message, needle) {
	const text = getMessageText(message);
	if (!text.includes(needle)) return false;
	if (message.role === "toolResult" && message.isError === true) return true;
	if (message.role === "assistant" && (message.stopReason === "error" || typeof message.errorMessage === "string")) {
		return true;
	}
	return false;
}

function scanReplayErrors(file, records) {
	const hits = [];
	for (const [index, record] of records.entries()) {
		const message = record?.type === "message" ? record.message : undefined;
		if (!message) continue;
		for (const needle of REPLAY_TOOL_NOT_FOUND) {
			if (isReplayErrorMessage(message, needle)) {
				hits.push({ line: index + 1, needle });
			}
		}
	}
	return hits;
}

function main() {
	const args = process.argv.slice(2);
	if (args.includes("-h") || args.includes("--help")) {
		printHelp();
		return;
	}

	const replayErrorsOnly = args.includes("--replay-errors-only");
	const replayErrors = replayErrorsOnly || args.includes("--replay-errors");
	const positional = args.filter((arg) => !arg.startsWith("-"));

	if (positional.length > 1) {
		fail("too many arguments; pass only the smoke directory");
	}

	const smokeDir = positional[0] ?? process.env.SMOKE_DIR;
	if (!smokeDir) {
		fail("missing smoke directory; pass a path or set SMOKE_DIR");
	}

	let files;
	try {
		files = collectJsonlFiles(smokeDir);
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	}

	if (files.length === 0) {
		console.error(`validate-smoke-jsonl: no JSONL files under ${smokeDir}`);
		process.exit(2);
	}

	let failures = 0;
	if (replayErrorsOnly) {
		let replayHitCount = 0;
		for (const file of files) {
			const { records } = parseJsonlFile(file);
			const hits = scanReplayErrors(file, records);
			replayHitCount += hits.length;
			if (hits.length > 0) failures += 1;
			console.log(
				JSON.stringify({
					file: relative(smokeDir, file),
					replayErrorCount: hits.length,
					replayErrors: hits.slice(0, 5),
				}),
			);
		}
		process.exit(failures === 0 ? 0 : 1);
	}

	for (const file of files) {
		let summary;
		try {
			const { lineCount, records, parseErrorCount } = parseJsonlFile(file);
			const messages = records.filter((record) => record.type === "message").map((record) => record.message);
			const assistants = messages.filter((message) => message?.role === "assistant");
			const usage = assistants.map((message) => message.usage).filter(Boolean);
			const badUsage = assistants.map((message) => message.usage).filter(isBadUsage);
			const replayHits = replayErrors ? scanReplayErrors(file, records) : [];
			const fileFailure =
				lineCount === 0 ||
				parseErrorCount > 0 ||
				assistants.length === 0 ||
				usage.length !== assistants.length ||
				badUsage.length > 0 ||
				replayHits.length > 0;
			if (fileFailure) failures += 1;
			summary = {
				file: relative(smokeDir, file),
				lineCount,
				parseErrorCount,
				messageCount: messages.length,
				assistantCount: assistants.length,
				usageCount: usage.length,
				badUsageCount: badUsage.length,
				replayErrorCount: replayHits.length,
			};
		} catch (error) {
			failures += 1;
			summary = {
				file: relative(smokeDir, file),
				readError: error instanceof Error ? error.message : String(error),
			};
		}
		console.log(JSON.stringify(summary));
	}

	process.exit(failures === 0 ? 0 : 1);
}

main();
