import type { ExtensionAPI, ExtensionContext, InputEventResult } from "@earendil-works/pi-coding-agent";

// Material Design Nerd Font: md-book_cog (U+F168A).
export const SKILL_TAG = "󱚊";
const TAG_PREFIX = `${SKILL_TAG} `;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SELECTED_SKILL = /^(?:󱚊 |\/skill:)([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/;

/** Replace only a selected skill prefix, leaving the user's request intact. */
export function selectSkill(text: string, name: string): string {
	const existing = SELECTED_SKILL.exec(text);
	const request = existing ? text.slice(existing[0].length) : text ? ` ${text}` : " ";
	return `${TAG_PREFIX}${name}${request || " "}`;
}

/** Pi expands /skill:name only at the start of submitted input. */
export function expandSkillTag(text: string, available: ReadonlySet<string>): { text: string } | { error: string } | undefined {
	if (!text.startsWith(SKILL_TAG)) return;
	if (!text.startsWith(TAG_PREFIX)) return { error: "Invalid skill tag. Select a skill again or remove the tag." };
	const match = /^([^\s]+)([\s\S]*)$/.exec(text.slice(TAG_PREFIX.length));
	const name = match?.[1] ?? "";
	const request = match?.[2] ?? "";
	if (!SKILL_NAME.test(name) || !available.has(`skill:${name}`)) {
		return { error: `Unknown skill tag: ${name || "(empty)"}. Select a skill again or remove the tag.` };
	}
	if (!request.trim()) return { text: `/skill:${name}` };
	// Pi's skill parser separates the name at the first literal space, not at a newline.
	return { text: `/skill:${name}${request.startsWith(" ") ? "" : " "}${request}` };
}

/** Reject invalid tags without letting Pi send them as ordinary model input. */
export function handleSkillTagInput(
	text: string,
	pi: Pick<ExtensionAPI, "getCommands">,
	ctx: Pick<ExtensionContext, "ui">,
): InputEventResult {
	if (!text.startsWith(SKILL_TAG)) return { action: "continue" };
	const available = new Set(pi.getCommands().filter((command) => command.source === "skill").map((command) => command.name));
	const result = expandSkillTag(text, available);
	if (!result) return { action: "continue" };
	if ("text" in result) return { action: "transform", text: result.text };
	ctx.ui.notify(result.error, "warning");
	// The core editor clears on Enter before the input event fires. Restore the rejected draft.
	const current = ctx.ui.getEditorText();
	ctx.ui.setEditorText(current ? `${text}\n${current}` : text);
	return { action: "handled" };
}
