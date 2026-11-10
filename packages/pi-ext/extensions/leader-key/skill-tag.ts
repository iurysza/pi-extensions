import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";
import { type AutocompleteItem, type AutocompleteProvider, fuzzyFilter } from "@earendil-works/pi-tui";

/** `/` is for commands, `$` is for skills: `$pr-review check this` runs /skill:pr-review. */
export const SKILL_TAG = "$";
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SELECTED_SKILL = /^(?:\$|\/skill:)([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;
/** Pi loads a skill only from the start of a message, so `$` completes only there. */
const SKILL_TRIGGER = /^\$([a-z0-9-]*)$/;
const MAX_SUGGESTIONS = 30;

export type SkillInfo = { readonly name: string; readonly description?: string };

/** Replace only a selected skill prefix, leaving the user's request intact. */
export function selectSkill(text: string, name: string): string {
	const existing = SELECTED_SKILL.exec(text);
	const request = existing ? text.slice(existing[0].length) : text ? ` ${text}` : " ";
	return `${SKILL_TAG}${name}${request || " "}`;
}

/**
 * Turn `$name request` into Pi's `/skill:name request`. Anything that does not
 * name a known skill is left alone, so `$HOME` or `$5` reach the model as typed.
 */
export function expandSkillTag(text: string, available: ReadonlySet<string>): { text: string } | undefined {
	const match = /^\$([^\s]+)([\s\S]*)$/.exec(text);
	if (!match) return;
	const name = match[1] ?? "";
	const request = match[2] ?? "";
	if (!SKILL_NAME.test(name) || !available.has(`skill:${name}`)) return;
	if (!request.trim()) return { text: `/skill:${name}` };
	// Pi's skill parser separates the name at the first literal space, not at a newline.
	return { text: `/skill:${name}${request.startsWith(" ") ? "" : " "}${request}` };
}

function skills(pi: Pick<ExtensionAPI, "getCommands">): SkillInfo[] {
	return pi.getCommands()
		.filter((command) => command.source === "skill" && command.name.startsWith("skill:"))
		.map((command) => ({ name: command.name.slice("skill:".length), description: command.description }));
}

export function handleSkillTagInput(text: string, pi: Pick<ExtensionAPI, "getCommands">): InputEventResult {
	if (!text.startsWith(SKILL_TAG)) return { action: "continue" };
	const available = new Set(skills(pi).map((skill) => `skill:${skill.name}`));
	const result = expandSkillTag(text, available);
	return result ? { action: "transform", text: result.text } : { action: "continue" };
}

/** Rows for a `$…` token at the start of the first line, or null when there is none. */
export function skillSuggestions(all: readonly SkillInfo[], lines: string[], cursorLine: number, cursorCol: number) {
	if (cursorLine !== 0) return null;
	const match = SKILL_TRIGGER.exec((lines[0] ?? "").slice(0, cursorCol));
	if (!match) return null;
	const typed = match[1] ?? "";
	const sorted = [...all].sort((a, b) => a.name.localeCompare(b.name));
	const matches = typed ? fuzzyFilter(sorted, typed, (skill) => skill.name) : sorted;
	const items: AutocompleteItem[] = matches.slice(0, MAX_SUGGESTIONS).map((skill) => ({
		value: `${SKILL_TAG}${skill.name}`,
		label: `${SKILL_TAG}${skill.name}`,
		...(skill.description ? { description: skill.description } : {}),
	}));
	return items.length ? { items, prefix: `${SKILL_TAG}${typed}` } : null;
}

/** Wrap Pi's autocomplete so `$` at the start of a message lists skills. */
export function createSkillProvider(current: AutocompleteProvider, list: () => readonly SkillInfo[]): AutocompleteProvider {
	return {
		triggerCharacters: [SKILL_TAG],
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			return skillSuggestions(list(), lines, cursorLine, cursorCol)
				?? current.getSuggestions(lines, cursorLine, cursorCol, options);
		},
		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			if (!prefix.startsWith(SKILL_TAG) || !item.value.startsWith(SKILL_TAG)) {
				return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
			}
			const line = lines[cursorLine] ?? "";
			const before = line.slice(0, cursorCol - prefix.length);
			const after = line.slice(cursorCol).replace(/^ /, "");
			const next = [...lines];
			next[cursorLine] = `${before}${item.value} ${after}`;
			return { lines: next, cursorLine, cursorCol: before.length + item.value.length + 1 };
		},
		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export function registerSkillPicker(pi: Pick<ExtensionAPI, "getCommands">, ctx: Pick<ExtensionContext, "ui">): void {
	ctx.ui.addAutocompleteProvider((current) => createSkillProvider(current, () => skills(pi)));
}
