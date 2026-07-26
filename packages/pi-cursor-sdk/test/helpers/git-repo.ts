import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeCursorCloudGitEnvironment } from "../../src/cursor-cloud-local-state.js";

export function runGit(cwd: string, args: string[]): string {
	return execFileSync("git", args, {
		cwd,
		env: sanitizeCursorCloudGitEnvironment(),
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

export function initTrackedGitRepo(cwd: string, remoteUrl = "https://github.com/example/repo.git"): void {
	runGit(cwd, ["init"]);
	runGit(cwd, ["config", "user.email", "test@example.com"]);
	runGit(cwd, ["config", "user.name", "Test User"]);
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "file.txt"), "base");
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-m", "base"]);
	runGit(cwd, ["branch", "-M", "main"]);
	runGit(cwd, ["remote", "add", "origin", remoteUrl]);
	runGit(cwd, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
	runGit(cwd, ["branch", "--set-upstream-to=origin/main"]);
}
