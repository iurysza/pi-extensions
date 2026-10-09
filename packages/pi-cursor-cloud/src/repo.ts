import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

/** Accept GitHub origins, never credentials, arbitrary hosts, or local paths. */
export function originToHttps(origin: string): string {
  const value = origin.trim();
  const match = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([\w.-]+)\/([\w.-]+?)\/?$/.exec(value);
  if (!match) throw new Error("Expected a GitHub repository URL, for example https://github.com/owner/repo.");
  const repo = match[2].replace(/\.git$/, "");
  if ([match[1], repo].some(s => !s || s === "." || s === "..")) throw new Error("Invalid GitHub repository URL.");
  return `https://github.com/${match[1]}/${repo}`;
}

export type Git = (cwd: string, args: string[]) => Promise<string>;
const git: Git = async (cwd, args) => (await exec("git", args, { cwd, timeout: 5000, maxBuffer: 64 * 1024 })).stdout.trim();

export async function resolveRepo(cwd: string, repo?: string, ref?: string, runGit: Git = git): Promise<{ repo: string; ref: string }> {
  let origin: string | undefined;
  try { origin = originToHttps(await runGit(cwd, ["remote", "get-url", "origin"])); } catch { /* Explicit repo also works outside git. */ }
  const url = repo ? originToHttps(repo) : origin;
  if (!url) throw new Error("No GitHub origin found. Pass repo explicitly to cursor_cloud_spawn.");
  if (ref !== undefined) {
    if (!ref.trim() || ref.startsWith("-") || /[\x00-\x20\x7f]/.test(ref)) throw new Error("Invalid repository ref.");
    return { repo: url, ref };
  }
  let branch = "main";
  // A different explicit repository cannot inherit this checkout's branch.
  if (url === origin) {
    try {
      const current = await runGit(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
      await runGit(cwd, ["show-ref", "--verify", `refs/remotes/origin/${current}`]);
      branch = current;
    } catch { /* Unpushed or detached branch: use main. */ }
  }
  return { repo: url, ref: branch };
}
