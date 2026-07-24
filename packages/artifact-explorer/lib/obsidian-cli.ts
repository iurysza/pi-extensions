import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { ArtifactExplorerConfig } from "./types.js";
import { sleep } from "./fs-utils.js";
import { getObsidianRegistryPath, resolveObsidianBinary } from "./paths.js";

const execFileAsync = promisify(execFile);
const COMMAND_READY_TIMEOUT_MS = 10_000;

export interface ObsidianVaultEntry {
	id: string;
	path: string;
	open?: boolean;
}

export interface ObsidianRegistry {
	vaults: Record<string, { path: string; open?: boolean; ts?: number }>;
	cli?: boolean;
}

export interface ObsidianRunResult {
	stdout: string;
	stderr: string;
	ok: boolean;
	error?: string;
}

function normalizePath(path: string): string {
	return path.replace(/\/+$/, "");
}

export async function readObsidianRegistry(): Promise<ObsidianRegistry> {
	const raw = await readFile(getObsidianRegistryPath(), "utf8");
	return JSON.parse(raw) as ObsidianRegistry;
}

export function findVaultIdByPath(registry: ObsidianRegistry, targetPath: string): string | undefined {
	const normalized = normalizePath(targetPath);
	for (const [id, vault] of Object.entries(registry.vaults ?? {})) {
		if (normalizePath(vault.path) === normalized) {
			return id;
		}
	}
	return undefined;
}

export function listOpenVaultIds(registry: ObsidianRegistry): string[] {
	return Object.entries(registry.vaults ?? {})
		.filter(([, vault]) => vault.open)
		.map(([id]) => id);
}

export function listEvalVaultCandidates(
	registry: ObsidianRegistry,
	preferredPaths: string[],
): string[] {
	const preferredIds = preferredPaths
		.map((path) => findVaultIdByPath(registry, path))
		.filter((id): id is string => Boolean(id));
	const openPreferredIds = preferredIds.filter((id) => registry.vaults[id]?.open);
	const otherOpenIds = listOpenVaultIds(registry).filter(
		(id) => !openPreferredIds.includes(id),
	);
	const closedPreferredIds = preferredIds.filter(
		(id) => !registry.vaults[id]?.open,
	);

	return [...new Set([...openPreferredIds, ...otherOpenIds, ...closedPreferredIds])];
}

export async function runObsidian(
	config: ArtifactExplorerConfig,
	args: string[],
): Promise<ObsidianRunResult> {
	const binary = resolveObsidianBinary(config);
	try {
		const { stdout, stderr } = await execFileAsync(binary, args, {
			encoding: "utf8",
			maxBuffer: 10 * 1024 * 1024,
		});
		const combined = `${stdout}${stderr}`.trim();
		const errorLine = combined
			.split("\n")
			.find((line) => line.startsWith("Error:") || line.startsWith("Vault not found."));
		return {
			stdout: stdout.trim(),
			stderr: stderr.trim(),
			ok: !errorLine,
			error: errorLine,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("Command line interface is not enabled")) {
			return {
				stdout: "",
				stderr: message,
				ok: false,
				error: "Obsidian CLI is disabled. Enable it in Settings → General → Advanced.",
			};
		}
		if (message.includes("ENOENT")) {
			return {
				stdout: "",
				stderr: message,
				ok: false,
				error: `Obsidian CLI not found at ${binary}`,
			};
		}
		return { stdout: "", stderr: message, ok: false, error: message };
	}
}

export function isCommandStillLoading(
	result: ObsidianRunResult,
	command: string,
): boolean {
	return Boolean(
		!result.ok &&
			result.error?.includes(`Command "${command}" not found`) &&
			result.error?.includes("may require a plugin to be enabled"),
	);
}

async function runObsidianWhenReady(
	config: ArtifactExplorerConfig,
	args: string[],
	command: string,
	timeoutMs = COMMAND_READY_TIMEOUT_MS,
): Promise<ObsidianRunResult> {
	const deadline = Date.now() + timeoutMs;
	let result = await runObsidian(config, args);

	while (isCommandStillLoading(result, command) && Date.now() < deadline) {
		await sleep(250);
		result = await runObsidian(config, args);
	}

	return result;
}

async function openRegisteredVault(vaultId: string): Promise<void> {
	await execFileAsync("/usr/bin/open", [
		`obsidian://open?vault=${encodeURIComponent(vaultId)}`,
	]);
}

async function waitForVaultOpen(vaultId: string, timeoutMs = 15_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const registry = await readObsidianRegistry().catch(() => null);
		if (registry?.vaults?.[vaultId]?.open) {
			return true;
		}
		await sleep(250);
	}
	return false;
}

async function ensureRegisteredVaultOpen(vaultId: string): Promise<void> {
	await openRegisteredVault(vaultId);
	if (!(await waitForVaultOpen(vaultId))) {
		throw new Error(`Timed out waiting for Obsidian vault ${vaultId} to open.`);
	}
}

export async function checkObsidianCli(config: ArtifactExplorerConfig): Promise<{
	available: boolean;
	version: string | null;
	error?: string;
}> {
	const help = await runObsidian(config, ["help"]);
	if (!help.ok && help.error?.includes("disabled")) {
		return { available: false, version: null, error: help.error };
	}
	if (!help.ok && help.error?.includes("not found")) {
		return { available: false, version: null, error: help.error };
	}

	const version = await runObsidian(config, ["version"]);
	return {
		available: help.ok || !help.error?.includes("disabled"),
		version: version.ok ? version.stdout : null,
		error: help.error,
	};
}

function buildVaultArgs(vaultId: string, commandArgs: string[]): string[] {
	return [`vault=${vaultId}`, ...commandArgs];
}

export function buildEvalVaultArgs(vaultId: string, code: string): string[] {
	return buildVaultArgs(vaultId, [
		"eval",
		"--allow-focus-steal",
		`code=${code}`,
	]);
}

export function buildOpenVaultBridgeArgs(
	artifactPath: string,
	fromVaultId: string,
): string[] {
	const code = `window.electron.ipcRenderer.sendSync('vault-open', ${JSON.stringify(artifactPath)}, false)`;
	return buildEvalVaultArgs(fromVaultId, code);
}

export function buildPluginCommandArgs(
	vaultId: string,
	command: "plugin:install" | "plugin:enable" | "plugin:reload",
	pluginId: string,
): string[] {
	return buildVaultArgs(vaultId, [
		command,
		"--allow-focus-steal",
		`id=${pluginId}`,
	]);
}

export async function openVaultViaBridge(
	config: ArtifactExplorerConfig,
	artifactPath: string,
	fromVaultId: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildOpenVaultBridgeArgs(artifactPath, fromVaultId),
		"eval",
	);
}

export async function evalInVault(
	config: ArtifactExplorerConfig,
	vaultId: string,
	code: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildEvalVaultArgs(vaultId, code),
		"eval",
	);
}

export async function installPlugin(
	config: ArtifactExplorerConfig,
	vaultId: string,
	pluginId: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildPluginCommandArgs(vaultId, "plugin:install", pluginId),
		"plugin:install",
	);
}

export async function enablePlugin(
	config: ArtifactExplorerConfig,
	vaultId: string,
	pluginId: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildPluginCommandArgs(vaultId, "plugin:enable", pluginId),
		"plugin:enable",
	);
}

export async function reloadPlugin(
	config: ArtifactExplorerConfig,
	vaultId: string,
	pluginId: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildPluginCommandArgs(vaultId, "plugin:reload", pluginId),
		"plugin:reload",
	);
}

export async function closeVaultWindow(
	config: ArtifactExplorerConfig,
	vaultId: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildVaultArgs(vaultId, ["command", "id=workspace:close-window"]),
		"command",
	);
}

export async function loadWorkspace(
	config: ArtifactExplorerConfig,
	vaultId: string,
	name: string,
): Promise<ObsidianRunResult> {
	return runObsidianWhenReady(
		config,
		buildVaultArgs(vaultId, ["workspace:load", `name=${name}`]),
		"workspace:load",
	);
}

export async function waitForVaultByPath(
	targetPath: string,
	timeoutMs = 15000,
): Promise<string | undefined> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (!existsSync(getObsidianRegistryPath())) {
			await sleep(250);
			continue;
		}
		const registry = await readObsidianRegistry();
		const id = findVaultIdByPath(registry, targetPath);
		if (id) return id;
		await sleep(250);
	}
	return undefined;
}

export async function waitForParentClosed(
	parentVaultId: string,
	timeoutMs = 10000,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const registry = await readObsidianRegistry();
		const parent = registry.vaults?.[parentVaultId];
		if (!parent?.open) return true;
		await sleep(250);
	}
	return false;
}

export async function ensureVaultRegistered(
	config: ArtifactExplorerConfig,
	artifactPath: string,
	preferredEvalPaths: string[],
): Promise<string> {
	let vaultId = await waitForVaultByPath(artifactPath, 1000);
	if (vaultId) {
		await ensureRegisteredVaultOpen(vaultId);
		return vaultId;
	}

	let registry = await readObsidianRegistry();
	let candidates = listEvalVaultCandidates(registry, preferredEvalPaths);
	if (candidates.length === 0) {
		await runObsidian(config, ["help"]);
		await sleep(1500);
		registry = await readObsidianRegistry().catch(() => ({ vaults: {} }));
		candidates = listEvalVaultCandidates(registry, preferredEvalPaths);
	}

	let lastError: string | undefined;
	for (const evalVaultId of candidates) {
		try {
			if (!registry.vaults[evalVaultId]?.open) {
				await ensureRegisteredVaultOpen(evalVaultId);
			}
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
			continue;
		}

		const opened = await openVaultViaBridge(config, artifactPath, evalVaultId);
		if (!opened.ok) {
			lastError = opened.error ?? "Failed to register artifact vault through Obsidian bridge.";
			if (isCommandStillLoading(opened, "eval")) {
				continue;
			}
			throw new Error(lastError);
		}

		vaultId = await waitForVaultByPath(artifactPath, 15000);
		if (!vaultId) {
			throw new Error(`Timed out waiting for Obsidian to register ${artifactPath}`);
		}
		await ensureRegisteredVaultOpen(vaultId);
		return vaultId;
	}

	throw new Error(
		lastError ??
			"Obsidian has no ready vault available to register the artifact vault.",
	);
}
