import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArtifactExplorerConfig } from "./types.js";

function getAgentDir(): string {
	return process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
}

export const ARTIFACT_DIR_NAME = "ai-artifacts";
export const WORKSPACE_NAME = "AI Artifacts";
export const HUB_WORKSPACE_NAME = "Artifact Hub";

export const WORKSPACE_OWNED_FILES = new Set([
	"workspace.json",
	"workspace-mobile.json",
	"workspace",
	"workspaces.json",
]);

export function getExtensionRoot(): string {
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

export function getStateRoot(): string {
	return join(getAgentDir(), "artifact-explorer");
}

export function getConfigPath(): string {
	return join(getStateRoot(), "config.json");
}

export function getRegistryPath(): string {
	return join(getStateRoot(), "projects.json");
}

export function getHubRoot(): string {
	return join(getStateRoot(), "hub");
}

export function getWorkspaceOverlayRoot(): string {
	return join(getExtensionRoot(), "workspace-overlay", ".obsidian");
}

export function getObsidianRegistryPath(): string {
	return join(
		process.env.HOME ?? "~",
		"Library",
		"Application Support",
		"obsidian",
		"obsidian.json",
	);
}

export function artifactPathForRepo(repoPath: string): string {
	return join(repoPath, ARTIFACT_DIR_NAME);
}

export function gitExcludePath(repoPath: string): string {
	return join(repoPath, ".git", "info", "exclude");
}

export function defaultConfig(): ArtifactExplorerConfig {
	return {
		sourceProfilePath: "",
		obsidianBinary: "obsidian",
		artifactWorkspaceName: WORKSPACE_NAME,
		hubWorkspaceName: HUB_WORKSPACE_NAME,
	};
}

export function resolveObsidianBinary(config: ArtifactExplorerConfig): string {
	if (existsSync(config.obsidianBinary)) {
		return config.obsidianBinary;
	}
	return "obsidian";
}
