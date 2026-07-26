import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
	MAX_BUNDLE_AGGREGATE_BYTES, MAX_BUNDLE_FILE_BYTES, MAX_BUNDLE_FILE_COUNT,
	MAX_BUNDLE_PATH_BYTES, MAX_BUNDLE_PATH_COMPONENTS, MAX_INFLATED_BUNDLE_JSON_BYTES,
} from "./artifact-bundle-contract.mjs";

const MAGIC = Buffer.from([80, 73, 65, 82, 84, 48, 49, 0]);
let helperPath;
let helperDirectory;
let helperUnavailable = false;

function compileHelper() {
	if (helperPath) return helperPath;
	if (helperUnavailable) return undefined;
	const source = fileURLToPath(new URL("./artifact-openat-extract.c", import.meta.url));
	const content = readFileSync(source);
	const nativeLimits = [
		MAX_INFLATED_BUNDLE_JSON_BYTES, MAX_BUNDLE_FILE_COUNT, MAX_BUNDLE_FILE_BYTES,
		MAX_BUNDLE_AGGREGATE_BYTES, MAX_BUNDLE_PATH_BYTES, MAX_BUNDLE_PATH_COMPONENTS,
	];
	const key = createHash("sha256").update(content).update(process.platform).update(process.arch)
		.update(nativeLimits.join(":"))
		.digest("hex").slice(0, 16);
	helperDirectory = mkdtempSync(join(tmpdir(), `pi-cursor-artifact-openat-${key}-`));
	chmodSync(helperDirectory, 0o700);
	const output = join(helperDirectory, "extract");
	const compiled = spawnSync("cc", [
		"-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
		`-DMAX_INPUT=${MAX_INFLATED_BUNDLE_JSON_BYTES}`,
		`-DMAX_FILES=${MAX_BUNDLE_FILE_COUNT}`,
		`-DMAX_FILE_BYTES=${MAX_BUNDLE_FILE_BYTES}`,
		`-DMAX_TOTAL_BYTES=${MAX_BUNDLE_AGGREGATE_BYTES}`,
		`-DMAX_PATH_BYTES=${MAX_BUNDLE_PATH_BYTES}`,
		`-DMAX_PATH_COMPONENTS=${MAX_BUNDLE_PATH_COMPONENTS}`,
		"-o", output, source,
	], {
		encoding: "utf8",
		timeout: 30_000,
		maxBuffer: 1024 * 1024,
	});
	if (compiled.status !== 0 || compiled.error || !existsSync(output)) {
		rmSync(helperDirectory, { recursive: true, force: true });
		helperDirectory = undefined;
		helperUnavailable = true;
		return undefined;
	}
	chmodSync(output, 0o700);
	helperPath = output;
	process.once("exit", () => {
		if (helperDirectory) try { rmSync(helperDirectory, { recursive: true, force: true }); } catch {}
	});
	return helperPath;
}

function encodeFiles(files) {
	const count = Buffer.alloc(4);
	count.writeUInt32LE(files.length);
	const chunks = [MAGIC, count];
	for (const file of files) {
		const path = Buffer.from(file.path, "utf8");
		const lengths = Buffer.alloc(8);
		lengths.writeUInt32LE(path.length, 0);
		lengths.writeUInt32LE(file.content.length, 4);
		chunks.push(lengths, path, file.content);
	}
	return Buffer.concat(chunks);
}

function writePosix(outputDir, files, expectedRoot) {
	const helper = compileHelper();
	if (!helper) return false;
	let inputDirectory;
	let inputFd;
	try {
		inputDirectory = mkdtempSync(join(tmpdir(), "pi-cursor-artifact-input-"));
		chmodSync(inputDirectory, 0o700);
		const inputPath = join(inputDirectory, "frame");
		writeFileSync(inputPath, encodeFiles(files), { flag: "wx", mode: 0o600 });
		inputFd = openSync(inputPath, "r");
		unlinkSync(inputPath);
		const result = spawnSync(helper, [outputDir, String(expectedRoot.dev), String(expectedRoot.ino)], {
			stdio: [inputFd, "pipe", "pipe"],
			encoding: "buffer",
			maxBuffer: 1024 * 1024,
		});
		return result.status === 0 && !result.error;
	} catch {
		return false;
	} finally {
		try {
			if (inputFd !== undefined) closeSync(inputFd);
		} catch {
			// Continue to remove the private input directory.
		} finally {
			if (inputDirectory) try { rmSync(inputDirectory, { recursive: true, force: true }); } catch {}
		}
	}
}

/** Extracts prevalidated files without permitting a nested host-path swap to redirect writes.
 * Node has no handle-relative Windows creation API, so Windows controllers fail closed before
 * mutating nonempty bundles. Windows remains a supported target of POSIX-hosted release matrices. */
export function writeExtractedFilesAnchored(outputDir, files, expectedRoot) {
	if (process.platform === "win32") return files.length === 0;
	return writePosix(outputDir, files, expectedRoot);
}
