import type { ParsedCommand } from "./types.js";

export function parseCommandArgs(rawArgs: string): ParsedCommand {
	const trimmed = rawArgs.trim();
	if (!trimmed) return { kind: "open" };

	const parts = trimmed.split(/\s+/);
	const first = parts[0]?.toLowerCase();

	switch (first) {
		case "hub":
			return { kind: "hub" };
		case "status":
			return { kind: "status" };
		case "--help":
		case "-h":
		case "help":
			return { kind: "help" };
		default:
			return { kind: "unknown", args: trimmed };
	}
}

export const HELP_TEXT = `Usage:
  /artifact-explorer            Open current repo's ai-artifacts vault
  /artifact-explorer hub        Open the project launcher hub
  /artifact-explorer status     Show detected paths and Obsidian state
  /artifact-explorer --help     Show this help`;
