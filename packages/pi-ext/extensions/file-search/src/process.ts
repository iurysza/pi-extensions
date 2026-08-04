import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PreviewAccumulator, truncationNotice, type PreviewSummary } from "./output.ts";
import { SEARCH_TIMEOUT_MS, STDERR_MAX_BYTES } from "./limits.ts";
import type { ToolName } from "./binaries.ts";

export interface SearchExecution {
	tool: ToolName;
	command: string;
	args: string[];
	cwd: string;
	timeoutMs?: number;
	signal?: AbortSignal;
}

export interface SearchProcessResult extends PreviewSummary {
	kind: "matches" | "no-matches";
	exitCode: number;
	stderr: string;
	stderrTruncated: boolean;
	outputPath?: string;
	text: string;
}

function terminate(pid: number | undefined): NodeJS.Timeout | undefined {
	if (!pid) return undefined;
	try {
		if (process.platform !== "win32") process.kill(-pid, "SIGTERM");
		else process.kill(pid, "SIGTERM");
	} catch {
		// It may have exited between the event and signal.
	}
	const timer = setTimeout(() => {
		try {
			if (process.platform !== "win32") process.kill(-pid, "SIGKILL");
			else process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}, 250);
	timer.unref?.();
	return timer;
}

export async function runSearch(input: SearchExecution): Promise<SearchProcessResult> {
	const timeoutMs = input.timeoutMs ?? SEARCH_TIMEOUT_MS;
	if (input.signal?.aborted) throw new Error(`${input.tool} search cancelled`);
	const directory = await mkdtemp(join(tmpdir(), `pi-${input.tool}-search-`));
	const outputPath = join(directory, "output.txt");
	let retain = false;
	try {
		const child = spawn(input.command, input.args, {
			cwd: input.cwd,
			detached: process.platform !== "win32",
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let timedOut = false;
		let cancelled = false;
		let killTimer: NodeJS.Timeout | undefined;
		const onAbort = () => { cancelled = true; killTimer ??= terminate(child.pid); };
		input.signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => { timedOut = true; killTimer ??= terminate(child.pid); }, timeoutMs);
		timer.unref?.();

		const preview = new PreviewAccumulator();
		const output = createWriteStream(outputPath, { mode: 0o600 });
		const stdoutTask = (async () => {
			for await (const value of child.stdout) {
				const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
				preview.push(chunk);
				if (!output.write(chunk)) await new Promise<void>((resolveDrain, rejectDrain) => { output.once("drain", resolveDrain); output.once("error", rejectDrain); });
			}
			await new Promise<void>((resolveEnd, rejectEnd) => { output.end(resolveEnd); output.once("error", rejectEnd); });
		})();

		let stderrBytes = 0;
		let stderrTruncated = false;
		const stderrChunks: Buffer[] = [];
		const stderrTask = (async () => {
			for await (const value of child.stderr) {
				const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
				const remaining = STDERR_MAX_BYTES - stderrBytes;
				if (remaining > 0) {
					const kept = chunk.subarray(0, remaining);
					stderrChunks.push(kept);
					stderrBytes += kept.length;
				}
				if (chunk.length > remaining) stderrTruncated = true;
			}
		})();

		const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
			child.once("error", rejectExit);
			child.once("close", (code) => resolveExit(code ?? -1));
		}).finally(() => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			input.signal?.removeEventListener("abort", onAbort);
		});
		await Promise.all([stdoutTask, stderrTask]);
		const summary = preview.summary();
		const stderr = Buffer.concat(stderrChunks, stderrBytes).toString("utf8");
		if (timedOut) throw new Error(`${input.tool} search timeout limit ${timeoutMs}ms exceeded`);
		if (cancelled) throw new Error(`${input.tool} search cancelled`);
		const noMatches = summary.totalBytes === 0 && (exitCode === 0 || (input.tool === "rg" && exitCode === 1));
		if (!noMatches && exitCode !== 0) {
			const suffix = stderr.trim() || `exit code ${exitCode}`;
			throw new Error(`${input.tool} search failed: ${suffix}${stderrTruncated ? ` (stderr limit ${STDERR_MAX_BYTES} bytes reached)` : ""}`);
		}
		if (noMatches) return { ...summary, kind: "no-matches", exitCode, stderr, stderrTruncated, text: "No matches found." };
		if (summary.truncated) {
			retain = true;
			const notice = truncationNotice(summary, outputPath);
			return { ...summary, kind: "matches", exitCode, stderr, stderrTruncated, outputPath, text: `${summary.preview}${summary.preview.endsWith("\n") ? "" : "\n"}${notice}` };
		}
		return { ...summary, kind: "matches", exitCode, stderr, stderrTruncated, text: summary.preview };
	} finally {
		if (!retain) await rm(directory, { recursive: true, force: true });
	}
}
