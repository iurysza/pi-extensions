/**
 * Settings persistence for the permissions extension.
 *
 * Global:  ~/.pi/agent/permissions.json   { mode, rules }
 * Project: .agents/permissions.json       { rules }
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { BashRule, PermissionMode, PermissionSettings } from "./types.js";

export const SETTINGS_PATH = join(homedir(), ".pi", "agent", "permissions.json");

/** Load global permission settings from ~/.pi/agent/permissions.json. */
export function loadSettings(): PermissionSettings {
	try {
		return JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as PermissionSettings;
	} catch {
		return {};
	}
}

/** Atomically write global settings via tmp + rename. */
export function saveSettings(settings: PermissionSettings): void {
	const dir = dirname(SETTINGS_PATH);
	mkdirSync(dir, { recursive: true });
	const tmp = `${SETTINGS_PATH}.tmp.${process.pid}`;
	writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
	renameSync(tmp, SETTINGS_PATH);
}

/** Load project-local rules from .agents/permissions.json (rules only, no mode). */
export function loadProjectRules(cwd: string): BashRule[] {
	try {
		const path = resolve(cwd, ".agents", "permissions.json");
		const data = JSON.parse(readFileSync(path, "utf8")) as PermissionSettings;
		return data.rules ?? [];
	} catch {
		return [];
	}
}

/** Normalize raw mode strings (including legacy aliases) to a valid PermissionMode. */
export function normalizeMode(raw: string | undefined): PermissionMode {
	if (raw === "enabled") return "safe";
	if (raw === "read") return "read-only"; // backward compat
	if (raw === "plan") return "safe";
	if (raw === "yolo" || raw === "safe" || raw === "read-only") return raw;
	return "safe";
}
