import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createTidyExtension,
	type TidyExtensionDependencies,
} from "./tidy/index.js";

const BUILT_INS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

export function createToolPresentation(dependencies: TidyExtensionDependencies = {}) {
	const tidy = createTidyExtension(dependencies);
	return async (pi: ExtensionAPI): Promise<void> => {
		pi.on("session_start", (_event, ctx) => {
			const externalTidyTools = pi.getAllTools().filter((tool) =>
				BUILT_INS.has(tool.name)
				&& /(?:@mobrienv\/)?pi-tidy-tools/i.test(`${tool.sourceInfo.source} ${tool.sourceInfo.path}`),
			);
			if (externalTidyTools.length > 0) {
				ctx.ui.notify(
					"Remove the separate @mobrienv/pi-tidy-tools package; pi-ext now owns compact built-in tool cards.",
					"warning",
				);
			}
		});
		await tidy(pi);
	};
}

export default createToolPresentation();
