import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { ARCHIVE_MAX_BYTES, DOWNLOAD_TIMEOUT_MS, MAX_REDIRECTS, PROBE_TIMEOUT_MS } from "./limits.ts";

export type ToolName = "fd" | "rg";
export type BinarySource = "system" | "fallback" | "installed";
export interface ResolvedBinary { tool: ToolName; path: string; source: BinarySource; version?: string }
export interface ReleaseAsset { tool: ToolName; version: string; url: string; sha256: string; bytes: number; member: string }

const FD_BASE = "https://github.com/sharkdp/fd/releases/download";
const RG_BASE = "https://github.com/BurntSushi/ripgrep/releases/download";
export const RELEASES: Record<string, ReleaseAsset> = {
	"fd:darwin:arm64": { tool: "fd", version: "10.4.2", url: `${FD_BASE}/v10.4.2/fd-v10.4.2-aarch64-apple-darwin.tar.gz`, sha256: "623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a", bytes: 1328933, member: "fd-v10.4.2-aarch64-apple-darwin/fd" },
	"fd:darwin:x64": { tool: "fd", version: "10.3.0", url: `${FD_BASE}/v10.3.0/fd-v10.3.0-x86_64-apple-darwin.tar.gz`, sha256: "50d30f13fe3d5914b14c4fff5abcbd4d0cdab4b855970a6956f4f006c17117a3", bytes: 1430203, member: "fd-v10.3.0-x86_64-apple-darwin/fd" },
	"fd:linux:arm64": { tool: "fd", version: "10.4.2", url: `${FD_BASE}/v10.4.2/fd-v10.4.2-aarch64-unknown-linux-gnu.tar.gz`, sha256: "6c51f7c5446b3338b1e401ff15dc194c590bb2fa64fd43ff3278300f073adec5", bytes: 1559490, member: "fd-v10.4.2-aarch64-unknown-linux-gnu/fd" },
	"fd:linux:x64": { tool: "fd", version: "10.4.2", url: `${FD_BASE}/v10.4.2/fd-v10.4.2-x86_64-unknown-linux-gnu.tar.gz`, sha256: "def59805cd14b5651b68990855f426ad087f3b96881296d963910431ba3143c8", bytes: 1700779, member: "fd-v10.4.2-x86_64-unknown-linux-gnu/fd" },
	"rg:darwin:arm64": { tool: "rg", version: "15.2.0", url: `${RG_BASE}/15.2.0/ripgrep-15.2.0-aarch64-apple-darwin.tar.gz`, sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4", bytes: 1764284, member: "ripgrep-15.2.0-aarch64-apple-darwin/rg" },
	"rg:darwin:x64": { tool: "rg", version: "15.2.0", url: `${RG_BASE}/15.2.0/ripgrep-15.2.0-x86_64-apple-darwin.tar.gz`, sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1", bytes: 1878284, member: "ripgrep-15.2.0-x86_64-apple-darwin/rg" },
	"rg:linux:arm64": { tool: "rg", version: "15.2.0", url: `${RG_BASE}/15.2.0/ripgrep-15.2.0-aarch64-unknown-linux-gnu.tar.gz`, sha256: "a740b91c82eaf9914cfedd353572f2791cbe0162c84101ee0951058f4dcbc90d", bytes: 1854661, member: "ripgrep-15.2.0-aarch64-unknown-linux-gnu/rg" },
	"rg:linux:x64": { tool: "rg", version: "15.2.0", url: `${RG_BASE}/15.2.0/ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz`, sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c", bytes: 2265718, member: "ripgrep-15.2.0-x86_64-unknown-linux-musl/rg" },
};

export function selectRelease(tool: ToolName, platform = process.platform, arch = process.arch): ReleaseAsset {
	const release = RELEASES[`${tool}:${platform}:${arch}`];
	if (!release) throw new Error(`${tool} has no managed fallback for platform ${platform}/${arch}; install ${tool} manually`);
	return release;
}

export function managedBinDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
	const agentDir = env.PI_CODING_AGENT_DIR ? resolve(env.PI_CODING_AGENT_DIR.replace(/^~(?=\/|$)/, home)) : join(home, ".pi", "agent");
	return join(agentDir, "bin");
}

async function commandExit(command: string, args: string[], timeoutMs: number): Promise<number | null> {
	return new Promise((done) => {
		let settled = false;
		const child = spawn(command, args, { stdio: "ignore", shell: false });
		const finish = (code: number | null) => { if (!settled) { settled = true; clearTimeout(timer); done(code); } };
		const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, timeoutMs);
		timer.unref?.();
		child.once("error", () => finish(null));
		child.once("exit", (code) => finish(code));
	});
}

export async function defaultProbe(command: string): Promise<boolean> {
	return (await commandExit(command, ["--version"], PROBE_TIMEOUT_MS)) === 0;
}

export interface FetchResponse { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Buffer> }
export type HttpsFetcher = (url: URL, signal: AbortSignal) => Promise<FetchResponse>;

export const defaultHttpsFetcher: HttpsFetcher = (url, signal) => new Promise((resolveResponse, reject) => {
	const req = httpsRequest(url, { signal }, (response) => {
		const headers: Record<string, string | string[] | undefined> = {};
		for (const [key, value] of Object.entries(response.headers)) headers[key] = value;
		resolveResponse({ status: response.statusCode ?? 0, headers, body: response as AsyncIterable<Buffer> });
	});
	req.once("error", reject);
	req.end();
});

export interface DownloadOptions {
	fetcher?: HttpsFetcher;
	maxBytes?: number;
	maxRedirects?: number;
	timeoutMs?: number;
}

export async function downloadPinned(asset: ReleaseAsset, destination: string, options: DownloadOptions = {}): Promise<number> {
	const fetcher = options.fetcher ?? defaultHttpsFetcher;
	const maxBytes = options.maxBytes ?? ARCHIVE_MAX_BYTES;
	const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
	const timeoutMs = options.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error(`${asset.tool} download timeout limit ${timeoutMs}ms exceeded`)), timeoutMs);
	let current = new URL(asset.url);
	let redirects = 0;
	try {
		while (true) {
			if (current.protocol !== "https:") throw new Error(`${asset.tool} download rejected non-HTTPS URL ${current.href}`);
			const response = await fetcher(current, controller.signal);
			if (response.status >= 300 && response.status < 400) {
				const location = response.headers.location;
				if (typeof location !== "string" || !location) throw new Error(`${asset.tool} download redirect ${response.status} has no location`);
				if (++redirects > maxRedirects) throw new Error(`${asset.tool} download redirect limit ${maxRedirects} exceeded; requested ${redirects}`);
				for await (const _chunk of response.body) { /* drain the response so its socket can close */ }
				current = new URL(location, current);
				continue;
			}
			if (response.status !== 200) throw new Error(`${asset.tool} download failed with HTTP ${response.status}`);
			const declaredValue = response.headers["content-length"];
			const declared = Number(Array.isArray(declaredValue) ? declaredValue[0] : declaredValue);
			if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`${asset.tool} archive byte limit ${maxBytes} exceeded; requested ${declared}`);
			const hash = createHash("sha256");
			const stream = createWriteStream(destination, { mode: 0o600 });
			let observed = 0;
			try {
				for await (const value of response.body) {
					const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
					observed += chunk.length;
					if (observed > maxBytes) throw new Error(`${asset.tool} archive byte limit ${maxBytes} exceeded; observed ${observed}`);
					hash.update(chunk);
					if (!stream.write(chunk)) await new Promise<void>((resolveDrain, rejectDrain) => { stream.once("drain", resolveDrain); stream.once("error", rejectDrain); });
				}
				await new Promise<void>((resolveEnd, rejectEnd) => { stream.end(resolveEnd); stream.once("error", rejectEnd); });
			} catch (error) {
				stream.destroy();
				throw error;
			}
			const actual = hash.digest("hex");
			if (actual !== asset.sha256) throw new Error(`${asset.tool} SHA-256 mismatch: expected ${asset.sha256}, observed ${actual}`);
			return observed;
		}
	} catch (error) {
		if (controller.signal.aborted) throw new Error(`${asset.tool} download timeout limit ${timeoutMs}ms exceeded`);
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

export interface InstallOptions extends DownloadOptions {
	binDir?: string;
	probe?: (command: string) => Promise<boolean>;
	platform?: NodeJS.Platform;
	arch?: NodeJS.Architecture;
	asset?: ReleaseAsset;
}

export async function installManaged(tool: ToolName, options: InstallOptions = {}): Promise<ResolvedBinary> {
	const asset = options.asset ?? selectRelease(tool, options.platform, options.arch);
	const binDir = options.binDir ?? managedBinDir();
	const probe = options.probe ?? defaultProbe;
	await mkdir(binDir, { recursive: true, mode: 0o700 });
	const temporary = await mkdtemp(join(tmpdir(), `pi-${tool}-`));
	const archive = join(temporary, basename(asset.url));
	const staged = join(binDir, `.${tool}.${process.pid}.${Date.now()}.tmp`);
	try {
		await downloadPinned(asset, archive, options);
		const exit = await commandExit("tar", ["-xzf", archive, "-C", temporary, asset.member], PROBE_TIMEOUT_MS);
		if (exit !== 0) throw new Error(`${tool} extraction failed (tar exit ${exit ?? "timeout"}; limit ${PROBE_TIMEOUT_MS}ms)`);
		await copyFile(join(temporary, asset.member), staged);
		await chmod(staged, 0o755);
		if (!(await probe(staged))) throw new Error(`${tool} installed binary failed its --version probe`);
		const destination = join(binDir, tool);
		await rename(staged, destination);
		return { tool, path: destination, source: "installed", version: asset.version };
	} finally {
		await rm(staged, { force: true }).catch(() => undefined);
		await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
	}
}

export interface ResolveOptions extends InstallOptions {
	env?: NodeJS.ProcessEnv;
	installer?: (tool: ToolName) => Promise<ResolvedBinary>;
}

export async function resolveBinary(tool: ToolName, options: ResolveOptions = {}): Promise<ResolvedBinary> {
	const probe = options.probe ?? defaultProbe;
	const commands = tool === "fd" ? ["fd", "fdfind"] : ["rg"];
	for (const command of commands) if (await probe(command)) return { tool, path: command, source: "system" };
	const fallback = join(options.binDir ?? managedBinDir(options.env), tool);
	if (await probe(fallback)) return { tool, path: fallback, source: "fallback" };
	if ((options.env ?? process.env).PI_OFFLINE === "1") throw new Error(`${tool} is unavailable while PI_OFFLINE=1; install ${tool} manually or provide ${fallback}`);
	return options.installer ? options.installer(tool) : installManaged(tool, { ...options, binDir: dirname(fallback), probe });
}

export class BinaryResolvers {
	readonly #promises = new Map<ToolName, Promise<ResolvedBinary>>();
	readonly options: ResolveOptions;
	constructor(options: ResolveOptions = {}) { this.options = options; }
	resolve(tool: ToolName): Promise<ResolvedBinary> {
		let promise = this.#promises.get(tool);
		if (!promise) {
			promise = resolveBinary(tool, this.options);
			this.#promises.set(tool, promise);
		}
		return promise;
	}
}
