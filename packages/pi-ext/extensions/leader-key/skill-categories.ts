import { readFileSync } from "node:fs";
import { parseFrontmatter, type SlashCommandInfo } from "@earendil-works/pi-coding-agent";

export interface SkillCategory {
	id: string;
	label: string;
	order: number;
}

export interface CategorizedSkillCommand {
	command: SlashCommandInfo;
	category: SkillCategory;
}

interface SkillFrontmatter extends Record<string, unknown> {
	metadata?: {
		category?: unknown;
	};
}

type ReadSkill = (path: string) => string;

export const SKILL_CATEGORIES: readonly SkillCategory[] = [
	{ id: "writing-style", label: "Writing & voice", order: 0 },
	{ id: "planning-architecture", label: "Planning & architecture", order: 1 },
	{ id: "development", label: "Development", order: 2 },
	{ id: "review-verification", label: "Review & verification", order: 3 },
	{ id: "visual-media", label: "Visual & media", order: 4 },
	{ id: "browser-automation", label: "Browser & automation", order: 5 },
	{ id: "agent-workspace", label: "Agents & workspace", order: 6 },
];

export const OTHER_SKILL_CATEGORY: SkillCategory = {
	id: "other",
	label: "Other",
	order: SKILL_CATEGORIES.length,
};

const SKILL_CATEGORY_BY_ID = new Map(
	SKILL_CATEGORIES.map((category) => [category.id, category]),
);

export function parseSkillCategory(content: string): string | undefined {
	try {
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);
		const category = frontmatter.metadata?.category;
		return typeof category === "string" && category.length > 0 ? category : undefined;
	} catch {
		return undefined;
	}
}

export function resolveSkillCategory(categoryId: string | undefined): SkillCategory {
	return categoryId ? SKILL_CATEGORY_BY_ID.get(categoryId) ?? OTHER_SKILL_CATEGORY : OTHER_SKILL_CATEGORY;
}

export function categorizeSkillCommands(
	commands: readonly SlashCommandInfo[],
	readSkill: ReadSkill = (path) => readFileSync(path, "utf8"),
): CategorizedSkillCommand[] {
	return commands
		.filter((command) => command.source === "skill")
		.map((command) => {
			let category = OTHER_SKILL_CATEGORY;
			try {
				category = resolveSkillCategory(parseSkillCategory(readSkill(command.sourceInfo.path)));
			} catch {
				// Unreadable or malformed third-party skills remain available under Other.
			}
			return { command, category };
		})
		.sort((left, right) =>
			left.category.order - right.category.order
			|| left.command.name.localeCompare(right.command.name),
		);
}

export function skillCommandLabel(commandName: string): string {
	const prefix = "skill:";
	return commandName.startsWith(prefix) ? commandName.slice(prefix.length) : commandName;
}
