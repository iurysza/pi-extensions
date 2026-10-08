import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { AdmissionRelay } from "./claude-code-admission.js";
import { childEnv, conflictingOverrides, handshakeArgs, killProcessGroup, resolveCommand, spawnClaude } from "./claude-code-cli.js";
import type { PickerRow } from "./claude-code-model-catalog.js";
import type { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { parseCliLine } from "./claude-code-stream-json.js";

const AUTH_TIMEOUT_MS = 10_000;
const PICKER_TIMEOUT_MS = 15_000;
const PICKER_REQUEST_ID = "pi-claude-code-initialize";

export interface AuthStatus {
	readonly loggedIn: boolean;
	readonly authMethod?: string;
}

function runShort(command: string, args: string[], runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<{ code: number | null; stdout: string } | undefined> {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			env: { ...childEnv(runtime.env, "http://127.0.0.1:9/unused") },
			stdio: ["ignore", "pipe", "ignore"],
			detached: true,
		});
		let stdout = "";
		let settled = false;
		const finish = (value: { code: number | null; stdout: string } | undefined) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			killProcessGroup(child);
			resolve(value);
		};
		const onAbort = () => finish(undefined);
		const timer = setTimeout(() => finish(undefined), AUTH_TIMEOUT_MS);
		signal?.addEventListener("abort", onAbort, { once: true });
		child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
		child.once("error", () => finish(undefined));
		child.once("close", (code) => finish({ code, stdout }));
	});
}

export async function readAuthStatus(runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<AuthStatus | undefined> {
	const command = await resolveCommand(runtime.env, runtime.command);
	if (!command) return undefined;
	const result = await runShort(command, ["auth", "status"], runtime, signal);
	if (!result) return undefined;
	try {
		const parsed = JSON.parse(result.stdout) as { loggedIn?: unknown; authMethod?: unknown };
		return {
			loggedIn: parsed.loggedIn === true,
			...(typeof parsed.authMethod === "string" ? { authMethod: parsed.authMethod } : {}),
		};
	} catch {
		return undefined;
	}
}

export async function readCliVersion(runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<string | undefined> {
	const command = await resolveCommand(runtime.env, runtime.command);
	if (!command) return undefined;
	const result = await runShort(command, ["--version"], runtime, signal);
	return result?.code === 0 ? result.stdout.trim() || undefined : undefined;
}

/**
 * Reads the account's model list from the `initialize` handshake. The relay admits nothing, so a
 * handshake that tries to reach Anthropic returns undefined instead of spending allowance.
 */
export async function readPicker(runtime: ClaudeCodeRuntime, signal?: AbortSignal): Promise<readonly PickerRow[] | undefined> {
	if (conflictingOverrides(runtime.env).length) return undefined;
	const command = await resolveCommand(runtime.env, runtime.command);
	if (!command) return undefined;
	const relay = await AdmissionRelay.start({ upstream: runtime.upstream, admit: false });
	const cwd = await runtime.processDirectory();
	const child = spawnClaude(command, handshakeArgs(), { cwd, env: childEnv(runtime.env, relay.url) });
	try {
		const rows = await new Promise<readonly PickerRow[] | undefined>((resolve) => {
			const timer = setTimeout(() => resolve(undefined), PICKER_TIMEOUT_MS);
			const done = (value: readonly PickerRow[] | undefined) => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", onAbort);
				resolve(value);
			};
			const onAbort = () => done(undefined);
			signal?.addEventListener("abort", onAbort, { once: true });
			child.once("close", () => done(undefined));
			child.once("error", () => done(undefined));
			createInterface({ input: child.stdout }).on("line", (line) => {
				const parsed = parseCliLine(line);
				if (!parsed) return;
				if (!parsed.ok) return done(undefined);
				const event = parsed.event;
				if (event.type !== "control_response" || event.response?.request_id !== PICKER_REQUEST_ID) return;
				const models = (event.response.response as { models?: unknown } | undefined)?.models;
				done(event.response.subtype === "success" && Array.isArray(models) ? (models as PickerRow[]) : undefined);
			});
			child.stdin.write(`${JSON.stringify({ type: "control_request", request_id: PICKER_REQUEST_ID, request: { subtype: "initialize" } })}\n`);
		});
		return relay.snapshot().denied > 0 ? undefined : rows;
	} finally {
		child.stdin.end();
		killProcessGroup(child);
		await relay.close();
	}
}
