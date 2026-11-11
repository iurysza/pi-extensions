#!/usr/bin/env node
// Installs git hooks that rebuild the startup bundles in a development checkout.
//
// Usage: node scripts/install-bundle-hooks.mjs [--remove]
//
// Writes post-merge and post-checkout into this repository's hooks folder. Each one runs
// `npm run build:bundles` after a pull or a branch switch, so Pi keeps loading from bundles.
// The hook is quiet, runs the build in the background and never fails git. It does nothing in
// a linked worktree or when dependencies are not installed: Pi then loads from source.
// A hook file that this script did not write is left alone, and the script exits 1.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HOOKS = ["post-merge", "post-checkout"];
export const MARKER = "# pi-extensions startup bundles";

export const HOOK = `#!/bin/sh
${MARKER} (written by scripts/install-bundle-hooks.mjs; remove with --remove)
# Rebuilds the bundles after a pull or a branch switch. Quiet, in the background, never fails git.
[ "$(basename "$0")" = post-checkout ] && [ "$3" != 1 ] && exit 0
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ "$(git rev-parse --path-format=absolute --git-dir 2>/dev/null)" = "$common" ] || exit 0
[ -d "$root/node_modules/esbuild" ] || exit 0
( cd "$root" && npm run --silent build:bundles >"$common/prebundle-hook.log" 2>&1 & ) >/dev/null 2>&1
exit 0
`;

function hooksDir(root) {
  return resolve(root, execFileSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: root, encoding: "utf8" }).trim());
}

/** Returns the hook files written. Throws before writing anything if one belongs to someone else. */
export function installHooks(root) {
  const dir = hooksDir(root);
  const files = HOOKS.map(name => join(dir, name));
  const foreign = files.filter(file => existsSync(file) && !readFileSync(file, "utf8").includes(MARKER));

  if (foreign.length > 0) throw new Error(`not replacing existing hook: ${foreign.join(", ")}`);

  mkdirSync(dir, { recursive: true });

  for (const file of files) {
    writeFileSync(file, HOOK);
    chmodSync(file, 0o755);
  }

  return files;
}

/** Removes only the hook files this script wrote. Returns them. */
export function removeHooks(root) {
  const files = HOOKS.map(name => join(hooksDir(root), name)).filter(file => existsSync(file) && readFileSync(file, "utf8").includes(MARKER));

  for (const file of files) rmSync(file);

  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const remove = process.argv.includes("--remove");

  try {
    for (const file of remove ? removeHooks(root) : installHooks(root)) console.log(`${remove ? "removed" : "installed"} ${file}`);
  } catch (error) {
    console.error(`install-bundle-hooks: ${error.message}`);
    process.exit(1);
  }
}
