import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const failures = [];

if (manifest.name !== "@iurysza/pi-extensions") {
  failures.push('root package name must be "@iurysza/pi-extensions"');
}
if (manifest.private !== true) {
  failures.push("root package must be private");
}
if (Object.hasOwn(manifest, "publishConfig")) {
  failures.push("root package must not define publishConfig");
}
if (JSON.stringify(manifest.workspaces) !== JSON.stringify(["packages/*"])) {
  failures.push('root workspaces must equal ["packages/*"]');
}

for (const kind of ["extensions", "skills", "themes"]) {
  const resources = manifest.pi?.[kind];
  if (!Array.isArray(resources)) {
    failures.push(`root pi.${kind} must be an array`);
    continue;
  }

  const seen = new Set();
  for (const resource of resources) {
    if (typeof resource !== "string" || !resource.startsWith("./packages/")) {
      failures.push(`root pi.${kind} contains an invalid child path: ${resource}`);
      continue;
    }
    if (seen.has(resource)) failures.push(`root pi.${kind} repeats ${resource}`);
    seen.add(resource);
  }
}

if (failures.length > 0) {
  console.error(`Catalog check failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log("Catalog bootstrap checks passed.");
}
