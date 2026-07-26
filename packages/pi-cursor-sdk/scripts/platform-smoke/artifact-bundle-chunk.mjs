#!/usr/bin/env node
import { closeSync, fstatSync, readSync } from "node:fs";
import { PLATFORM_ARTIFACT_BUNDLE_PATH } from "./artifact-bundle-contract.mjs";
import { openRegularFileNoFollow } from "./artifact-fs-safety.mjs";

const MAX_CHUNK_BYTES = 32 * 1024;
const args = process.argv.slice(2);

function value(name) {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function fail(message) {
	console.error(`artifact bundle chunk error: ${message}`);
	process.exitCode = 2;
}

if (args.includes("-h") || args.includes("--help")) {
	console.log("Usage: node scripts/platform-smoke/artifact-bundle-chunk.mjs --path .platform-artifact-bundle.gz --offset <bytes> --length <1..32768>");
	process.exit(0);
}

const pathValue = value("--path");
const offset = Number(value("--offset"));
const length = Number(value("--length"));
if (args.length !== 6 || !pathValue || !Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_CHUNK_BYTES) {
	fail("invalid arguments");
} else if (pathValue !== PLATFORM_ARTIFACT_BUNDLE_PATH) {
	fail(`path must be exactly ${PLATFORM_ARTIFACT_BUNDLE_PATH}`);
} else {
	let descriptor;
	let output;
	try {
		descriptor = openRegularFileNoFollow(PLATFORM_ARTIFACT_BUNDLE_PATH);
		const total = fstatSync(descriptor).size;
		if (offset >= total) throw new Error("offset is outside the bundle");
		const buffer = Buffer.alloc(Math.min(length, total - offset));
		const bytes = readSync(descriptor, buffer, 0, buffer.length, offset);
		output = `PLATFORM_BUNDLE_CHUNK_JSON=${JSON.stringify({
			offset,
			total,
			bytes,
			contentBase64: buffer.subarray(0, bytes).toString("base64"),
		})}`;
	} catch (error) {
		fail(error instanceof Error ? error.message : String(error));
	} finally {
		if (descriptor !== undefined) {
			try { closeSync(descriptor); } catch {
				output = undefined;
				fail("failed to close bundle");
			}
		}
	}
	if (output) console.log(output);
}
