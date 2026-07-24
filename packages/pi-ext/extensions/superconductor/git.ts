/**
 * Git worktree helper.
 *
 * Superconductor's local API (v17) does NOT expose a "create worktree"
 * command — its worktrees are created inside the app process and never
 * surfaced over the `sc` CLI / socket. But SC worktrees are ultimately just
 * `git worktree` checkouts, so we create one with raw git and (optionally)
 * hand it to SC via `sc workspace open`.
 *
 * Everything here shells out to `git`. No throws on failure — we return a
 * structured result the tool layer can present.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

export interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	code: number | null;
}

function git(repo: string, args: string[], timeout = 30_000): Promise<GitResult> {
	return new Promise((resolve) => {
		execFile("git", ["-C", repo, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
			const code = err ? ((err as NodeJS.ErrnoException).code === "ENOENT" ? null : (err as any).code ?? 1) : 0;
			resolve({
				ok: !err,
				stdout: (stdout || "").trim(),
				stderr: (stderr || "").trim(),
				code: typeof code === "number" ? code : null,
			});
		});
	});
}

/** The primary checkout for the project (the repo SC branched this worktree from). */
export function rootRepo(): string | undefined {
	return process.env.SUPERCONDUCTOR_ROOT_PATH || undefined;
}

function sanitizeBranchForPath(branch: string): string {
	return branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "worktree";
}

async function branchExists(repo: string, branch: string): Promise<boolean> {
	const res = await git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
	return res.ok && res.stdout.length > 0;
}

export interface CreateWorktreeOptions {
	/** New (or existing) branch name to check out in the worktree. */
	branch: string;
	/** Base ref to branch from when creating a new branch. Default: "main". */
	base?: string;
	/** Destination path. Default: sibling of the root repo named "<repo>-<branch>". */
	dest?: string;
	/** Override the root repo. Default: SUPERCONDUCTOR_ROOT_PATH. */
	repo?: string;
}

export interface CreateWorktreeResult {
	ok: boolean;
	/** Absolute path of the created worktree (set even on some failures for context). */
	path: string;
	branch: string;
	base: string;
	/** Whether a new branch was created (vs. checking out an existing one). */
	createdBranch: boolean;
	error?: string;
}

/**
 * Create a git worktree off `base` (default main) checked out on `branch`.
 *
 * - If the branch already exists, it is checked out (base is ignored).
 * - If it does not exist, it is created from `base`.
 */
export async function createWorktree(opts: CreateWorktreeOptions): Promise<CreateWorktreeResult> {
	const repo = opts.repo || rootRepo();
	const base = opts.base || "main";
	const branch = opts.branch;

	const fail = (path: string, createdBranch: boolean, error: string): CreateWorktreeResult => ({
		ok: false,
		path,
		branch,
		base,
		createdBranch,
		error,
	});

	if (!repo) return fail("", false, "no root repo (SUPERCONDUCTOR_ROOT_PATH unset); pass repo explicitly");
	if (!existsSync(repo)) return fail("", false, `root repo does not exist: ${repo}`);
	if (!branch || !branch.trim()) return fail("", false, "branch name is required");

	// Resolve destination: explicit, else sibling of the repo.
	const dest = opts.dest
		? path.resolve(opts.dest)
		: path.join(path.dirname(repo), `${path.basename(repo)}-${sanitizeBranchForPath(branch)}`);

	if (existsSync(dest)) return fail(dest, false, `destination already exists: ${dest}`);

	const exists = await branchExists(repo, branch);

	// `git worktree add <dest> -b <branch> <base>` for a new branch,
	// or `git worktree add <dest> <branch>` to attach an existing one.
	const args = exists
		? ["worktree", "add", dest, branch]
		: ["worktree", "add", dest, "-b", branch, base];

	const res = await git(repo, args);
	if (!res.ok) {
		return fail(dest, !exists, res.stderr || res.stdout || `git exited with code ${res.code}`);
	}

	return { ok: true, path: dest, branch, base, createdBranch: !exists };
}

/** List existing git worktrees of the root repo (porcelain, parsed). */
export async function listWorktrees(repo?: string): Promise<
	{ ok: boolean; worktrees: Array<{ path: string; branch?: string; head?: string }>; error?: string }
> {
	const r = repo || rootRepo();
	if (!r) return { ok: false, worktrees: [], error: "no root repo (SUPERCONDUCTOR_ROOT_PATH unset)" };
	const res = await git(r, ["worktree", "list", "--porcelain"]);
	if (!res.ok) return { ok: false, worktrees: [], error: res.stderr || res.stdout };

	const worktrees: Array<{ path: string; branch?: string; head?: string }> = [];
	let cur: { path: string; branch?: string; head?: string } | null = null;
	for (const line of res.stdout.split("\n")) {
		if (line.startsWith("worktree ")) {
			if (cur) worktrees.push(cur);
			cur = { path: line.slice("worktree ".length) };
		} else if (line.startsWith("HEAD ") && cur) {
			cur.head = line.slice("HEAD ".length);
		} else if (line.startsWith("branch ") && cur) {
			cur.branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
		}
	}
	if (cur) worktrees.push(cur);
	return { ok: true, worktrees };
}
