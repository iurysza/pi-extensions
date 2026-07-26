import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const packageRoot = resolve(import.meta.dirname, "..");
const localModules = join(packageRoot, "node_modules");
const createdLinks = [];

function findPackageRoot(entry, expectedName) {
  let current = dirname(entry);
  while (current !== dirname(current)) {
    const manifestPath = join(current, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === expectedName) return current;
    }
    current = dirname(current);
  }
  throw new Error(`Could not find ${expectedName} package root`);
}

function linkPackage(name, target) {
  const link = join(localModules, ...name.split("/"));
  if (existsSync(link) || (() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) return;
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  createdLinks.push(link);
}

const cursorSdkRoot = findPackageRoot(require.resolve("@cursor/sdk"), "@cursor/sdk");
const vitestRoot = dirname(require.resolve("vitest/package.json"));
linkPackage("@cursor/sdk", cursorSdkRoot);
linkPackage("vitest", vitestRoot);

const gitHome = mkdtempSync(join(tmpdir(), "pi-cursor-sdk-git-"));
const gitConfig = join(gitHome, "config");
writeFileSync(gitConfig, "");

try {
  const result = spawnSync(process.execPath, [join(vitestRoot, "vitest.mjs"), "run"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: gitConfig,
      HOME: gitHome,
      USERPROFILE: gitHome,
      XDG_CONFIG_HOME: gitHome,
    },
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  for (const link of createdLinks.reverse()) rmSync(link, { force: true, recursive: true });
  rmSync(gitHome, { force: true, recursive: true });
}
