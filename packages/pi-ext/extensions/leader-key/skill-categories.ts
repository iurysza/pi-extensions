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
	order: Number.MAX_SAFE_INTEGER,
};

const SKILL_CATEGORY_BY_ID = new Map(
	SKILL_CATEGORIES.map((category) => [category.id, category]),
);

function categoryLabel(categoryId: string): string {
	const words = categoryId.split(/[^a-zA-Z0-9]+/).filter(Boolean);
	return words.length > 0
		? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(" ")
		: categoryId;
}

function dynamicSkillCategory(categoryId: string, order: number): SkillCategory {
	return { id: categoryId, label: categoryLabel(categoryId), order };
}

export function parseSkillCategory(content: string): string | undefined {
	try {
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(content);
		const category = frontmatter.metadata?.category;
		return typeof category === "string" ? category.trim() || undefined : undefined;
	} catch {
		return undefined;
	}
}

export function resolveSkillCategory(categoryId: string | undefined): SkillCategory {
	if (!categoryId || categoryId === OTHER_SKILL_CATEGORY.id) return OTHER_SKILL_CATEGORY;
	return SKILL_CATEGORY_BY_ID.get(categoryId)
		?? dynamicSkillCategory(categoryId, SKILL_CATEGORIES.length);
}

export function categorizeSkillCommands(
	commands: readonly SlashCommandInfo[],
	readSkill: ReadSkill = (path) => readFileSync(path, "utf8"),
): CategorizedSkillCommand[] {
	const skillCommands = commands
		.filter((command) => command.source === "skill")
		.map((command) => {
			try {
				return { command, categoryId: parseSkillCategory(readSkill(command.sourceInfo.path)) };
			} catch {
				// Unreadable or malformed third-party skills remain available under Other.
				return { command, categoryId: undefined };
			}
		});

	const dynamicCategories = new Map(
		[...new Set(skillCommands.map(({ categoryId }) => categoryId))]
			.filter((categoryId): categoryId is string =>
				categoryId !== undefined
				&& categoryId !== OTHER_SKILL_CATEGORY.id
				&& !SKILL_CATEGORY_BY_ID.has(categoryId),
			)
			.sort((left, right) => left.localeCompare(right))
			.map((categoryId, index) => [
				categoryId,
				dynamicSkillCategory(categoryId, SKILL_CATEGORIES.length + index),
			]),
	);

	return skillCommands
		.map(({ command, categoryId }) => ({
			command,
			category: categoryId
				? dynamicCategories.get(categoryId) ?? resolveSkillCategory(categoryId)
				: OTHER_SKILL_CATEGORY,
		}))
		.sort((left, right) =>
			left.category.order - right.category.order
			|| left.command.name.localeCompare(right.command.name),
		);
}

export function skillCommandLabel(commandName: string): string {
	const prefix = "skill:";
	return commandName.startsWith(prefix) ? commandName.slice(prefix.length) : commandName;
}
