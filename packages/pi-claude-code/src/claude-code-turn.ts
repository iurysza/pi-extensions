import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { recordTurn, registerActiveTurn } from "./claude-code-active-turns.js";
import { AdmissionRelay } from "./claude-code-admission.js";
import { childEnv, conflictingOverrides, killProcessGroup, resolveCommand, spawnClaude, turnArgs, type TurnFiles } from "./claude-code-cli.js";
import type { TurnRequest } from "./claude-code-request.js";
import type { ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { assistantText, parseCliLine, type CliResult } from "./claude-code-stream-json.js";
import type { TurnSink } from "./claude-code-turn-emitter.js";
import { settleTurn, type CliTranscript, type RelaySnapshot, type TurnFailure, type TurnOutcome } from "./claude-code-turn-outcome.js";

export interface TurnReport {
	readonly outcome: TurnOutcome;
	readonly relay: RelaySnapshot;
	readonly transcript: CliTranscript;
}

/** Hands `result` lines to the replay loop one at a time; `undefined` once stdout is gone. */
class ResultQueue {
	private readonly queued: CliResult[] = [];
	private readonly waiters: Array<(result: CliResult | undefined) => void> = [];
	private closed = false;

	push(result: CliResult): void {
		const waiter = this.waiters.shift();
		if (waiter) waiter(result);
		else this.queued.push(result);
	}

	next(): Promise<CliResult | undefined> {
		const queued = this.queued.shift();
		if (queued) return Promise.resolve(queued);
		if (this.closed) return Promise.resolve(undefined);
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	close(): void {
		this.closed = true;
		for (const waiter of this.waiters.splice(0)) waiter(undefined);
	}
}

async function writeTurnFiles(dir: string, request: TurnRequest): Promise<TurnFiles> {
	const systemPromptPath = join(dir, "system.md");
	const settingsPath = join(dir, "settings.json");
	await writeFile(systemPromptPath, request.systemPrompt, { mode: 0o600 });
	await writeFile(settingsPath, JSON.stringify({ env: { CLAUDE_CODE_EXTRA_BODY: JSON.stringify(request.extraBody) } }), { mode: 0o600 });
	return { systemPromptPath, settingsPath };
}

function report(outcome: TurnOutcome, relay: RelaySnapshot = { admitted: false, denied: 0 }, transcript?: CliTranscript): TurnReport {
	return { outcome, relay, transcript: transcript ?? { acknowledgments: 0, extraResults: 0, exitCode: null } };
}

function failed(failure: TurnFailure): TurnOutcome {
	return { kind: "failed", failure };
}

function describe(outcome: TurnOutcome): string {
	return outcome.kind === "completed" ? outcome.stopReason : outcome.failure.type;
}

/**
 * Runs one Turn: one Claude Code Process, one Admission. Replayed user frames are written one at
 * a time because Claude Code reorders history when frames arrive before earlier acknowledgments.
 */
export async function runTurn(request: TurnRequest, runtime: ClaudeCodeRuntime, sink: TurnSink, signal?: AbortSignal): Promise<TurnReport> {
	const startedAt = Date.now();
	const result = await runTurnInner(request, runtime, sink, signal);
	recordTurn({
		finishedAt: Date.now(),
		durationMs: Date.now() - startedAt,
		outcome: describe(result.outcome),
		status: result.relay.status,
		requestId: result.relay.requestId,
		denied: result.relay.denied,
		acknowledgments: result.transcript.acknowledgments,
		skippedTools: request.inventory.skipped,
	});
	return result;
}

async function runTurnInner(request: TurnRequest, runtime: ClaudeCodeRuntime, sink: TurnSink, signal?: AbortSignal): Promise<TurnReport> {
	if (signal?.aborted) return report(failed({ type: "Aborted" }));
	const overrides = conflictingOverrides(runtime.env);
	if (overrides.length) return report(failed({ type: "ConflictingOverride", names: overrides }));
	const command = await resolveCommand(runtime.env, runtime.command);
	if (!command) return report(failed({ type: "CliMissing", command: runtime.command?.trim() || undefined }));

	const cwd = await runtime.processDirectory();
	const directory = await runtime.turnDirectory();
	const transcript: CliTranscript = { acknowledgments: 0, extraResults: 0, exitCode: null };
	let relay: AdmissionRelay | undefined;
	let child: ReturnType<typeof spawnClaude> | undefined;
	let early: TurnFailure | undefined;
	let aborted = false;
	let idleTimer: NodeJS.Timeout | undefined;
	let unregister: (() => void) | undefined;
	const stop = () => {
		if (child) killProcessGroup(child);
	};
	const fail = (failure: TurnFailure) => {
		early ??= failure;
		stop();
	};
	const touch = () => {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => fail({ type: "IdleTimeout", ms: runtime.idleTimeoutMs }), runtime.idleTimeoutMs);
	};
	const onAbort = () => {
		aborted = true;
		stop();
		void relay?.close();
	};

	try {
		const files = await writeTurnFiles(directory.path, request);
		relay = await AdmissionRelay.start({ upstream: runtime.upstream, admit: true, onEvent: (event) => sink.apply(event), onActivity: touch });
		signal?.addEventListener("abort", onAbort, { once: true });
		const spawned = spawnClaude(command, turnArgs(request.route, files), { cwd, env: childEnv(runtime.env, relay.url) });
		child = spawned;
		unregister = registerActiveTurn(onAbort);
		touch();

		const results = new ResultQueue();
		let queried = false;
		const exited = new Promise<number | null>((resolve) => {
			spawned.once("close", (code) => resolve(code));
			spawned.once("error", () => resolve(null));
		});
		void exited.then(() => results.close());
		createInterface({ input: spawned.stdout }).on("line", (line) => {
			touch();
			const parsed = parseCliLine(line);
			if (!parsed) return;
			if (!parsed.ok) {
				fail({ type: "InvalidCliOutput", line: parsed.line });
				return;
			}
			const event = parsed.event;
			if (event.type === "assistant" && event.error && !transcript.cliError) {
				transcript.cliError = { code: event.error, text: assistantText(event) };
			} else if (event.type === "result") {
				if (!queried) results.push(event);
				else if (!transcript.result) transcript.result = event;
				else transcript.extraResults += 1;
			}
		});
		const write = (frame: unknown) => spawned.stdin.write(`${JSON.stringify(frame)}\n`);

		for (const frame of request.replayed) {
			if (early || aborted) break;
			if (frame.type === "assistant") {
				write(frame);
				continue;
			}
			write({ ...frame, shouldQuery: false });
			const ack = await results.next();
			if (!ack) break;
			if (ack.is_error || (ack.num_turns ?? 0) !== 0) {
				fail({ type: "ReplayRejected", cliText: ack.result });
				break;
			}
			transcript.acknowledgments += 1;
		}
		const replayed = transcript.acknowledgments === request.replayed.filter((frame) => frame.type === "user").length;
		if (!early && !aborted && replayed) {
			queried = true;
			write(request.query);
		}
		spawned.stdin.end();
		transcript.exitCode = await exited;
		clearTimeout(idleTimer);

		const snapshot = relay.snapshot();
		if (aborted || signal?.aborted) return report(failed({ type: "Aborted" }), snapshot, transcript);
		if (early) return report(failed(early), snapshot, transcript);
		if (!queried) {
			return report(
				failed({ type: "CliFailed", exitCode: transcript.exitCode, cliText: transcript.cliError?.text }),
				snapshot,
				transcript,
			);
		}
		return report(settleTurn(transcript, snapshot, request.inventory, false), snapshot, transcript);
	} finally {
		clearTimeout(idleTimer);
		signal?.removeEventListener("abort", onAbort);
		unregister?.();
		stop();
		await relay?.close();
		await directory.dispose();
	}
}
