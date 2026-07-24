/**
 * /split-fork — Fork this session into a new pi process in a split or tab.
 *
 * Works with herder, tmux, or cmux. Detects which multiplexer is active automatically.
 *
 * Usage:
 *   /split-fork                    → horizontal split
 *   /split-fork --tab              → new tab/window
 *   /split-fork optional prompt    → split with prompt
 *   /split-fork --tab prompt here  → tab with prompt
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
	detectMultiplexer,
	createSplit,
	createTab,
	sendKeys,
	getMultiplexerName,
} from "../shared/multiplexer.js";

function shellQuote(value: string): string {
	if (value.length === 0) return "''";
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function getPiInvocationParts(): string[] {
	const currentScript = process.argv[1];
	if (currentScript && existsSync(currentScript)) {
		return [process.execPath, currentScript];
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return [process.execPath];
	}

	return ["pi"];
}

function buildPiCommand(sessionFile: string | undefined, prompt: string): string {
	const parts = [...getPiInvocationParts()];

	if (sessionFile) {
		parts.push("--session", sessionFile);
	}

	if (prompt.length > 0) {
		parts.push("--", prompt);
	}

	return parts.map(shellQuote).join(" ");
}

async function createForkedSession(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;

	const sessionDir = path.dirname(sessionFile);
	const branchEntries = ctx.sessionManager.getBranch();
	const currentHeader = ctx.sessionManager.getHeader();

	const timestamp = new Date().toISOString();
	const fileTimestamp = timestamp.replace(/[:.]/g, "-");
	const newSessionId = randomUUID();
	const newSessionFile = path.join(sessionDir, `${fileTimestamp}_${newSessionId}.jsonl`);

	const newHeader = {
		type: "session",
		version: currentHeader?.version ?? 3,
		id: newSessionId,
		timestamp,
		cwd: currentHeader?.cwd ?? ctx.cwd,
		parentSession: sessionFile,
	};

	const lines =
		[JSON.stringify(newHeader), ...branchEntries.map((entry) => JSON.stringify(entry))].join("\n") + "\n";

	await fs.mkdir(sessionDir, { recursive: true });
	await fs.writeFile(newSessionFile, lines, "utf8");

	return newSessionFile;
}

function parseArgs(raw: string): { useTab: boolean; prompt: string } {
	const trimmed = raw.trim();
	if (trimmed.startsWith("--tab ")) {
		return { useTab: true, prompt: trimmed.slice(6).trim() };
	}
	if (trimmed === "--tab") {
		return { useTab: true, prompt: "" };
	}
	return { useTab: false, prompt: trimmed };
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("split-fork", {
		description:
			"Fork this session into a new pi process in a split or tab (herder/tmux/cmux). Usage: /split-fork [--tab] [optional prompt]",
		handler: async (args, ctx) => {
			const { useTab, prompt } = parseArgs(args);
			const wasBusy = !ctx.isIdle();

			// 1. Fork the session
			const forkedSessionFile = await createForkedSession(ctx);

			// 2. Detect multiplexer and create split or tab
			const mux = detectMultiplexer();
			if (!mux) {
				ctx.ui.notify("No supported multiplexer detected (herder, tmux, or cmux).", "warning");
				if (forkedSessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
				}
				return;
			}

			const target = useTab ? createTab("fork") : createSplit("right");
			if (!target) {
				ctx.ui.notify(`Failed to create ${useTab ? "tab" : "split"} in ${mux}.`, "error");
				if (forkedSessionFile) {
					ctx.ui.notify(`Forked session was created: ${forkedSessionFile}`, "info");
				}
				return;
			}

			// 3. Small delay to let the new shell initialize
			await new Promise((r) => setTimeout(r, 500));

			// 4. Send the pi command to the new pane/surface
			const command = buildPiCommand(forkedSessionFile, prompt);
			sendKeys(target, command);

			// 5. Notify the user
			if (forkedSessionFile) {
				const fileName = path.basename(forkedSessionFile);
				const suffix = prompt ? " and sent prompt" : "";
				ctx.ui.notify(`Forked to ${fileName} in a new ${getMultiplexerName()} ${target.type}${suffix}.`, "info");
				if (wasBusy) {
					ctx.ui.notify(
						"Forked from current committed state (in-flight turn continues in original session).",
						"info",
					);
				}
			} else {
				ctx.ui.notify(
					`Opened a new ${getMultiplexerName()} ${target.type} (no persisted session to fork).`,
					"warning",
				);
			}
		},
	});
}
