import type { TurnFailure } from "./claude-code-turn-outcome.js";

const MAX_CLI_TEXT = 500;

function bounded(text: string | undefined): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) return undefined;
	return trimmed.length > MAX_CLI_TEXT ? `${trimmed.slice(0, MAX_CLI_TEXT)}…` : trimmed;
}

function withCliText(message: string, text: string | undefined): string {
	const detail = bounded(text);
	return detail ? `${message} Claude Code said: ${detail}` : message;
}

/** Text shown to the user for a failed Turn. Never includes headers, bodies, tokens, or stderr. */
export function failureMessage(failure: TurnFailure): string {
	switch (failure.type) {
		case "CliMissing":
			return failure.command
				? `Claude Code CLI not found at ${failure.command}. Fix PI_CLAUDE_CODE_COMMAND or unset it to use \`claude\` from PATH.`
				: "Claude Code CLI not found on PATH. Install it (`npm install -g @anthropic-ai/claude-code`), run `claude auth login`, or set PI_CLAUDE_CODE_COMMAND to its path.";
		case "ConflictingOverride": {
			const names = failure.names.join(", ");
			const verb = failure.names.length === 1 ? "is" : "are";
			return `The claude-code provider refuses to run while ${names} ${verb} set, because Claude Code would bill an API key or another backend instead of your subscription. Unset ${failure.names.length === 1 ? "it" : "them"} for pi, or use pi's anthropic provider for API-key access.`;
		}
		case "InvalidRequest":
			return failure.cause.type === "EndsWithAssistant"
				? "The conversation ends with an assistant message. The claude-code provider needs a user message or tool result to answer."
				: "The last message is empty, so there is nothing for Claude to answer.";
		case "LoggedOut":
			return withCliText("Claude Code is not logged in. Run `claude auth login` in a terminal, then try again.", failure.cliText);
		case "ReplayRejected":
			return withCliText("Claude Code rejected the replayed conversation history.", failure.cliText);
		case "UpstreamRejected":
			return `Claude API error (${failure.status}): ${bounded(failure.message) ?? "no error message"}`;
		case "IncompleteResponse": {
			const details = [
				failure.status === undefined ? "no response" : `status ${failure.status}`,
				failure.transportFailure,
				failure.denied ? `${failure.denied} extra request${failure.denied === 1 ? "" : "s"} denied` : undefined,
			].filter(Boolean);
			return withCliText(`Claude API response ended before it was complete (${details.join(", ")}).`, failure.cliText);
		}
		case "UnknownTool":
			return `Claude asked for a tool that is not available in this turn: ${failure.name}.`;
		case "CliFailed":
			return withCliText(
				`Claude Code exited without an answer (${failure.subtype ?? `exit code ${failure.exitCode ?? "none"}`}).`,
				failure.cliText,
			);
		case "InvalidCliOutput":
			return `Claude Code printed output that is not stream-json: ${failure.line}`;
		case "IdleTimeout":
			return `Claude Code produced no output for ${Math.round(failure.ms / 1000)} s and was stopped.`;
		case "Aborted":
			return "Request was aborted.";
	}
}
