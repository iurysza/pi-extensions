/**
 * Pi Skills Provider
 *
 * Browse available skills with SKILL.md preview.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../clipboard.js";

interface SkillInfo {
	name: string;
	description: string;
	path: string;
	scope: "project" | "user" | "global";
}

function extractDescription(content: string): string {
	const lines = content.split("\n");
	if (lines[0]?.trim() === "---") {
		const endIdx = lines.indexOf("---", 1);
		if (endIdx > 0) {
			for (let i = 1; i < endIdx; i++) {
				const match = lines[i]?.match(/^description:\s*(.+)/i);
				if (match) return match[1]!.replace(/^["']|["']$/g, "").trim();
			}
		}
	}
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
		return trimmed.slice(0, 100);
	}
	return "(no description)";
}

function scanSkillDir(dir: string, scope: SkillInfo["scope"]): SkillInfo[] {
	const skills: SkillInfo[] = [];
	if (!existsSync(dir)) return skills;

	try {
		for (const entry of readdirSync(dir)) {
			const skillFile = join(dir, entry, "SKILL.md");
			if (!existsSync(skillFile)) continue;
			try {
				const content = readFileSync(skillFile, "utf-8");
				skills.push({
					name: entry,
					description: extractDescription(content),
					path: skillFile,
					scope,
				});
			} catch {}
		}
	} catch {}
	return skills;
}

function loadAllSkills(cwd: string): SkillInfo[] {
	const home = process.env.HOME ?? "~";
	const all: SkillInfo[] = [];

	// Project skills
	all.push(...scanSkillDir(join(cwd, ".pi/skills"), "project"));
	all.push(...scanSkillDir(join(cwd, "skills"), "project"));

	// User skills
	all.push(...scanSkillDir(join(home, ".pi/agent/skills"), "user"));

	// Package skills
	try {
		const piExtSkills = join(dirname(dirname(dirname(import.meta.url.replace("file://", "")))), "skills");
		all.push(...scanSkillDir(piExtSkills, "global"));
	} catch {}

	// Global git skills
	const gitSkillsBase = join(home, ".pi/agent/git");
	if (existsSync(gitSkillsBase)) {
		try {
			for (const org of readdirSync(gitSkillsBase)) {
				const orgPath = join(gitSkillsBase, org);
				for (const repo of readdirSync(orgPath)) {
					const repoPath = join(orgPath, repo);
					all.push(...scanSkillDir(join(repoPath, "skills"), "global"));
				}
			}
		} catch {}
	}

	// Deduplicate by name
	const seen = new Set<string>();
	return all.filter((s) => {
		if (seen.has(s.name)) return false;
		seen.add(s.name);
		return true;
	});
}

export function createSkillsProvider(cwd: string): TelescopeProvider<SkillInfo> {
	return {
		name: "skills",
		icon: "📚",
		description: "Pi skills",

		load() {
			return loadAllSkills(cwd);
		},

		getSearchText(item) {
			return `${item.name} ${item.description}`;
		},

		getDisplayText(item, theme) {
			const scopeBadge =
				item.scope === "project" ? theme.fg("success", "P")
				: item.scope === "user" ? theme.fg("warning", "U")
				: theme.fg("dim", "G");
			return `[${scopeBadge}] ${theme.bold(item.name)} ${theme.fg("dim", item.description)}`;
		},

		async onSelect(item, ctx) {
			ctx.ui.pasteToEditor(`/skill:${item.name} `);
		},

		getPreview(item, maxLines) {
			try {
				const content = readFileSync(item.path, "utf-8");
				return content.split("\n").slice(0, maxLines);
			} catch {
				return ["(no preview)"];
			}
		},

		getFrecencyKey(item) {
			return item.name;
		},

		actions: [
			{ key: "c", label: "Copy path", description: "Copy SKILL.md path to clipboard" },
		],

		onAction(actionKey, items) {
			if (actionKey === "c") {
				copyToClipboard(items.map((i) => i.path).join("\n"));
			}
		},
	};
}
