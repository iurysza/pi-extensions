import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import type { ProjectRecord, ProjectRegistry } from "./types.js";
import { readJsonFile, writeJsonAtomic } from "./fs-utils.js";
import { getRegistryPath, getStateRoot } from "./paths.js";
import { projectIdForPath, projectNameFromRepo } from "./hash.js";

function emptyRegistry(): ProjectRegistry {
	return { version: 1, projects: {} };
}

export async function loadRegistry(): Promise<ProjectRegistry> {
	const path = getRegistryPath();
	if (!existsSync(path)) {
		return emptyRegistry();
	}
	try {
		const registry = await readJsonFile<ProjectRegistry>(path);
		if (registry.version !== 1 || !registry.projects) {
			return emptyRegistry();
		}
		return registry;
	} catch {
		return emptyRegistry();
	}
}

export async function saveRegistry(registry: ProjectRegistry): Promise<void> {
	await mkdir(getStateRoot(), { recursive: true });
	await writeJsonAtomic(getRegistryPath(), registry);
}

export async function upsertProject(input: {
	repoPath: string;
	artifactPath: string;
	vaultId?: string;
}): Promise<ProjectRecord> {
	const registry = await loadRegistry();
	const id = projectIdForPath(input.artifactPath);
	const now = new Date().toISOString();
	const existing = registry.projects[id];

	const record: ProjectRecord = {
		id,
		name: projectNameFromRepo(input.repoPath),
		repoPath: input.repoPath,
		artifactPath: input.artifactPath,
		vaultId: input.vaultId ?? existing?.vaultId,
		lastOpened: now,
		registeredAt: existing?.registeredAt ?? now,
	};

	registry.projects[id] = record;
	await saveRegistry(registry);
	return record;
}

export function getProject(registry: ProjectRegistry, artifactPath: string): ProjectRecord | undefined {
	return registry.projects[projectIdForPath(artifactPath)];
}
