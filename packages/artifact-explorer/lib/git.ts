import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { artifactPathForRepo, gitExcludePath } from "./paths.js";

const execFileAsync = promisify(execFile);

const EXCLUDE_LINE = "/ai-artifacts/.obsidian/";

export async function findGitRoot(cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
		cwd,
	});
	return stdout.trim();
}

export async function ensureArtifactDirectory(repoPath: string): Promise<string> {
	const artifactPath = artifactPathForRepo(repoPath);
	const stats = await lstat(artifactPath).catch(() => null);
	if (stats?.isFile()) {
		throw new Error(`Expected a directory but found a file at ${artifactPath}`);
	}
	if (stats?.isSymbolicLink()) {
		throw new Error(`Symlinked ai-artifacts paths are not supported: ${artifactPath}`);
	}
	if (!stats) {
		await mkdir(artifactPath, { recursive: true });
	}
	return artifactPath;
}

export async function ensureGitExclude(repoPath: string): Promise<void> {
	const excludePath = gitExcludePath(repoPath);
	const parent = dirname(excludePath);
	await mkdir(parent, { recursive: true });

	let content = "";
	try {
		content = await readFile(excludePath, "utf8");
	} catch {
		content = "";
	}

	if (content.split("\n").some((line) => line.trim() === EXCLUDE_LINE)) {
		return;
	}

	const suffix = content.endsWith("\n") || content.length === 0 ? "" : "\n";
	await writeFile(excludePath, `${content}${suffix}${EXCLUDE_LINE}\n`, "utf8");
}

export function isObsidianVault(path: string): boolean {
	return existsSync(join(path, ".obsidian"));
}
