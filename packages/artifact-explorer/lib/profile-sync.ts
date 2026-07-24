import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { existsSync } from "node:fs";
import {
	isTransientRelativePath,
	readJsonFile,
	writeJsonAtomic,
} from "./fs-utils.js";
import { getConfigPath, getWorkspaceOverlayRoot, WORKSPACE_OWNED_FILES } from "./paths.js";

export const VAULT_NICKNAME_PLUGIN_ID = "vault-nickname";

async function listNames(dir: string): Promise<string[]> {
	try {
		return await readdir(dir);
	} catch {
		return [];
	}
}

async function copyFileIfChanged(source: string, target: string): Promise<void> {
	const { dirname } = await import("node:path");
	await mkdir(dirname(target), { recursive: true });
	await cp(source, target, { force: true });
}

async function syncDirectory(sourceDir: string, targetDir: string, filter?: (rel: string) => boolean): Promise<void> {
	await mkdir(targetDir, { recursive: true });
	const entries = await listNames(sourceDir);

	for (const name of entries) {
		const sourcePath = join(sourceDir, name);
		const targetPath = join(targetDir, name);
		const rel = relative(sourceDir, sourcePath);
		if (filter && !filter(rel)) continue;

		const info = await stat(sourcePath);
		if (info.isDirectory()) {
			await syncDirectory(sourcePath, targetPath, filter);
			continue;
		}
		if (info.isFile()) {
			await copyFileIfChanged(sourcePath, targetPath);
		}
	}
}

async function removeExtraPluginDirs(sourcePluginsDir: string, targetPluginsDir: string): Promise<void> {
	const sourcePlugins = new Set(await listNames(sourcePluginsDir));
	const targetPlugins = await listNames(targetPluginsDir);

	for (const plugin of targetPlugins) {
		if (
			!sourcePlugins.has(plugin) &&
			plugin !== VAULT_NICKNAME_PLUGIN_ID
		) {
			await rm(join(targetPluginsDir, plugin), { recursive: true, force: true });
		}
	}
}

export async function mergeCorePluginsWorkspaces(corePluginsPath: string): Promise<void> {
	let parsed: Record<string, boolean> = {};
	if (existsSync(corePluginsPath)) {
		parsed = await readJsonFile<Record<string, boolean>>(corePluginsPath);
	}
	parsed.workspaces = true;
	await writeFile(corePluginsPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export async function applyWorkspaceOverlay(targetObsidianDir: string, overlayRoot: string): Promise<void> {
	const overlayWorkspaces = join(overlayRoot, "workspaces.json");
	const targetWorkspaces = join(targetObsidianDir, "workspaces.json");

	if (!existsSync(overlayWorkspaces)) {
		throw new Error(`Missing workspace overlay at ${overlayWorkspaces}`);
	}

	if (!existsSync(targetWorkspaces)) {
		await cp(overlayWorkspaces, targetWorkspaces);
		return;
	}

	const overlay = await readJsonFile<{ workspaces?: Record<string, unknown>; active?: string }>(overlayWorkspaces);
	const target = await readJsonFile<{ workspaces?: Record<string, unknown>; active?: string }>(targetWorkspaces);
	target.workspaces ??= {};

	for (const [name, layout] of Object.entries(overlay.workspaces ?? {})) {
		if (!target.workspaces[name]) {
			target.workspaces[name] = layout;
		}
	}

	if (!target.active && overlay.active) {
		target.active = overlay.active;
	}

	await writeFile(targetWorkspaces, `${JSON.stringify(target, null, 2)}\n`, "utf8");
}

export function artifactVaultNickname(projectName: string): string {
	return `${projectName} · AI Artifacts`;
}

export async function writeVaultNickname(
	targetObsidianDir: string,
	nickname: string,
): Promise<void> {
	const pluginDir = join(
		targetObsidianDir,
		"plugins",
		VAULT_NICKNAME_PLUGIN_ID,
	);
	await mkdir(pluginDir, { recursive: true });
	await writeJsonAtomic(join(pluginDir, "data-shared.json"), { nickname });

	const communityPluginsPath = join(
		targetObsidianDir,
		"community-plugins.json",
	);
	let enabledPlugins: string[] = [];
	if (existsSync(communityPluginsPath)) {
		const parsed = await readJsonFile<unknown>(communityPluginsPath);
		if (Array.isArray(parsed)) {
			enabledPlugins = parsed.filter(
				(plugin): plugin is string => typeof plugin === "string",
			);
		}
	}
	if (!enabledPlugins.includes(VAULT_NICKNAME_PLUGIN_ID)) {
		enabledPlugins.push(VAULT_NICKNAME_PLUGIN_ID);
	}
	await writeJsonAtomic(communityPluginsPath, enabledPlugins);
}

export async function syncProfileFromSource(sourceProfilePath: string, targetObsidianDir: string): Promise<void> {
	if (!sourceProfilePath) {
		throw new Error(`Configure sourceProfilePath in ${getConfigPath()}`);
	}
	if (!existsSync(sourceProfilePath)) {
		throw new Error(`Source profile not found: ${sourceProfilePath}`);
	}

	await mkdir(targetObsidianDir, { recursive: true });

	const sourceEntries = await listNames(sourceProfilePath);
	for (const name of sourceEntries) {
		if (WORKSPACE_OWNED_FILES.has(name)) continue;

		const sourcePath = join(sourceProfilePath, name);
		const targetPath = join(targetObsidianDir, name);
		const info = await stat(sourcePath);

		if (name === "plugins" && info.isDirectory()) {
			await syncDirectory(sourcePath, targetPath, (rel) => !isTransientRelativePath(rel));
			await removeExtraPluginDirs(sourcePath, targetPath);
			continue;
		}

		if (info.isDirectory()) {
			await syncDirectory(sourcePath, targetPath, (rel) => !isTransientRelativePath(rel));
			continue;
		}

		if (info.isFile()) {
			if (isTransientRelativePath(name)) continue;
			await copyFileIfChanged(sourcePath, targetPath);
		}
	}

	await mergeCorePluginsWorkspaces(join(targetObsidianDir, "core-plugins.json"));
	await applyWorkspaceOverlay(targetObsidianDir, getWorkspaceOverlayRoot());
}

export async function ensureMinimalObsidianDir(targetObsidianDir: string): Promise<void> {
	await mkdir(targetObsidianDir, { recursive: true });
	const appJson = join(targetObsidianDir, "app.json");
	if (!existsSync(appJson)) {
		await writeFile(appJson, "{}\n", "utf8");
	}
}
