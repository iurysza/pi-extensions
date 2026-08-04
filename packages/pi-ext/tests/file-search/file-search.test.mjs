import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import fileSearch from "../../extensions/file-search/index.ts";
import { buildFdArgs, buildRgArgs, normalizeExtension, normalizePath } from "../../extensions/file-search/src/args.ts";
import {
	ARCHIVE_MAX_BYTES,
	FD_DEFAULT_LIMIT,
	FD_MAX_LIMIT,
	PREVIEW_MAX_BYTES,
	PREVIEW_MAX_LINES,
	RG_DEFAULT_LIMIT,
	RG_MAX_CONTEXT,
} from "../../extensions/file-search/src/limits.ts";
import { PreviewAccumulator, truncationNotice } from "../../extensions/file-search/src/output.ts";
import {
	BinaryResolvers,
	RELEASES,
	downloadPinned,
	installManaged,
	managedBinDir,
	resolveBinary,
	selectRelease,
} from "../../extensions/file-search/src/binaries.ts";

function response(status, body = Buffer.alloc(0), headers = {}) {
	return { status, headers, body: (async function* () { if (body.length) yield body; })() };
}

function sha256(buffer) { return createHash("sha256").update(buffer).digest("hex"); }

describe("file-search argument contracts", () => {
	it("normalizes model paths and extensions", () => {
		assert.equal(normalizePath("@@~/src", "/work", "/home/me"), "/home/me/src");
		assert.equal(normalizePath("@../other", "/work/repo", "/home/me"), "/work/other");
		assert.equal(normalizePath(undefined, "/work/repo", "/home/me"), "/work/repo");
		assert.equal(normalizeExtension("..ts"), "ts");
	});

	it("builds fd argv with every option and hostile patterns after --", () => {
		assert.deepEqual(buildFdArgs({ pattern: "--exec", path: "@src", type: "file", extension: ".ts", glob: true, hidden: true, maxDepth: 99, limit: 99_999 }, "/repo", "/home"), [
			"--color", "never", "--max-results", String(FD_MAX_LIMIT), "--type", "f", "--extension", "ts", "--glob", "--hidden", "--max-depth", "64", "--", "--exec", "/repo/src",
		]);
		assert.deepEqual(buildFdArgs({}, "/repo", "/home"), ["--color", "never", "--max-results", String(FD_DEFAULT_LIMIT), "--", ".", "/repo"]);
	});

	it("builds rg argv with smart and forced case, literal mode, and bounded values", () => {
		assert.deepEqual(buildRgArgs({ pattern: "--files", path: "@~/code", glob: "*.ts", type: "ts", case: "insensitive", literal: true, hidden: true, context: 99, maxCount: -4 }, "/repo", "/home"), [
			"--color", "never", "--line-number", "--with-filename", "--max-count", "1", "--ignore-case", "--glob", "*.ts", "--type", "ts", "--fixed-strings", "--hidden", "--context", String(RG_MAX_CONTEXT), "--", "--files", "/home/code",
		]);
		assert.ok(buildRgArgs({ pattern: "needle" }, "/repo").includes("--smart-case"));
		assert.ok(buildRgArgs({ pattern: "needle", case: "sensitive" }, "/repo").includes("--case-sensitive"));
		assert.equal(buildRgArgs({ pattern: "needle" }, "/repo")[5], String(RG_DEFAULT_LIMIT));
	});
});

describe("bounded preview accounting", () => {
	it("retains a UTF-8-safe head and reports both limits and observed output", () => {
		const output = new PreviewAccumulator();
		const value = Buffer.from(`${"é".repeat(PREVIEW_MAX_BYTES)}\n${"x\n".repeat(PREVIEW_MAX_LINES)}`);
		for (let offset = 0; offset < value.length; offset += 17) output.push(value.subarray(offset, offset + 17));
		const summary = output.summary();
		assert.equal(summary.truncated, true);
		assert.ok(!summary.preview.endsWith("�"));
		assert.ok(Buffer.byteLength(summary.preview) <= PREVIEW_MAX_BYTES);
		const notice = truncationNotice(summary, "/tmp/output.txt");
		assert.match(notice, /2,000 lines\/50,000 bytes/);
		assert.match(notice, /Observed .* lines\/.* bytes/);
		assert.match(notice, /\/tmp\/output.txt/);
	});
});

describe("release selection and binary resolution", () => {
	it("pins all eight supported assets below the 25 MB tripwire", () => {
		assert.equal(Object.keys(RELEASES).length, 8);
		for (const tool of ["fd", "rg"]) for (const platform of ["darwin", "linux"]) for (const arch of ["arm64", "x64"]) {
			const asset = selectRelease(tool, platform, arch);
			assert.match(asset.url, /^https:\/\/github\.com\//);
			assert.match(asset.sha256, /^[a-f0-9]{64}$/);
			assert.ok(asset.bytes < ARCHIVE_MAX_BYTES);
		}
		assert.throws(() => selectRelease("fd", "win32", "x64"), /no managed fallback.*win32\/x64/);
	});

	it("tries system names then the managed fallback and never installs offline", async () => {
		const seen = [];
		const binDir = "/managed/bin";
		const resolved = await resolveBinary("fd", { binDir, env: { PI_OFFLINE: "1" }, probe: async (name) => { seen.push(name); return name === `${binDir}/fd`; }, installer: async () => { throw new Error("network used"); } });
		assert.deepEqual(seen, ["fd", "fdfind", `${binDir}/fd`]);
		assert.equal(resolved.source, "fallback");
		await assert.rejects(resolveBinary("rg", { binDir, env: { PI_OFFLINE: "1" }, probe: async () => false, installer: async () => { throw new Error("network used"); } }), /rg.*PI_OFFLINE=1.*install rg manually/);
	});

	it("caches each resolver independently", async () => {
		const probes = [];
		const resolvers = new BinaryResolvers({ binDir: "/managed", env: { PI_OFFLINE: "1" }, probe: async (name) => { probes.push(name); return name === "rg"; } });
		await assert.rejects(resolvers.resolve("fd"), /fd is unavailable/);
		assert.equal((await resolvers.resolve("rg")).path, "rg");
		assert.equal((await resolvers.resolve("rg")).path, "rg");
		assert.equal(probes.filter((name) => name === "rg").length, 1);
	});

	it("derives managed paths from PI_CODING_AGENT_DIR", () => {
		assert.equal(managedBinDir({ PI_CODING_AGENT_DIR: "~/custom" }, "/home/me"), "/home/me/custom/bin");
	});
});

describe("secure pinned downloads", () => {
	it("follows bounded HTTPS redirects and verifies the streamed digest", async () => {
		const directory = await mkdtemp(join(tmpdir(), "download-test-"));
		try {
			const body = Buffer.from("verified archive");
			const asset = { tool: "fd", version: "test", url: "https://example.test/start", sha256: sha256(body), bytes: body.length, member: "root/fd" };
			const seen = [];
			const bytes = await downloadPinned(asset, join(directory, "archive"), { fetcher: async (url) => { seen.push(url.href); return seen.length === 1 ? response(302, Buffer.alloc(0), { location: "https://cdn.example.test/archive" }) : response(200, body, { "content-length": String(body.length) }); } });
			assert.equal(bytes, body.length);
			assert.deepEqual(seen, ["https://example.test/start", "https://cdn.example.test/archive"]);
			assert.deepEqual(await readFile(join(directory, "archive")), body);
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	it("rejects insecure redirects, redirect overflow, size excess, hash mismatch, and timeout", async () => {
		const directory = await mkdtemp(join(tmpdir(), "download-reject-"));
		const asset = { tool: "rg", version: "test", url: "https://example.test/start", sha256: sha256(Buffer.from("good")), bytes: 4, member: "root/rg" };
		try {
			await assert.rejects(downloadPinned(asset, join(directory, "a"), { fetcher: async () => response(302, Buffer.alloc(0), { location: "http://bad.test/file" }) }), /non-HTTPS/);
			await assert.rejects(downloadPinned(asset, join(directory, "b"), { maxRedirects: 1, fetcher: async () => response(302, Buffer.alloc(0), { location: "https://example.test/again" }) }), /redirect limit 1 exceeded; requested 2/);
			await assert.rejects(downloadPinned(asset, join(directory, "c"), { maxBytes: 3, fetcher: async () => response(200, Buffer.from("four"), { "content-length": "4" }) }), /byte limit 3 exceeded; requested 4/);
			await assert.rejects(downloadPinned(asset, join(directory, "d"), { maxBytes: 3, fetcher: async () => response(200, Buffer.from("four")) }), /byte limit 3 exceeded; observed 4/);
			await assert.rejects(downloadPinned(asset, join(directory, "e"), { fetcher: async () => response(200, Buffer.from("evil")) }), /SHA-256 mismatch.*expected.*observed/);
			await assert.rejects(downloadPinned(asset, join(directory, "f"), { fetcher: async () => response(302), maxRedirects: 2 }), /redirect 302 has no location/);
			await assert.rejects(downloadPinned(asset, join(directory, "g"), { timeoutMs: 20, fetcher: async (_url, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }), /download timeout limit 20ms exceeded/);
		} finally { await rm(directory, { recursive: true, force: true }); }
	});

	it("extracts the exact member, sets executable mode, and atomically replaces only its tool", async () => {
		const directory = await mkdtemp(join(tmpdir(), "install-test-"));
		try {
			const source = join(directory, "source");
			const member = "fixture/fd";
			await mkdir(join(source, "fixture"), { recursive: true });
			await writeFile(join(source, member), "#!/bin/sh\necho fd test\n", { mode: 0o755 });
			const archive = join(directory, "fixture.tar.gz");
			assert.equal(spawnSync("tar", ["-czf", archive, "-C", source, "fixture"]).status, 0);
			const body = await readFile(archive);
			const binDir = join(directory, "bin");
			await mkdir(binDir);
			await writeFile(join(binDir, "fd"), "old");
			await writeFile(join(binDir, "rg"), "untouched");
			const asset = { tool: "fd", version: "test", url: "https://example.test/fd.tar.gz", sha256: sha256(body), bytes: body.length, member };
			const result = await installManaged("fd", { asset, binDir, fetcher: async () => response(200, body, { "content-length": String(body.length) }), probe: async (path) => (await stat(path)).mode & 0o111 });
			assert.equal(result.source, "installed");
			assert.match(await readFile(join(binDir, "fd"), "utf8"), /fd test/);
			assert.equal(await readFile(join(binDir, "rg"), "utf8"), "untouched");
			assert.equal((await stat(join(binDir, "fd"))).mode & 0o777, 0o755);
			const installed = await readFile(join(binDir, "fd"));
			await assert.rejects(installManaged("fd", { asset, binDir, fetcher: async () => response(200, body), probe: async () => false }), /failed its --version probe/);
			assert.deepEqual(await readFile(join(binDir, "fd")), installed);
			const invalid = Buffer.from("not a tar archive");
			await assert.rejects(installManaged("fd", { asset: { ...asset, sha256: sha256(invalid), bytes: invalid.length }, binDir, fetcher: async () => response(200, invalid), probe: async () => true }), /extraction failed/);
		} finally { await rm(directory, { recursive: true, force: true }); }
	});
});

describe("Pi registration", () => {
	it("registers strict fd and rg tools without resolving binaries during factory load", () => {
		const tools = new Map();
		const handlers = new Map();
		fileSearch({ registerTool: (tool) => tools.set(tool.name, tool), on: (event, handler) => handlers.set(event, handler) });
		assert.deepEqual([...tools.keys()], ["fd", "rg"]);
		assert.equal(tools.get("fd").parameters.additionalProperties, false);
		assert.equal(tools.get("rg").parameters.required.includes("pattern"), true);
		assert.match(tools.get("fd").promptGuidelines.join(" "), /fd.*file-name.*rg.*contents.*bash/);
		assert.match(tools.get("rg").promptGuidelines.join(" "), /literal=true.*bash/);
		assert.equal(typeof handlers.get("session_start"), "function");
		const theme = { fg: (_role, text) => text, bold: (text) => text };
		assert.match(tools.get("fd").renderCall({ pattern: "*.ts", path: "src" }, theme, {}).render(200).join(""), /fd .*\.ts.*src/);
		assert.match(tools.get("rg").renderResult({ content: [{ type: "text", text: "No matches found." }], details: { tool: "rg", kind: "no-matches" } }, {}, theme, {}).render(200).join(""), /rg: no matches/);
		assert.match(tools.get("fd").renderResult({ content: [{ type: "text", text: "head\nFull output: \/tmp\/all" }], details: { tool: "fd", kind: "matches", totalLines: 2001, totalBytes: 60000, truncated: true, outputPath: "/tmp/all" } }, {}, theme, {}).render(300).join(""), /truncated.*\/tmp\/all/);
		assert.match(tools.get("fd").renderResult({ content: [{ type: "text", text: "head\nFull output: \/tmp\/all" }], details: { tool: "fd", kind: "matches" } }, { expanded: true }, theme, {}).render(300).join("\n"), /head.*Full output/s);
	});

	it("warms tools independently and notifies only installs or affected failures", async () => {
		const tools = new Map();
		const handlers = new Map();
		const notifications = [];
		fileSearch({ registerTool: (tool) => tools.set(tool.name, tool), on: (event, handler) => handlers.set(event, handler) }, {
			resolve: async (tool) => tool === "fd"
				? { tool, path: "/managed/fd", source: "installed", version: "10.4.2" }
				: Promise.reject(new Error("offline missing")),
		});
		await handlers.get("session_start")({}, { ui: { notify: (...args) => notifications.push(args) } });
		await new Promise((resolve) => setImmediate(resolve));
		assert.deepEqual([...tools.keys()], ["fd", "rg"]);
		assert.deepEqual(notifications, [
			["fd 10.4.2 installed at /managed/fd", "info"],
			["rg setup failed: offline missing", "warning"],
		]);
	});

	it("labels execution failures with the affected tool", async () => {
		const tools = new Map();
		fileSearch({ registerTool: (tool) => tools.set(tool.name, tool), on() {} }, {
			resolve: async (tool) => ({ tool, path: "/definitely/missing/file-search-binary", source: "system" }),
		});
		await assert.rejects(tools.get("rg").execute("call", { pattern: "x" }, new AbortController().signal, undefined, { cwd: process.cwd() }), /rg execution failed:.*ENOENT/);
	});

	it("loads through Pi's official loader in offline mode", async () => {
		const entry = fileURLToPath(new URL("../../extensions/file-search/index.ts", import.meta.url));
		const previous = process.env.PI_OFFLINE;
		process.env.PI_OFFLINE = "1";
		try {
			const loaded = await discoverAndLoadExtensions([entry], process.cwd(), join(tmpdir(), "pi-loader-empty"));
			assert.deepEqual(loaded.errors, []);
			const extension = loaded.extensions.find((item) => item.tools.has("fd"));
			assert.ok(extension);
			assert.deepEqual([...extension.tools.keys()], ["fd", "rg"]);
		} finally {
			if (previous === undefined) delete process.env.PI_OFFLINE;
			else process.env.PI_OFFLINE = previous;
		}
	});
});
