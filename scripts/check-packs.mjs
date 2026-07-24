import { readdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagesDir = resolve(root, "packages");
const entries = await readdir(packagesDir, { withFileTypes: true });
const manifests = [];

for (const entry of entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  try {
    const manifest = JSON.parse(await readFile(resolve(packagesDir, entry.name, "package.json"), "utf8"));
    if (!manifest.private) manifests.push(manifest.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

for (const name of manifests) {
  console.log(`Checking ${name}`);
  execFileSync("npm", ["pack", "--dry-run", "--json", "--workspace", name], {
    cwd: root,
    stdio: "inherit",
  });
}

console.log(`Pack bootstrap checks passed (${manifests.length} publishable workspace${manifests.length === 1 ? "" : "s"}).`);
