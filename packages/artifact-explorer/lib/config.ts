import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ArtifactExplorerConfig } from "./types.js";
import { defaultConfig, getConfigPath } from "./paths.js";

export async function loadConfig(): Promise<ArtifactExplorerConfig> {
	const defaults = defaultConfig();
	const path = getConfigPath();
	if (!existsSync(path)) {
		return defaults;
	}

	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<ArtifactExplorerConfig>;
		return {
			sourceProfilePath: parsed.sourceProfilePath ?? defaults.sourceProfilePath,
			obsidianBinary: parsed.obsidianBinary ?? defaults.obsidianBinary,
			artifactWorkspaceName: parsed.artifactWorkspaceName ?? defaults.artifactWorkspaceName,
			hubWorkspaceName: parsed.hubWorkspaceName ?? defaults.hubWorkspaceName,
		};
	} catch {
		return defaults;
	}
}
