import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";

export const CONFLICTING_OVERRIDES = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"CLAUDE_CODE_USE_BEDROCK",
	"CLAUDE_CODE_USE_VERTEX",
	"CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** Keeps each Turn to one request and keeps per-request noise out of the cached prefix. */
const TURN_ENV: Readonly<Record<string, string>> = {
	CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
	CLAUDE_CODE_MAX_RETRIES: "0",
	CLAUDE_CODE_TOTAL_TOKENS_REMINDER: "off",
	DISABLE_AUTO_COMPACT: "1",
	DISABLE_COMPACT: "1",
	ENABLE_TOOL_SEARCH: "false",
};

const KILL_GRACE_MS = 2_000;

export type Env = Readonly<Record<string, string | undefined>>;

export function conflictingOverrides(env: Env): string[] {
	return CONFLICTING_OVERRIDES.filter((name) => !!env[name]?.trim());
}

async function executableFile(path: string): Promise<boolean> {
	try {
		await access(path, constants.X_OK);
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

/** `PI_CLAUDE_CODE_COMMAND` when set, else `claude` on PATH. */
export async function resolveCommand(env: Env, command = env.PI_CLAUDE_CODE_COMMAND): Promise<string | undefined> {
	const name = command?.trim() || "claude";
	if (isAbsolute(name) || name.includes("/")) return (await executableFile(name)) ? name : undefined;
	for (const dir of (env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		if (await executableFile(candidate)) return candidate;
	}
	return undefined;
}

export function childEnv(env: Env, relayUrl: string): NodeJS.ProcessEnv {
	const out: NodeJS.ProcessEnv = {};
	for (const [name, value] of Object.entries(env)) {
		if (value !== undefined) out[name] = value;
	}
	return { ...out, ...TURN_ENV, ANTHROPIC_BASE_URL: relayUrl };
}

export interface TurnFiles {
	readonly systemPromptPath: string;
	readonly settingsPath: string;
}

export function turnArgs(route: string, files: TurnFiles): string[] {
	return [
		"-p",
		"--model",
		route,
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--tools",
		"",
		"--system-prompt-file",
		files.systemPromptPath,
		"--settings",
		files.settingsPath,
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--disable-slash-commands",
		"--max-turns",
		"1",
		"--permission-mode",
		"dontAsk",
		"--no-session-persistence",
	];
}

export function handshakeArgs(): string[] {
	return [
		"-p",
		"--input-format",
		"stream-json",
		"--output-format",
		"stream-json",
		"--verbose",
		"--tools",
		"",
		"--setting-sources",
		"",
		"--strict-mcp-config",
		"--no-session-persistence",
	];
}

/** Starts the CLI in its own process group so abort can reach its descendants. */
export function spawnClaude(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }): ChildProcessWithoutNullStreams {
	const child = spawn(command, args, { cwd: options.cwd, env: options.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
	child.stdin.on("error", () => {});
	child.stderr.resume();
	return child;
}

function signalGroup(pid: number, signal: NodeJS.Signals): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch {
		return false;
	}
}

/** SIGTERM to the whole group, then SIGKILL after a grace period if anything is still alive. */
export function killProcessGroup(child: { pid?: number }): void {
	const pid = child.pid;
	if (!pid) return;
	if (!signalGroup(pid, "SIGTERM")) return;
	const timer = setTimeout(() => signalGroup(pid, "SIGKILL"), KILL_GRACE_MS);
	timer.unref();
}
