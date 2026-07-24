import { createHash } from "node:crypto";

export function projectIdForPath(canonicalPath: string): string {
	return createHash("sha256").update(canonicalPath).digest("hex").slice(0, 16);
}

export function projectNameFromRepo(repoPath: string): string {
	const parts = repoPath.split("/").filter(Boolean);
	return parts.at(-1) ?? "project";
}
