import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { PREVIEW_MAX_BYTES, STDERR_MAX_BYTES } from "../../extensions/file-search/src/limits.ts";
import { runSearch } from "../../extensions/file-search/src/process.ts";

function nodeSearch(tool, source, options = {}) {
	return runSearch({ tool, command: process.execPath, args: ["-e", source], cwd: process.cwd(), ...options });
}

async function spillDirectories(tool) {
	return (await readdir(tmpdir())).filter((entry) => entry.startsWith(`pi-${tool}-search-`)).sort();
}

describe("bounded search process execution", () => {
	it("streams normal output and removes its spill directory", async () => {
		const before = await spillDirectories("fd");
		const result = await nodeSearch("fd", "process.stdout.write('one\\n'); setTimeout(() => process.stdout.write('two\\n'), 10)");
		assert.equal(result.kind, "matches");
		assert.equal(result.text, "one\ntwo\n");
		assert.equal(result.outputPath, undefined);
		assert.deepEqual(await spillDirectories("fd"), before);
	});

	it("retains complete spill output only when the returned head is truncated", async () => {
		const size = PREVIEW_MAX_BYTES + 12_345;
		const result = await nodeSearch("fd", `process.stdout.write(Buffer.alloc(${size}, 120))`);
		assert.equal(result.truncated, true);
		assert.ok(Buffer.byteLength(result.preview) <= PREVIEW_MAX_BYTES);
		assert.match(result.text, /Output truncated at 2,000 lines\/50,000 bytes/);
		assert.equal((await readFile(result.outputPath)).length, size);
		await rm(result.outputPath.slice(0, result.outputPath.lastIndexOf("/")), { recursive: true, force: true });
	});

	it("classifies ripgrep exit 1 without output as a normal no-match", async () => {
		const result = await nodeSearch("rg", "process.exitCode = 1");
		assert.equal(result.kind, "no-matches");
		assert.equal(result.text, "No matches found.");
	});

	it("bounds stderr and reports non-zero tool errors", async () => {
		await assert.rejects(nodeSearch("rg", `process.stderr.write(Buffer.alloc(${STDERR_MAX_BYTES + 1000}, 101)); process.exitCode = 2`), (error) => {
			assert.match(error.message, /rg search failed/);
			assert.match(error.message, /stderr limit 65536 bytes reached/);
			assert.ok(error.message.length < STDERR_MAX_BYTES + 200);
			return true;
		});
	});

	it("terminates and cleans up on cancellation", async () => {
		const before = await spillDirectories("fd");
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 80);
		const started = Date.now();
		await assert.rejects(nodeSearch("fd", "setInterval(() => process.stdout.write('still alive\\n'), 20)", { signal: controller.signal, timeoutMs: 5_000 }), /fd search cancelled/);
		assert.ok(Date.now() - started < 2_000);
		assert.deepEqual(await spillDirectories("fd"), before);
	});

	it("reports the configured timeout and cleans up", async () => {
		const before = await spillDirectories("rg");
		await assert.rejects(nodeSearch("rg", "setInterval(() => {}, 1000)", { timeoutMs: 75 }), /rg search timeout limit 75ms exceeded/);
		assert.deepEqual(await spillDirectories("rg"), before);
	});
});
