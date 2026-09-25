#!/usr/bin/env node
// Downloads the Claude Code binary the contract lane is pinned to into .cache/ and prints its path.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "2.1.282";
const platform = process.env.PI_CLAUDE_CODE_CONTRACT_PLATFORM ?? `${process.platform}-${process.arch}`;
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(packageRoot, ".cache", `claude-code-${platform}-${VERSION}`);
const binary = join(target, "package", "claude");

if (!existsSync(binary)) {
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	const spec = `@anthropic-ai/claude-code-${platform}@${VERSION}`;
	execFileSync("npm", ["pack", spec, "--pack-destination", target, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
	const tarball = readdirSync(target).find((name) => name.endsWith(".tgz"));
	if (!tarball) throw new Error(`npm pack ${spec} produced no tarball`);
	execFileSync("tar", ["-xzf", join(target, tarball), "-C", target]);
	rmSync(join(target, tarball));
	if (!existsSync(binary)) throw new Error(`${spec} has no package/claude binary`);
}

process.stdout.write(`${binary}\n`);
