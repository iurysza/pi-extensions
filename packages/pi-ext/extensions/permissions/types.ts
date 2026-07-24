/** Shared types for the permissions extension. */

export type PermissionMode = "yolo" | "safe" | "read-only";

export const ALL_MODES: PermissionMode[] = ["yolo", "safe", "read-only"];

export const MODE_DESCRIPTIONS: Record<PermissionMode, string> = {
	yolo: "All commands allowed, no checks",
	safe: "Permission rules active",
	"read-only": "Read-only, no writes except /tmp",
};

/**
 * A single bash permission rule.
 *
 * To add a new permission, append a BashRule to BUILTIN_RULES in rules.ts
 * or add it to ~/.pi/agent/permissions.json / .agents/permissions.json:
 *
 *   { "action": "allow", "patterns": ["my-tool *", "my-other-tool *"] }
 */
export interface BashRule {
	action: "allow" | "ask" | "deny";
	/** Glob patterns (use * for wildcard) or /regex/flags strings. */
	patterns: string[];
}

/** Settings persisted to ~/.pi/agent/permissions.json */
export interface PermissionSettings {
	mode?: string;
	rules?: BashRule[];
}
