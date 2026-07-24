/**
 * Custom tools exposing Superconductor to the LLM.
 *
 * - superconductor_worktree: read worktree status / diff, change target branch,
 *   list git worktrees, and create new ones (raw git, since SC has no create API).
 *
 * The tool surfaces `sc` cli_error envelopes verbatim so the model can react.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateTail } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ScClient, ScResult } from "./sc-client.js";
import { createWorktree, listWorktrees, rootRepo } from "./git.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };

function text(s: string, details: Record<string, unknown> = {}): ToolResult {
	return { content: [{ type: "text", text: s }], details };
}

/** Render an ScResult as a tool result. Throws on failure so pi flags isError. */
function present(res: ScResult, emptyNote = "ok"): ToolResult {
	if (!res.ok) {
		throw new Error(`sc error [${res.error?.code}]: ${res.error?.message}`);
	}
	const payload = res.response;
	if (payload === null || payload === undefined) return text(emptyNote);
	const json = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
	const truncated = truncateTail(json, { maxBytes: 50_000, maxLines: 2000 });
	return text(truncated.content, { kind: res.kind });
}

export function wireTools(pi: ExtensionAPI, client: ScClient): void {
	// ── superconductor_worktree ─────────────────────────────────────────────
	pi.registerTool({
		name: "superconductor_worktree",
		label: "SC Worktree",
		description: [
			"Inspect and control the Superconductor worktree.",
			"",
			"status          — branch, target/base branch, files changed, +/- lines",
			"diff_summary    — per-file change summary (optional file filter)",
			"set_target_branch — change the review/merge target branch",
			"rename_branch   — rename the current worktree branch",
			"list_worktrees  — list git worktrees of the root repo",
			"create          — create a NEW git worktree off a base branch (default main),",
			"                  checked out on a new/existing branch; optionally open it in SC.",
			"",
			"The target/base branch is Superconductor-owned. Use status to read it; never infer from git defaults.",
			"Note: SC has no API to create a managed worktree, so create uses raw git. The new worktree",
			"is a real git checkout; with open_in_sc it is surfaced via `sc workspace open` but is not a",
			"Superconductor-managed task.",
		].join("\n"),
		promptSnippet: "Read Superconductor worktree status, diff, target branch; create new git worktrees off main.",
		promptGuidelines: [
			"Use superconductor_worktree status to read the authoritative target/base branch instead of guessing from git.",
			"To branch off main into a fresh worktree, use action=create with a branch name (base defaults to main).",
		],
		parameters: Type.Object({
			action: StringEnum([
				"status",
				"diff_summary",
				"set_target_branch",
				"rename_branch",
				"list_worktrees",
				"create",
			] as const),
			file: Type.Optional(Type.String({ description: "For diff_summary: limit to a single file path" })),
			branch: Type.Optional(
				Type.String({ description: "For set_target_branch: new target branch. For create: new/existing branch to check out." }),
			),
			name: Type.Optional(Type.String({ description: "For rename_branch: the new branch name" })),
			base: Type.Optional(Type.String({ description: "For create: base ref to branch from (default: main)" })),
			path: Type.Optional(
				Type.String({ description: "For create: destination dir (default: sibling of root repo, '<repo>-<branch>')" }),
			),
			open_in_sc: Type.Optional(
				Type.Boolean({ description: "For create: open the new worktree in Superconductor via `sc workspace open`" }),
			),
		}),
		async execute(_id, params): Promise<ToolResult> {
			switch (params.action) {
				case "status":
					return present(await client.worktreeStatus());
				case "diff_summary":
					return present(await client.diffSummary(params.file));
				case "set_target_branch":
					if (!params.branch) throw new Error("branch is required for set_target_branch");
					return present(await client.setTargetBranch(params.branch), "target branch updated");
				case "rename_branch":
					if (!params.name) throw new Error("name is required for rename_branch");
					return present(await client.renameBranch(params.name), "branch renamed");
				case "list_worktrees": {
					const res = await listWorktrees();
					if (!res.ok) throw new Error(`git error: ${res.error}`);
					return text(JSON.stringify({ root: rootRepo(), worktrees: res.worktrees }, null, 2));
				}
				case "create": {
					if (!params.branch) throw new Error("branch is required for create");
					const created = await createWorktree({
						branch: params.branch,
						base: params.base,
						dest: params.path,
					});
					if (!created.ok) throw new Error(`worktree create failed: ${created.error}`);
					let opened: ScResult | null = null;
					if (params.open_in_sc) opened = await client.workspaceOpen(created.path);
					return text(
						JSON.stringify(
							{
								path: created.path,
								branch: created.branch,
								base: created.base,
								created_branch: created.createdBranch,
								opened_in_sc: opened ? opened.ok : false,
								open_error: opened && !opened.ok ? opened.error?.message : undefined,
							},
							null,
							2,
						),
						{ kind: "worktree_created" },
					);
				}
			}
		},
	});
}
