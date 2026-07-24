/**
 * Superconductor status surface.
 *
 * Two non-destructive signals:
 *   1. A pi footer status pill ("SC →main · +12 -3") showing the target
 *      branch and current diff size. Refreshed on session start and after
 *      each agent run. This is purely additive — it does not touch the
 *      Superconductor tab title.
 *   2. Optional tab-title state (opt-in via PI_SC_TAB_TITLE=1). Because the
 *      tab title is user-facing and shared, we only drive it when asked.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ScClient } from "./sc-client.js";

const STATUS_KEY = "superconductor";

interface WorktreeStatus {
	branch?: string;
	target_branch?: string;
	files_changed?: number;
	insertions?: number;
	deletions?: number;
}

export function wireStatus(pi: ExtensionAPI, client: ScClient): void {
	const driveTabTitle = process.env.PI_SC_TAB_TITLE === "1";
	let baseLabel = "SC";

	async function refreshFooter(ctx: { ui: { setStatus(key: string, value?: string): void; hasUI?: boolean } }): Promise<void> {
		const res = await client.worktreeStatus();
		if (!res.ok) return;
		const s = res.response as WorktreeStatus;
		const target = s.target_branch ? `→${s.target_branch}` : "";
		const diff =
			s.files_changed && s.files_changed > 0
				? ` · ${s.files_changed}f +${s.insertions ?? 0} -${s.deletions ?? 0}`
				: "";
		baseLabel = `SC ${target}`.trim();
		ctx.ui.setStatus(STATUS_KEY, `${baseLabel}${diff}`);
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshFooter(ctx as any);
		if (driveTabTitle) await client.tabTitle("● pi idle");
	});

	pi.on("agent_start", async () => {
		if (driveTabTitle) await client.tabTitle("⚡ pi running");
	});

	pi.on("agent_end", async (_event, ctx) => {
		await refreshFooter(ctx as any);
		if (driveTabTitle) await client.tabTitle("✓ pi idle");
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		(ctx as any)?.ui?.setStatus?.(STATUS_KEY, undefined);
	});
}
