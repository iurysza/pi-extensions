/**
 * pi-superconductor: native Superconductor integration for pi.
 *
 * Superconductor launches pi inside managed worktrees + terminal sessions and
 * exposes everything through the `sc` CLI (backed by the local API socket).
 * This extension surfaces that to pi:
 *
 *   - Status:   footer pill with target branch + diff size (+ optional tab title)
 *   - Tools:    superconductor_worktree (status/diff/target branch + create worktree)
 *   - Commands: /sc-fork (fork into a new terminal split), /sc-worktree (new worktree)
 *
 * Gracefully degrades: if not running inside Superconductor, it is a no-op.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ScClient } from "./sc-client.js";
import { wireStatus } from "./status.js";
import { wireTools } from "./tools.js";
import { wireCommands } from "./commands.js";

export default function (pi: ExtensionAPI) {
	const client = new ScClient();

	// Not inside Superconductor — do nothing.
	if (!client.available) return;

	wireStatus(pi, client);
	wireTools(pi, client);
	wireCommands(pi, client);
}
