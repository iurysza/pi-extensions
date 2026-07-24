/**
 * Git Log Provider
 *
 * Actions: copy hash, show diff
 */

import { execSync } from "node:child_process";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../clipboard.js";

interface Commit {
	hash: string;
	subject: string;
	author: string;
	date: string;
	raw: string;
}

function listCommits(cwd: string, count = 200): Commit[] {
	try {
		const output = execSync(
			`git log --oneline --no-color --format="%h|%s|%an|%ar" -${count} 2>/dev/null`,
			{ encoding: "utf-8", cwd, timeout: 5000 },
		);
		return output
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const parts = line.split("|");
				return {
					hash: parts[0] ?? "",
					subject: parts[1] ?? "",
					author: parts[2] ?? "",
					date: parts[3] ?? "",
					raw: line,
				};
			});
	} catch {
		return [];
	}
}

function commitPreview(commit: Commit, cwd: string, maxLines: number): string[] {
	try {
		const output = execSync(
			`git show --stat --format="%H%n%an <%ae>%n%ai%n%n%s%n%b" "${commit.hash}" 2>/dev/null`,
			{ encoding: "utf-8", cwd, timeout: 5000 },
		);
		return output.split("\n").slice(0, maxLines);
	} catch {
		return ["(no preview)"];
	}
}

export function createGitLogProvider(cwd: string): TelescopeProvider<Commit> {
	return {
		name: "git-log",
		icon: "📜",
		description: "Git commits",

		load() {
			return listCommits(cwd);
		},

		getSearchText(item) {
			return `${item.hash} ${item.subject} ${item.author}`;
		},

		getDisplayText(item, theme) {
			const hash = theme.fg("warning", item.hash);
			const date = theme.fg("dim", item.date);
			return `${hash} ${item.subject} ${date}`;
		},

		async onSelect(item, ctx) {
			ctx.ui.pasteToEditor(item.hash);
		},

		async onMultiSelect(items, ctx) {
			ctx.ui.pasteToEditor(items.map((i) => i.hash).join(" "));
		},

		getPreview(item, maxLines) {
			return commitPreview(item, cwd, maxLines);
		},

		getFrecencyKey(item) {
			return item.hash;
		},

		actions: [
			{ key: "c", label: "Copy hash", description: "Copy commit hash to clipboard" },
			{ key: "d", label: "Show diff", description: "Paste git show command" },
			{ key: "k", label: "Cherry-pick", description: "Paste cherry-pick command" },
		],

		async onAction(actionKey, items, ctx) {
			const item = items[0];
			if (!item) return;

			if (actionKey === "c") {
				copyToClipboard(items.map((i) => i.hash).join("\n"));
			} else if (actionKey === "d") {
				ctx.ui.pasteToEditor(`git show ${item.hash}`);
			} else if (actionKey === "k") {
				const hashes = items.map((i) => i.hash).join(" ");
				ctx.ui.pasteToEditor(`git cherry-pick ${hashes}`);
			}
		},
	};
}
