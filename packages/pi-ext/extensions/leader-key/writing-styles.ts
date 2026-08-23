import { readFileSync } from "node:fs";
import { parseFrontmatter, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";

const WRITING_STYLE_CATEGORY = "writing-style";
const SKILL_COMMAND_PREFIX = "skill:";

type ReadSkill = (path: string) => string;

interface WritingStyleFrontmatter extends Record<string, unknown> {
	metadata?: {
		category?: unknown;
	};
}

export function hasWritingStyleMetadata(content: string): boolean {
	try {
		const { frontmatter } = parseFrontmatter<WritingStyleFrontmatter>(content);
		return frontmatter.metadata?.category === WRITING_STYLE_CATEGORY;
	} catch {
		return false;
	}
}

export function writingStyleLabel(commandName: string): string {
	return commandName.startsWith(SKILL_COMMAND_PREFIX)
		? commandName.slice(SKILL_COMMAND_PREFIX.length)
		: commandName;
}

export function findWritingStyleCommands(
	commands: readonly SlashCommandInfo[],
	readSkill: ReadSkill = (path) => readFileSync(path, "utf8"),
): SlashCommandInfo[] {
	return commands.filter((command) => {
		if (command.source !== "skill") return false;

		try {
			return hasWritingStyleMetadata(readSkill(command.sourceInfo.path));
		} catch {
			return false;
		}
	});
}
