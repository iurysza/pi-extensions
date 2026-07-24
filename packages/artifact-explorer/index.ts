import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./lib/config.js";
import { HELP_TEXT, parseCommandArgs } from "./lib/parse-args.js";
import {
	buildStatusReport,
	formatStatusReport,
	openCurrentProject,
	openHub,
} from "./lib/open-project.js";

export default function artifactExplorer(pi: ExtensionAPI) {
	pi.registerCommand("artifact-explorer", {
		description: "Open or create this project's ai-artifacts Obsidian vault",
		handler: async (args, ctx) => {
			const parsed = parseCommandArgs(args);
			const config = await loadConfig();

			try {
				switch (parsed.kind) {
					case "help":
						ctx.ui.notify(HELP_TEXT, "info");
						return;
					case "unknown":
						ctx.ui.notify(`${HELP_TEXT}\n\nUnknown argument: ${parsed.args}`, "warning");
						return;
					case "status": {
						const report = await buildStatusReport(config, ctx.cwd);
						ctx.ui.notify(formatStatusReport(report), "info");
						return;
					}
					case "hub": {
						const hubRoot = await openHub(config);
						ctx.ui.notify(`Opened Artifact Hub at ${hubRoot}`, "info");
						return;
					}
					case "open": {
						const result = await openCurrentProject(config, ctx.cwd);
						ctx.ui.notify(
							`Opened ${result.repoPath} → ai-artifacts (vault ${result.vaultId})`,
							"info",
						);
						return;
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`artifact-explorer: ${message}`, "error");
			}
		},
	});
}
