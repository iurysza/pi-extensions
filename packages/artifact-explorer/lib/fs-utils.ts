import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function readJsonFile<T>(path: string): Promise<T> {
	const raw = await readFile(path, "utf8");
	return JSON.parse(raw) as T;
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.tmp.${process.pid}`;
	await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	await rename(tmp, path);
}

export function isTransientRelativePath(relativePath: string): boolean {
	const normalized = relativePath.replaceAll("\\", "/");
	if (normalized.endsWith(".log")) return true;
	if (normalized.endsWith("obsidian_askpass.sh")) return true;
	if (normalized.includes("/cache/")) return true;
	if (normalized.endsWith("/cache")) return true;
	return false;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
