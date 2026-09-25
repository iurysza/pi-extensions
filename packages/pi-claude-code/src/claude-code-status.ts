import { lastTurn } from "./claude-code-active-turns.js";
import { conflictingOverrides, resolveCommand } from "./claude-code-cli.js";
import { defaultRuntime, type ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { readAuthStatus, readCliVersion } from "./claude-code-setup.js";

/** Plain-text status for `/claude-code-status`. Contains no credentials or request content. */
export async function claudeCodeStatus(runtime: ClaudeCodeRuntime = defaultRuntime()): Promise<string> {
	const command = await resolveCommand(runtime.env, runtime.command);
	const lines = [`CLI: ${command ?? "not found (install Claude Code or set PI_CLAUDE_CODE_COMMAND)"}`];
	if (command) {
		const [version, auth] = await Promise.all([readCliVersion(runtime), readAuthStatus(runtime)]);
		lines.push(`Version: ${version ?? "unknown"}`);
		lines.push(`Login: ${auth === undefined ? "unknown" : auth.loggedIn ? `logged in (${auth.authMethod ?? "unknown method"})` : "not logged in (run `claude auth login`)"}`);
	}
	const overrides = conflictingOverrides(runtime.env);
	if (overrides.length) lines.push(`Blocked by: ${overrides.join(", ")}`);
	const turn = lastTurn();
	if (turn) {
		const details = [
			turn.outcome,
			`${turn.durationMs} ms`,
			turn.status === undefined ? undefined : `HTTP ${turn.status}`,
			turn.requestId ? `request ${turn.requestId}` : undefined,
			turn.denied ? `${turn.denied} denied` : undefined,
			turn.skippedTools.length ? `skipped tools: ${turn.skippedTools.join(", ")}` : undefined,
		].filter(Boolean);
		lines.push(`Last turn: ${details.join(", ")}`);
	}
	return lines.join("\n");
}
