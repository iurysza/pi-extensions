import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	DefaultResourceLoader,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
	type ResourceCollision,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

// Explicit catalog from iurysza/agent-skills, not a general collision policy.
export const OWNED_SKILLS: ReadonlySet<string> = new Set([
	"audio-transcribe", "better-ui", "brainstorming", "bro", "chatgpt-imagegen",
	"coding-standards", "deslopify", "domain-modeling", "gemini-tts", "goal",
	"readback", "rephrase", "reply-bro", "setup-goal", "skill-cleaner",
	"strunk-writing-quality", "tech-spec", "technical-writing", "tool-install", "type-breakdown",
]);

type SkillsResult = ReturnType<DefaultResourceLoader["getSkills"]>;
type GetSkills = DefaultResourceLoader["getSkills"];

function isUnder(file: string, directory: string): boolean {
	if (!isAbsolute(file)) return false;
	const path = relative(resolve(directory), resolve(file));
	return path !== "" && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function selectSkillConflicts(
	result: SkillsResult,
	globalDirectories = [join(getAgentDir(), "skills"), join(homedir(), ".agents", "skills")],
): { result: SkillsResult; conflicts: ResourceCollision[] } {
	const conflicts: ResourceCollision[] = [];
	const diagnostics = result.diagnostics.filter((diagnostic) => {
		const collision = diagnostic.collision;
		if (diagnostic.type !== "collision" || !collision || collision.resourceType !== "skill"
			|| !OWNED_SKILLS.has(collision.name)) return true;
		// Check lexical paths first: global skills are commonly symlinks into the collection.
		if (!globalDirectories.some((directory) =>
			isUnder(collision.winnerPath, directory) || isUnder(collision.loserPath, directory))) return true;
		try {
			if (!readFileSync(collision.winnerPath).equals(readFileSync(collision.loserPath))) return true;
		} catch {
			return true;
		}
		conflicts.push(collision);
		return false;
	});
	return {
		result: conflicts.length ? { ...result, diagnostics } : result,
		conflicts,
	};
}

// Shared across factory reloads, including reloads that leave another wrapper above ours.
const HOOK = Symbol.for("iurysza.skill-conflicts.getSkills");
type HookState = {
	original: GetSkills;
	wrapper: GetSkills;
	owner: symbol;
	view?: (result: SkillsResult) => SkillsResult;
};
type HookTarget = { getSkills: GetSkills; [HOOK]?: HookState };

export function installSkillViewHook(
	prototype: Pick<DefaultResourceLoader, "getSkills">,
	view: (result: SkillsResult) => SkillsResult,
) {
	const target = prototype as HookTarget;
	const owner = Symbol();
	let state = target[HOOK];
	if (!state) {
		const original = target.getSkills;
		const wrapper = function (this: DefaultResourceLoader) {
			const result = original.call(this);
			try {
				return shared.view ? shared.view(result) : result;
			} catch {
				// Presentation must never break discovery or hide diagnostics on failure.
				return result;
			}
		};
		const shared: HookState = { original, wrapper, owner };
		state = shared;
		Object.defineProperty(target, HOOK, { value: shared, configurable: true });
		target.getSkills = shared.wrapper;
	}
	state.owner = owner;
	state.view = view;
	const shared = state;
	return {
		isCurrent: () => shared.owner === owner && shared.view === view,
		dispose() {
			if (shared.owner !== owner || shared.view !== view) return;
			shared.view = undefined;
			// Never remove someone else's wrapper. An enclosed hook becomes inert instead.
			if (target.getSkills === shared.wrapper) {
				target.getSkills = shared.original;
				delete target[HOOK];
			}
		},
	};
}

const WIDGET = "skill-conflicts";
const plain = (value: string) => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");

export default function skillConflicts(pi: ExtensionAPI) {
	let ctx: ExtensionContext | undefined;
	let latest: SkillsResult | undefined;
	let conflicts: ResourceCollision[] = [];
	let mounted = false;
	let expanded = false;
	let toolsExpanded = false;
	let requestRender: (() => void) | undefined;

	function syncExpansion() {
		const current = ctx!.ui.getToolsExpanded();
		if (current !== toolsExpanded) expanded = current;
		toolsExpanded = current;
	}

	function toggle() {
		syncExpansion();
		expanded = !expanded;
		requestRender?.();
	}

	function update(next: ResourceCollision[]) {
		if (!ctx) return;
		const changed = next.length !== conflicts.length || next.some((item, index) => item !== conflicts[index]);
		conflicts = next;
		if (!conflicts.length) {
			if (mounted) ctx.ui.setWidget(WIDGET, undefined);
			mounted = false;
			requestRender = undefined;
			return;
		}
		if (mounted) {
			if (changed) requestRender?.();
			return;
		}
		ctx.ui.setWidget(WIDGET, (tui) => {
			requestRender = () => tui.requestRender();
			return {
				render(width: number) {
					if (width <= 0) return [];
					syncExpansion();
					// Read the current theme on every render, including after invalidation.
					const theme = ctx!.ui.theme;
					const title = `${expanded ? "▾" : "▸"} Skill conflicts · ${conflicts.length}`;
					const lines = [truncateToWidth(theme.fg("muted", title), width, "")];
					if (expanded) {
						for (const conflict of conflicts) {
							for (const [role, text] of [
								["accent", `  ${plain(conflict.name)}`],
								["dim", `  Chosen: ${plain(conflict.winnerPath)}`],
								["dim", `  Skipped: ${plain(conflict.loserPath)}`],
							] as const) {
								lines.push(...wrapTextWithAnsi(theme.fg(role, text), width)
									.map((line) => truncateToWidth(line, width, "")));
							}
						}
					}
					return lines;
				},
				// Structural typing keeps compatibility with the older development Pi TUI.
				handleMouse(event: { type: string; button: string; x: number; y: number; width: number }) {
					if (event.type !== "click" || event.button !== "left" || event.y !== 0
						|| event.x < 0 || event.x >= event.width) return;
					toggle();
					return { handled: true, render: true };
				},
				invalidate() {},
			};
		}, { placement: "aboveEditor" });
		mounted = true;
	}

	// Pi calls getSkills before session_start. Remember it, but pass through until TUI is confirmed.
	const hook = installSkillViewHook(DefaultResourceLoader.prototype, (result) => {
		latest = result;
		if (!ctx) return result;
		const selected = selectSkillConflicts(result);
		update(selected.conflicts);
		return selected.result;
	});

	pi.on("session_start", (_event, context) => {
		if (!hook.isCurrent() || context.mode !== "tui") return;
		ctx = context;
		try {
			toolsExpanded = ctx.ui.getToolsExpanded();
			if (latest) update(selectSkillConflicts(latest).conflicts);
		} catch {
			ctx = undefined;
		}
	});

	pi.registerCommand("skill-conflicts", {
		description: "Expand or collapse identical owned skill conflicts",
		handler: async (_args, context) => {
			if (!hook.isCurrent() || context.mode !== "tui" || !ctx) return;
			if (!conflicts.length) {
				context.ui.notify("No identical owned skill conflicts. Other warnings remain in Pi's diagnostics.", "info");
				return;
			}
			toggle();
		},
	});

	pi.on("session_shutdown", () => {
		if (!hook.isCurrent()) return;
		try {
			if (mounted) ctx?.ui.setWidget(WIDGET, undefined);
		} finally {
			ctx = undefined;
			latest = undefined;
			conflicts = [];
			requestRender = undefined;
			hook.dispose();
		}
	});
}
