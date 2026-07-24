/**
 * Superconductor slash commands.
 *
 * /sc-fork [prompt]  — fork this pi session and open a new Superconductor
 *                      terminal split. Superconductor terminal panes have no
 *                      documented "send text" RPC, so we open the split and
 *                      hand the user a ready-to-paste `pi --session` command.
 *
 * /sc-worktree NAME [base] — create a git worktree off base (default main)
 *                      and open it in Superconductor via `sc workspace open`.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ScClient } from "./sc-client.js";
import { createWorktree } from "./git.js";

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function piInvocation(): string[] {
	const script = process.argv[1];
	if (script && existsSync(script)) return [process.execPath, script];
	const name = path.basename(process.execPath).toLowerCase();
	return /^(node|bun)(\.exe)?$/.test(name) ? ["pi"] : [process.execPath];
}

async function forkSessionFile(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;

	const dir = path.dirname(sessionFile);
	const branch = ctx.sessionManager.getBranch();
	const header = ctx.sessionManager.getHeader();
	const ts = new Date().toISOString();
	const id = randomUUID();
	const newFile = path.join(dir, `${ts.replace(/[:.]/g, "-")}_${id}.jsonl`);

	const newHeader = {
		type: "session",
		version: header?.version ?? 3,
		id,
		timestamp: ts,
		cwd: header?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};
	const lines = [JSON.stringify(newHeader), ...branch.map((e) => JSON.stringify(e))].join("\n") + "\n";
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(newFile, lines, "utf8");
	return newFile;
}

export function wireCommands(pi: ExtensionAPI, client: ScClient): void {
	pi.registerCommand("sc-fork", {
		description: "Fork this session and open a new Superconductor terminal split. Usage: /sc-fork [prompt]",
		handler: async (args, ctx) => {
			const prompt = args.trim();
			const forked = await forkSessionFile(ctx);

			const split = await client.tabSplit("right", "terminal");
			if (!split.ok) {
				ctx.ui.notify(`Could not open split: ${split.error?.message}`, "error");
				if (forked) ctx.ui.notify(`Forked session saved: ${forked}`, "info");
				return;
			}

			if (!forked) {
				ctx.ui.notify("Opened a terminal split (no persisted session to fork).", "warning");
				return;
			}

			const parts = [...piInvocation(), "--session", forked];
			if (prompt) parts.push("--", prompt);
			const cmd = parts.map(shellQuote).join(" ");
			ctx.ui.notify(`Terminal split opened. Run in it:\n${cmd}`, "info");
		},
	});

	pi.registerCommand("sc-worktree", {
		description: "Create a new git worktree off a base branch. Usage: /sc-worktree <branch> [base] (base default: main)",
		handler: async (args, ctx) => {
			const [branch, base] = args.trim().split(/\s+/);
			if (!branch) {
				ctx.ui.notify("Usage: /sc-worktree <branch> [base]", "warning");
				return;
			}
			const res = await createWorktree({ branch, base });
			if (!res.ok) {
				ctx.ui.notify(`Worktree create failed: ${res.error}`, "error");
				return;
			}
			const opened = await client.workspaceOpen(res.path);
			const tail = opened.ok ? " (opened in SC)" : ` (open in SC failed: ${opened.error?.message})`;
			ctx.ui.notify(
				`Worktree ready: ${res.path}\nbranch ${res.branch} ← ${res.base}${tail}`,
				opened.ok ? "info" : "warning",
			);
		},
	});
}
