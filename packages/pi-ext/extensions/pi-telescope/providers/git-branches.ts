/**
 * Git Branches Provider
 *
 * Actions: checkout, copy name
 */

import { execSync } from "node:child_process";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../clipboard.js";

interface Branch {
	name: string;
	isCurrent: boolean;
	isRemote: boolean;
}

function listBranches(cwd: string): Branch[] {
	try {
		const output = execSync("git branch -a --no-color 2>/dev/null", {
			encoding: "utf-8",
			cwd,
			timeout: 5000,
		});
		return output
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const isCurrent = line.startsWith("*");
				const name = line.replace(/^\*?\s*/, "").trim();
				const isRemote = name.startsWith("remotes/");
				return { name, isCurrent, isRemote };
			})
			.filter((b) => !b.name.includes("HEAD ->"));
	} catch {
		return [];
	}
}

function branchPreview(branch: Branch, cwd: string, maxLines: number): string[] {
	try {
		const name = branch.name.replace(/^remotes\//, "");
		const output = execSync(
			`git log --oneline --graph -${maxLines} "${name}" 2>/dev/null`,
			{ encoding: "utf-8", cwd, timeout: 5000 },
		);
		return output.split("\n").slice(0, maxLines);
	} catch {
		return ["(no preview)"];
	}
}

export function createGitBranchesProvider(cwd: string): TelescopeProvider<Branch> {
	return {
		name: "git-branches",
		icon: "🌿",
		description: "Git branches",

		load() {
			return listBranches(cwd);
		},

		getSearchText(item) {
			return item.name;
		},

		getDisplayText(item, theme) {
			const marker = item.isCurrent ? theme.fg("success", "* ") : "  ";
			const name = item.isRemote
				? theme.fg("dim", item.name)
				: item.isCurrent
					? theme.fg("success", item.name)
					: item.name;
			return `${marker}${name}`;
		},

		async onSelect(item, ctx) {
			const name = item.name.replace(/^remotes\/origin\//, "");
			ctx.ui.pasteToEditor(name);
		},

		getPreview(item, maxLines) {
			return branchPreview(item, cwd, maxLines);
		},

		getFrecencyKey(item) {
			return item.name;
		},

		actions: [
			{ key: "o", label: "Checkout", description: "Switch to this branch" },
			{ key: "c", label: "Copy name", description: "Copy branch name to clipboard" },
		],

		async onAction(actionKey, items, ctx) {
			const item = items[0];
			if (!item) return;
			const name = item.name.replace(/^remotes\/origin\//, "");

			if (actionKey === "o") {
				try {
					execSync(`git checkout "${name}"`, {
						cwd,
						encoding: "utf-8",
						timeout: 10_000,
					});
					ctx.ui.notify(`Switched to branch: ${name}`, "info");
				} catch (err: any) {
					ctx.ui.notify(`Checkout failed: ${err.message ?? err}`, "warning");
				}
			} else if (actionKey === "c") {
				copyToClipboard(name);
			}
		},
	};
}
