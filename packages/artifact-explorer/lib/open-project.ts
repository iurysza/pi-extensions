import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ArtifactExplorerConfig, ProjectRegistry, StatusReport } from "./types.js";
import {
	artifactVaultNickname,
	ensureMinimalObsidianDir,
	syncProfileFromSource,
	VAULT_NICKNAME_PLUGIN_ID,
	writeVaultNickname,
} from "./profile-sync.js";
import { loadRegistry, upsertProject } from "./registry.js";
import {
	checkObsidianCli,
	closeVaultWindow,
	enablePlugin,
	ensureVaultRegistered,
	evalInVault,
	findVaultIdByPath,
	installPlugin,
	loadWorkspace,
	readObsidianRegistry,
	reloadPlugin,
	waitForParentClosed,
} from "./obsidian-cli.js";
import { ensureArtifactDirectory, ensureGitExclude, findGitRoot, isObsidianVault } from "./git.js";
import { artifactPathForRepo, getHubRoot } from "./paths.js";
import { projectIdForPath, projectNameFromRepo } from "./hash.js";

async function ensureVaultNickname(
	config: ArtifactExplorerConfig,
	vaultId: string,
	targetObsidianDir: string,
	nickname: string,
): Promise<void> {
	const pluginManifest = join(
		targetObsidianDir,
		"plugins",
		VAULT_NICKNAME_PLUGIN_ID,
		"manifest.json",
	);

	if (!existsSync(pluginManifest)) {
		const installed = await installPlugin(
			config,
			vaultId,
			VAULT_NICKNAME_PLUGIN_ID,
		);
		if (!installed.ok) {
			throw new Error(
				installed.error ?? "Failed to install the Vault Nickname plugin.",
			);
		}
	}

	await writeVaultNickname(targetObsidianDir, nickname);

	const enabled = await enablePlugin(
		config,
		vaultId,
		VAULT_NICKNAME_PLUGIN_ID,
	);
	const alreadyEnabled = enabled.error?.includes(
		`Plugin "${VAULT_NICKNAME_PLUGIN_ID}" is already enabled`,
	);
	if (!enabled.ok && !alreadyEnabled) {
		throw new Error(
			enabled.error ?? "Failed to enable the Vault Nickname plugin.",
		);
	}

	const reloaded = await reloadPlugin(
		config,
		vaultId,
		VAULT_NICKNAME_PLUGIN_ID,
	);
	if (!reloaded.ok) {
		throw new Error(
			reloaded.error ?? "Failed to apply the artifact vault nickname.",
		);
	}

	const initialized = await evalInVault(
		config,
		vaultId,
		`(() => {
			const plugin = app.plugins.plugins[${JSON.stringify(VAULT_NICKNAME_PLUGIN_ID)}];
			if (!plugin) throw new Error("Vault Nickname is not loaded");
			if (!plugin.desktopVaultSwitcherElement && typeof plugin.onLayoutReady === "function") {
				plugin.onLayoutReady();
			}
			if (!plugin.desktopVaultSwitcherElement) {
				throw new Error("Vault Nickname switcher UI did not initialize");
			}
			return true;
		})()`,
	);
	if (!initialized.ok) {
		throw new Error(
			initialized.error ?? "Failed to initialize the nickname vault switcher.",
		);
	}
}

async function ensureHubVault(config: ArtifactExplorerConfig): Promise<string> {
	const hubRoot = getHubRoot();
	await mkdir(hubRoot, { recursive: true });
	const hubObsidian = join(hubRoot, ".obsidian");
	await ensureMinimalObsidianDir(hubObsidian);

	if (!existsSync(join(hubObsidian, "community-plugins.json"))) {
		await syncProfileFromSource(config.sourceProfilePath, hubObsidian);
		await writeHubWorkspace(hubObsidian, config.hubWorkspaceName);
	}

	return hubRoot;
}

async function writeHubWorkspace(hubObsidianDir: string, workspaceName: string): Promise<void> {
	const workspacesPath = join(hubObsidianDir, "workspaces.json");
	const layout = {
		workspaces: {
			[workspaceName]: {
				main: {
					id: "hub-main",
					type: "split",
					children: [
						{
							id: "hub-tabs",
							type: "tabs",
							children: [
								{
									id: "hub-index-leaf",
									type: "leaf",
									state: {
										type: "markdown",
										state: {
											file: "index.md",
											mode: "source",
											source: false,
										},
										icon: "lucide-file",
										title: "Artifact Hub",
									},
								},
							],
						},
					],
					direction: "vertical",
				},
				left: {
					id: "hub-left",
					type: "split",
					children: [
						{
							id: "hub-left-tabs",
							type: "tabs",
							children: [
								{
									id: "hub-explorer",
									type: "leaf",
									state: {
										type: "file-explorer",
										state: {
											sortOrder: "alphabetical",
											autoReveal: true,
										},
										icon: "lucide-folder-closed",
										title: "Files",
									},
								},
							],
						},
					],
					direction: "horizontal",
					width: 280,
				},
				active: "hub-index-leaf",
			},
		},
		active: workspaceName,
	};

	await writeFile(workspacesPath, `${JSON.stringify(layout, null, 2)}\n`, "utf8");
}

function formatProjectNote(project: {
	id: string;
	name: string;
	repoPath: string;
	artifactPath: string;
	lastOpened: string;
	available: boolean;
	vaultId?: string;
}): string {
	const openLink = project.vaultId
		? `obsidian://open?vault=${project.vaultId}`
		: `obsidian://open?path=${encodeURIComponent(project.artifactPath)}`;
	const status = project.available ? "available" : "missing";

	return `---
project_id: ${project.id}
repo: ${JSON.stringify(project.repoPath)}
artifact_path: ${JSON.stringify(project.artifactPath)}
last_opened: ${project.lastOpened}
status: ${status}
---

# ${project.name}

- Repository: \`${project.repoPath}\`
- Artifacts: \`${project.artifactPath}\`
- Last opened: ${project.lastOpened}
- Status: ${status}

[Open artifact vault](${openLink})
`;
}

export async function renderHubNotes(registry: ProjectRegistry): Promise<void> {
	const hubRoot = getHubRoot();
	const projectsDir = join(hubRoot, "projects");
	await mkdir(projectsDir, { recursive: true });

	const lines: string[] = [
		"# Artifact Explorer Hub",
		"",
		"Registered projects with isolated `ai-artifacts` vaults.",
		"",
	];

	const sorted = Object.values(registry.projects).sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));

	for (const project of sorted) {
		const available = existsSync(project.artifactPath);
		const notePath = join(projectsDir, `${project.id}.md`);
		await writeFile(
			notePath,
			formatProjectNote({
				id: project.id,
				name: project.name,
				repoPath: project.repoPath,
				artifactPath: project.artifactPath,
				lastOpened: project.lastOpened,
				available,
				vaultId: project.vaultId,
			}),
			"utf8",
		);

		const suffix = available ? "" : " (missing)";
		lines.push(`- [[projects/${project.id}|${project.name}]]${suffix}`);
	}

	if (sorted.length === 0) {
		lines.push("_No projects registered yet. Run `/artifact-explorer` inside a Git repository._");
	}

	await writeFile(join(hubRoot, "index.md"), `${lines.join("\n")}\n`, "utf8");
}

export async function openHub(config: ArtifactExplorerConfig): Promise<string> {
	const hubRoot = await ensureHubVault(config);
	const registry = await loadRegistry();
	await renderHubNotes(registry);

	const hubVaultId = await ensureVaultRegistered(config, hubRoot, [
		hubRoot,
		config.sourceProfilePath.replace(/\/\.obsidian\/?$/, ""),
	]);

	await ensureVaultNickname(
		config,
		hubVaultId,
		join(hubRoot, ".obsidian"),
		"Artifact Hub",
	);

	const loaded = await loadWorkspace(config, hubVaultId, config.hubWorkspaceName);
	if (!loaded.ok) {
		throw new Error(loaded.error ?? `Failed to load hub workspace ${config.hubWorkspaceName}`);
	}

	return hubRoot;
}

export async function openCurrentProject(
	config: ArtifactExplorerConfig,
	cwd: string,
): Promise<{ repoPath: string; artifactPath: string; vaultId: string }> {
	const repoPath = await findGitRoot(cwd);
	const artifactPath = await ensureArtifactDirectory(repoPath);
	await ensureGitExclude(repoPath);

	const targetObsidian = join(artifactPath, ".obsidian");
	await ensureMinimalObsidianDir(targetObsidian);
	await syncProfileFromSource(config.sourceProfilePath, targetObsidian);

	const preferredEvalPaths = [
		artifactPath,
		repoPath,
		config.sourceProfilePath.replace(/\/\.obsidian\/?$/, ""),
	];

	const vaultId = await ensureVaultRegistered(config, artifactPath, preferredEvalPaths);

	await ensureVaultNickname(
		config,
		vaultId,
		targetObsidian,
		artifactVaultNickname(projectNameFromRepo(repoPath)),
	);

	if (isObsidianVault(repoPath)) {
		const registry = await readObsidianRegistry();
		const parentVaultId = findVaultIdByPath(registry, repoPath);
		if (parentVaultId && parentVaultId !== vaultId && registry.vaults?.[parentVaultId]?.open) {
			const closed = await closeVaultWindow(config, parentVaultId);
			if (!closed.ok) {
				throw new Error(
					closed.error ??
						"Could not close the parent vault window. Close it manually, then rerun /artifact-explorer.",
				);
			}
			const confirmed = await waitForParentClosed(parentVaultId);
			if (!confirmed) {
				throw new Error(
					"Parent vault window is still open. Close it manually to avoid nested-vault conflicts.",
				);
			}
		}
	}

	const workspace = await loadWorkspace(config, vaultId, config.artifactWorkspaceName);
	if (!workspace.ok) {
		throw new Error(workspace.error ?? `Failed to load workspace ${config.artifactWorkspaceName}`);
	}

	await upsertProject({ repoPath, artifactPath, vaultId });
	return { repoPath, artifactPath, vaultId };
}

export async function buildStatusReport(config: ArtifactExplorerConfig, cwd: string): Promise<StatusReport> {
	const cli = await checkObsidianCli(config);
	let gitRoot: string | null = null;
	let artifactPath: string | null = null;
	let projectId: string | null = null;
	let artifactInitialized = false;
	let registered = false;
	let isParentVault = false;
	let vaultId: string | null = null;

	try {
		gitRoot = await findGitRoot(cwd);
		artifactPath = artifactPathForRepo(gitRoot);
		projectId = projectIdForPath(artifactPath);
		artifactInitialized = existsSync(join(artifactPath, ".obsidian"));
		isParentVault = isObsidianVault(gitRoot);

		const registry = await loadRegistry();
		registered = Boolean(registry.projects[projectId]);

		if (artifactInitialized) {
			const obsidianRegistry = await readObsidianRegistry().catch(() => null);
			if (obsidianRegistry) {
				vaultId = findVaultIdByPath(obsidianRegistry, artifactPath) ?? null;
			}
		}
	} catch {
		// leave defaults
	}

	return {
		gitRoot,
		artifactPath,
		projectId,
		artifactInitialized,
		registered,
		isParentVault,
		obsidianCliAvailable: cli.available,
		obsidianVersion: cli.version,
		vaultId,
	};
}

export function formatStatusReport(report: StatusReport): string {
	return [
		"Artifact Explorer status",
		"",
		`Git root: ${report.gitRoot ?? "(not in a Git repository)"}`,
		`Artifact path: ${report.artifactPath ?? "(unknown)"}`,
		`Project ID: ${report.projectId ?? "(unknown)"}`,
		`Artifact vault initialized: ${report.artifactInitialized ? "yes" : "no"}`,
		`Registered in hub: ${report.registered ? "yes" : "no"}`,
		`Parent Obsidian vault: ${report.isParentVault ? "yes" : "no"}`,
		`Obsidian CLI: ${report.obsidianCliAvailable ? "available" : "unavailable"}`,
		`Obsidian version: ${report.obsidianVersion ?? "(unknown)"}`,
		`Obsidian vault ID: ${report.vaultId ?? "(not registered)"}`,
	].join("\n");
}
