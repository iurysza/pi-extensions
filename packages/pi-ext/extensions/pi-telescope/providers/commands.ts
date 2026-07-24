/**
 * Pi Commands Provider
 *
 * Browse all available pi commands (extensions, skills, prompts).
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { TelescopeProvider } from "../types.js";
import { copyToClipboard } from "../clipboard.js";

interface CommandInfo {
	name: string;
	description: string;
	source: string;
	scope: string;
}

export function createCommandsProvider(pi: ExtensionAPI): TelescopeProvider<CommandInfo> {
	return {
		name: "commands",
		icon: "⚡",
		description: "Pi commands",

		load() {
			const commands = pi.getCommands();
			return commands.map((cmd) => ({
				name: cmd.name,
				description: cmd.description ?? "",
				source: cmd.source,
				scope: cmd.sourceInfo.scope,
			}));
		},

		getSearchText(item) {
			return `${item.name} ${item.description}`;
		},

		getDisplayText(item, theme) {
			const sourceBadge =
				item.source === "extension" ? theme.fg("accent", "ext")
				: item.source === "skill" ? theme.fg("warning", "skill")
				: theme.fg("dim", "prompt");
			return `[${sourceBadge}] /${theme.bold(item.name)} ${theme.fg("dim", item.description)}`;
		},

		async onSelect(item, ctx) {
			ctx.ui.setEditorText(`/${item.name}`);
			setTimeout(() => process.stdin.emit("data", "\r"), 0);
		},

		getPreview(item) {
			const lines = [
				`Command: /${item.name}`,
				`Source: ${item.source}`,
				`Scope: ${item.scope}`,
				"",
				item.description || "(no description)",
			];
			return lines;
		},

		getFrecencyKey(item) {
			return item.name;
		},

		actions: [
			{ key: "c", label: "Copy command", description: "Copy /command to clipboard" },
		],

		onAction(actionKey, items) {
			if (actionKey === "c") {
				copyToClipboard(items.map((i) => `/${i.name}`).join("\n"));
			}
		},
	};
}
