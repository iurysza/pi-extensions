/**
 * Command pattern-matching helpers.
 *
 * Pure functions with no side effects — easy to unit test.
 */

import type { BashRule } from "./types.js";
import { READ_SAFE_PATTERNS } from "./rules.js";

/** Strips a leading `cd …&&` prefix from a command. */
export const CD_PREFIX_RE = /^cd[^;&]*?&&\s*/;

const WRITE_INDICATORS = /(?<![<])[^<]>(?!>)|>>|\btee\b|\bdd\b/;
const DESTRUCTIVE_IN_FIND = /\s(-delete|-exec|-execdir)\b/;

/** Convert a glob pattern (with `*`) to a RegExp. */
export function globToRegex(glob: string): RegExp {
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

/** Extract the first word of a command, stripping any `cd …&&` prefix. */
export function getBaseCommand(command: string): string {
	return command.trim().replace(CD_PREFIX_RE, "").trim().split(/\s+/)[0] ?? "";
}

/** Test whether `command` matches a single glob or /regex/flags pattern. */
export function matchesPattern(pattern: string, command: string): boolean {
	if (pattern === "*") return true;

	// "/regex/flags" string form
	const regexMatch = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
	if (regexMatch) {
		try {
			return new RegExp(regexMatch[1], regexMatch[2]).test(command);
		} catch {
			return false;
		}
	}

	return globToRegex(pattern).test(command);
}

/** Find the first rule whose patterns match `command`. Returns null if none match. */
export function findMatchingRule(rules: BashRule[], command: string): BashRule | null {
	for (const rule of rules) {
		if (rule.patterns.some((p) => matchesPattern(p, command))) {
			return rule;
		}
	}
	return null;
}

/** Check whether a command is safe for read-only mode (no writes, no destructive ops). */
export function isReadSafeBash(command: string): boolean {
	if (WRITE_INDICATORS.test(command)) return false;
	if (/^\s*find\b/.test(command) && DESTRUCTIVE_IN_FIND.test(command)) return false;

	const stripped = command.trim().replace(CD_PREFIX_RE, "").trim();
	const parts = stripped.split(/\s*\|\s*/);
	return parts.every((part) => READ_SAFE_PATTERNS.some((p) => p.test(part.trim())));
}
