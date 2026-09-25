import type { ToolInventory, TurnRequestError } from "./claude-code-request.js";
import type { CapturedResponse } from "./claude-code-response-capture.js";
import type { CliResult } from "./claude-code-stream-json.js";
import { piStopReason } from "./claude-code-turn-emitter.js";

export type TurnFailure =
	| { type: "CliMissing"; command?: string }
	| { type: "ConflictingOverride"; names: string[] }
	| { type: "InvalidRequest"; cause: TurnRequestError }
	| { type: "LoggedOut"; cliText: string }
	| { type: "ReplayRejected"; cliText?: string }
	| { type: "UpstreamRejected"; status: number; message: string }
	| { type: "IncompleteResponse"; status?: number; denied: number; transportFailure?: string; cliText?: string }
	| { type: "UnknownTool"; name: string }
	| { type: "CliFailed"; subtype?: string; exitCode: number | null; cliText?: string }
	| { type: "InvalidCliOutput"; line: string }
	| { type: "IdleTimeout"; ms: number }
	| { type: "Aborted" };

export type TurnOutcome =
	| { kind: "completed"; stopReason: "stop" | "length" | "toolUse" }
	| { kind: "failed"; failure: TurnFailure };

export interface RelaySnapshot {
	admitted: boolean;
	denied: number;
	status?: number;
	requestId?: string;
	transportFailure?: string;
	errorText?: string;
	captured?: CapturedResponse;
}

export interface CliTranscript {
	acknowledgments: number;
	result?: CliResult;
	extraResults: number;
	cliError?: { code: string; text: string };
	exitCode: number | null;
}

const STOP_REASONS = new Set(["end_turn", "stop_sequence", "pause_turn", "refusal"]);

function failed(failure: TurnFailure): TurnOutcome {
	return { kind: "failed", failure };
}

function cliText(transcript: CliTranscript): string | undefined {
	return transcript.cliError?.text || transcript.result?.result || undefined;
}

export function settleTurn(transcript: CliTranscript, relay: RelaySnapshot, inventory: ToolInventory, aborted: boolean): TurnOutcome {
	if (aborted) return failed({ type: "Aborted" });
	if (transcript.cliError?.code === "authentication_failed" && !relay.admitted) {
		return failed({ type: "LoggedOut", cliText: transcript.cliError.text });
	}
	if (relay.admitted && relay.status !== undefined && relay.status !== 200) {
		return failed({ type: "UpstreamRejected", status: relay.status, message: relay.errorText || `HTTP ${relay.status}` });
	}
	const cliFailed = () =>
		failed({ type: "CliFailed", subtype: transcript.result?.subtype, exitCode: transcript.exitCode, cliText: cliText(transcript) });
	if (!relay.admitted) return cliFailed();
	const captured = relay.captured;
	if (!captured || !captured.complete) {
		return failed({
			type: "IncompleteResponse",
			status: relay.status,
			denied: relay.denied,
			transportFailure: relay.transportFailure ?? captured?.streamError,
			cliText: cliText(transcript),
		});
	}
	for (const block of captured.content) {
		if (block.type === "tool_use" && !inventory.hostNames.has(block.name)) return failed({ type: "UnknownTool", name: block.name });
	}
	const stopReason = captured.stopReason;
	if (stopReason === "tool_use") {
		const boundary = transcript.result?.subtype === "error_max_turns" || (!!transcript.result && relay.denied > 0);
		return boundary ? { kind: "completed", stopReason: "toolUse" } : cliFailed();
	}
	if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") {
		return { kind: "completed", stopReason: piStopReason(stopReason) };
	}
	if (stopReason && STOP_REASONS.has(stopReason) && transcript.result && (!transcript.result.is_error || relay.denied > 0)) {
		return { kind: "completed", stopReason: "stop" };
	}
	return cliFailed();
}
