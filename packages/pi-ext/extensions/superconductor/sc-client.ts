/**
 * Superconductor CLI client — thin wrapper around the `sc` binary.
 *
 * Unlike cmux (which speaks a raw Unix-socket protocol), Superconductor
 * exposes everything through the `sc` CLI, which in turn talks to the
 * local API socket (SUPERCONDUCTOR_LOCAL_API_SOCKET). We shell out to `sc`
 * with `--json` / `--output json` and parse the structured envelope.
 *
 * Response envelope shapes observed in the wild:
 *   { "kind": "worktree_status", "response": { ... } }        // most commands
 *   { "kind": "providers", "providers": [ ... ] }              // some commands put data at top level
 *   { "kind": "cli_error", "error": { "code", "message" } }    // any failure
 *
 * Gracefully degrades: if not running inside Superconductor (or `sc` is
 * missing), `available` is false and every call resolves to a failed
 * ScResult. No throws, no noise.
 */

import { execFile } from "node:child_process";

export interface ScError {
	code: string;
	message: string;
}

export interface ScResult<T = any> {
	/** True when the command ran and `sc` did not return a cli_error. */
	ok: boolean;
	/** The "kind" discriminator from the envelope, or "exec_error". */
	kind: string;
	/** The payload: `response` field when present, otherwise the whole envelope. */
	response: T | null;
	/** Populated when ok is false. */
	error: ScError | null;
	/** Full parsed envelope, for callers that need top-level fields. */
	raw: any;
}

function fail(kind: string, error: ScError): ScResult {
	return { ok: false, kind, response: null, error, raw: null };
}

export class ScClient {
	private readonly bin: string;
	private readonly worktree: string | undefined;
	private readonly verbose: boolean;

	constructor() {
		this.bin = process.env.SUPERCONDUCTOR_SC_BIN || "sc";
		this.worktree = process.env.SUPERCONDUCTOR_WORKTREE_PATH;
		this.verbose = process.env.PI_SC_VERBOSE === "1";
	}

	/** True if we appear to be running as a Superconductor-managed agent. */
	get available(): boolean {
		if (process.env.PI_SC_DISABLE === "1") return false;
		return (
			process.env.SUPERCONDUCTOR_MANAGED_AGENT === "1" ||
			!!process.env.SUPERCONDUCTOR_LOCAL_API_SOCKET
		);
	}

	/**
	 * Run an `sc` subcommand. `args` should NOT include the json flag — the
	 * caller picks `--json` or `--output json` via `outputFlag`, because the
	 * CLI is inconsistent across command families.
	 */
	async run(
		args: string[],
		opts: { stdin?: string; timeout?: number; outputFlag?: "json" | "output-json" | "none" } = {},
	): Promise<ScResult> {
		if (!this.available) {
			return fail("unavailable", { code: "unavailable", message: "Superconductor is not available" });
		}

		const flagArgs =
			opts.outputFlag === "output-json"
				? ["--output", "json"]
				: opts.outputFlag === "none"
					? []
					: ["--json"];
		const fullArgs = [...args, ...flagArgs];
		const timeout = opts.timeout ?? 10_000;

		if (this.verbose) console.error("[pi-sc] ->", this.bin, fullArgs.join(" "));

		return new Promise<ScResult>((resolve) => {
			const child = execFile(
				this.bin,
				fullArgs,
				{ timeout, cwd: this.worktree, maxBuffer: 8 * 1024 * 1024 },
				(err, stdout, stderr) => {
					const out = (stdout || "").trim();

					// Try to parse JSON first — even on a non-zero exit, `sc` usually
					// prints a structured cli_error envelope to stdout.
					const parsed = this.parse(out);
					if (parsed) {
						if (this.verbose) console.error("[pi-sc] <-", parsed.kind, parsed.ok ? "ok" : parsed.error?.code);
						return resolve(parsed);
					}

					if (err) {
						const msg = (stderr || "").trim() || err.message;
						const code = (err as NodeJS.ErrnoException).code === "ENOENT" ? "sc_not_found" : "exec_error";
						return resolve(fail("exec_error", { code, message: msg }));
					}

					resolve(fail("parse_error", { code: "parse_error", message: out || "empty output" }));
				},
			);

			if (opts.stdin !== undefined) {
				child.stdin?.write(opts.stdin);
				child.stdin?.end();
			}
		});
	}

	/** Parse a single-line JSON envelope into an ScResult, or null if not JSON. */
	private parse(out: string): ScResult | null {
		if (!out) return null;
		// `sc` may emit several JSON lines (e.g. watch). We only want the last
		// complete object for one-shot commands.
		const line = out.split("\n").reverse().find((l) => l.trim().startsWith("{"));
		if (!line) return null;
		let obj: any;
		try {
			obj = JSON.parse(line);
		} catch {
			return null;
		}
		const kind = typeof obj.kind === "string" ? obj.kind : "unknown";
		if (kind === "cli_error" || obj.error) {
			const e = obj.error ?? {};
			return fail(kind, { code: e.code ?? "error", message: e.message ?? "unknown error" });
		}
		const { kind: _k, response, ...rest } = obj;
		return { ok: true, kind, response: response ?? rest, error: null, raw: obj };
	}

	// ── Worktree ──────────────────────────────────────────────────────────

	worktreeStatus(): Promise<ScResult> {
		return this.run(["worktree", "status"]);
	}

	diffSummary(file?: string): Promise<ScResult> {
		return this.run(["worktree", "diff-summary", ...(file ? ["--file", file] : [])]);
	}

	setTargetBranch(branch: string): Promise<ScResult> {
		return this.run(["worktree", "set-target-branch", branch]);
	}

	renameBranch(name: string): Promise<ScResult> {
		return this.run(["worktree", "rename-branch", name]);
	}

	// ── Workspace ─────────────────────────────────────────────────────────

	/** Open a directory as a Superconductor workspace (project). */
	workspaceOpen(path: string, activate = true): Promise<ScResult> {
		return this.run(["workspace", "open", path, ...(activate ? ["--activate"] : [])]);
	}

	// ── Tab ───────────────────────────────────────────────────────────────

	tabTitle(title: string): Promise<ScResult> {
		return this.run(["tab", "title", title]);
	}

	tabSplit(direction: "up" | "down" | "left" | "right", ui: "auto" | "chat" | "terminal" = "terminal"): Promise<ScResult> {
		return this.run(["tab", "split", "--direction", direction, "--ui", ui]);
	}
}
