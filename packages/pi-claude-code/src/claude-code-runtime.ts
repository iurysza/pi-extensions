import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "./claude-code-cli.js";

const DEFAULT_IDLE_TIMEOUT_MS = 180_000;
const ANTHROPIC_API = "https://api.anthropic.com";

export interface TurnDirectory {
	readonly path: string;
	dispose(): Promise<void>;
}

export interface ClaudeCodeRuntime {
	readonly env: Env;
	readonly command?: string;
	readonly upstream: URL;
	readonly idleTimeoutMs: number;
	processDirectory(): Promise<string>;
	turnDirectory(): Promise<TurnDirectory>;
}

function idleTimeout(env: Env): number {
	const value = Number(env.PI_CLAUDE_CODE_IDLE_TIMEOUT_MS);
	return Number.isFinite(value) && value > 0 ? value : DEFAULT_IDLE_TIMEOUT_MS;
}

/**
 * The CLI's working directory appears in its prompt, so every Turn on the machine uses the same
 * empty directory to keep the cached prefix identical across Turns and pi restarts.
 */
export function processDirectoryPath(env: Env): string {
	const cacheHome = env.XDG_CACHE_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".cache");
	return join(cacheHome, "pi-claude-code", "cwd");
}

export async function createTurnDirectory(): Promise<TurnDirectory> {
	const path = await mkdtemp(join(tmpdir(), "pi-claude-code-turn-"));
	return { path, dispose: () => rm(path, { recursive: true, force: true }) };
}

export function defaultRuntime(env: Env = process.env): ClaudeCodeRuntime {
	return {
		env,
		command: env.PI_CLAUDE_CODE_COMMAND,
		upstream: new URL(ANTHROPIC_API),
		idleTimeoutMs: idleTimeout(env),
		async processDirectory() {
			const path = processDirectoryPath(env);
			await mkdir(path, { recursive: true, mode: 0o700 });
			return path;
		},
		turnDirectory: createTurnDirectory,
	};
}
