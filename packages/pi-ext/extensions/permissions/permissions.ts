/**
 * Permissions Extension — 3-mode system
 *
 * Modes:
 *   yolo      — All commands allowed without checks
 *   safe      — Permission rules active (ask for unknown bash commands)
 *   read-only — No repo/home writes, built-in write/edit allowed only in /tmp,
 *               bash restricted to safe read-only commands
 *
 * Commands:
 *   /mode [yolo|safe|read-only]  — Switch mode
 *
 * Settings:
 *   ~/.pi/agent/permissions.json       (global: mode + rules)
 *   .agents/permissions.json           (project: rules only)
 *
 * Rule evaluation (safe mode):
 *   project rules → global user rules → built-in rules
 *   First match wins. See rules.ts to add new permissions.
 */

import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import type { BashRule, PermissionMode } from "./types.js";
import { ALL_MODES, MODE_DESCRIPTIONS } from "./types.js";
import { BUILTIN_RULES } from "./rules.js";
import { CD_PREFIX_RE, findMatchingRule, isReadSafeBash } from "./matching.js";
import {
	PERMISSION_REQUEST_EVENT,
	PERMISSION_RESOLVED_EVENT,
	type PermissionRequestPayload,
} from "./events.js";
import { loadProjectRules, loadSettings, normalizeMode, saveSettings } from "./settings.js";

export type { PermissionMode } from "./types.js";

function isTmpPath(path: string, cwd: string): boolean {
	const absolutePath = resolve(cwd, path);
	return absolutePath === "/tmp" || absolutePath.startsWith("/tmp/");
}

/**
 * Evaluate whether a tool call should be allowed, blocked, or needs confirmation.
 *
 * This is the ONE place all permission decisions flow through.
 */
async function evaluateToolCall(
	toolName: string,
	input: Record<string, unknown>,
	mode: PermissionMode,
	ctx: ExtensionContext,
	notifyPermission?: {
		onRequest: (payload: PermissionRequestPayload) => void;
		onResolved: (payload: PermissionRequestPayload & { response: "allow" | "reject" }) => void;
	},
): Promise<undefined | { block: true; reason: string }> {
	if (mode === "read-only") {
		if (toolName === "write" || toolName === "edit") {
			const path = input.path as string;
			if (isTmpPath(path, ctx.cwd)) return undefined;
			return {
				block: true,
				reason: `Read-only mode: file writes are blocked outside /tmp. Use /mode to change.\nPath: ${path}`,
			};
		}
		if (toolName === "bash") {
			const command = input.command as string;
			if (!isReadSafeBash(command)) {
				return {
					block: true,
					reason: `Read-only mode: command not in safe list. Use /mode to change.\nCommand: ${command}`,
				};
			}
		}
		return undefined;
	}

	if (mode === "yolo") return undefined;

	if (toolName !== "bash") return undefined;

	const command = input.command as string;
	const stripped = command.trim().replace(CD_PREFIX_RE, "").trim();

	const settings = loadSettings();
	const projectRules = loadProjectRules(ctx.cwd);
	const allRules: BashRule[] = [...projectRules, ...(settings.rules ?? []), ...BUILTIN_RULES];

	const match = findMatchingRule(allRules, stripped);
	if (!match) return undefined;

	switch (match.action) {
		case "allow":
			return undefined;
		case "deny":
			return { block: true, reason: "Denied by permission rules" };
		case "ask": {
			if (!ctx.hasUI) {
				return { block: true, reason: "Command requires confirmation (no UI available)" };
			}

			const payload: PermissionRequestPayload = {
				sessionId: ctx.sessionManager.getSessionId(),
				cwd: ctx.cwd,
				toolName,
				input,
			};

			notifyPermission?.onRequest(payload);

			const choice = await ctx.ui.select(
				`⚠️  Permission required:\n\n  ${command}\n\nAllow? (Use /mode to switch modes)`,
				["Yes", "No"],
			);
			if (choice !== "Yes") {
				notifyPermission?.onResolved({ ...payload, response: "reject" });
				ctx.abort();
				return { block: true, reason: "Blocked by user" };
			}
			notifyPermission?.onResolved({ ...payload, response: "allow" });
			return undefined;
		}
	}
}

let permissionMode: PermissionMode = normalizeMode(loadSettings().mode);

export default function (pi: ExtensionAPI) {
	function setMode(mode: PermissionMode, ctx: ExtensionContext): void {
		permissionMode = mode;
		const current = loadSettings();
		saveSettings({ ...current, mode });
		pi.events.emit("mode:change", mode);
		ctx.ui.notify(`Mode: ${mode.toUpperCase()} — ${MODE_DESCRIPTIONS[mode]}`);
	}

	async function modeHandler(args: string | undefined, ctx: ExtensionContext): Promise<void> {
		const arg = args?.trim().toLowerCase();
		if (arg && ALL_MODES.includes(arg as PermissionMode)) {
			setMode(arg as PermissionMode, ctx);
			return;
		}

		const labels = ALL_MODES.map(
			(m) => `${m === permissionMode ? "● " : "  "}${m.toUpperCase()} — ${MODE_DESCRIPTIONS[m]}`,
		);
		const choice = await ctx.ui.select("Select mode:", labels);
		if (!choice) return;

		const selected = ALL_MODES.find((m) => choice.includes(m.toUpperCase()));
		if (selected) setMode(selected, ctx);
	}

	pi.registerCommand("mode", {
		description: "Switch permission mode (yolo/safe/read-only)",
		getArgumentCompletions: (prefix: string) => {
			const items = ALL_MODES.map((m) => ({
				value: m,
				label: `${m.toUpperCase()} — ${MODE_DESCRIPTIONS[m]}`,
			}));
			const filtered = items.filter((i) => i.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => modeHandler(args, ctx),
	});

	pi.registerCommand("permissions", {
		description: "Switch permission mode (alias for /mode)",
		handler: async (args, ctx) => modeHandler(args, ctx),
	});

	pi.on("session_start", async (_event, _ctx) => {
		pi.events.emit("mode:change", permissionMode);
	});

	pi.on("tool_call", async (event, ctx) => {
		return evaluateToolCall(event.toolName, event.input, permissionMode, ctx, {
			onRequest: (payload) => {
				pi.events.emit(PERMISSION_REQUEST_EVENT, payload);
			},
			onResolved: (payload) => {
				pi.events.emit(PERMISSION_RESOLVED_EVENT, payload);
			},
		});
	});
}
