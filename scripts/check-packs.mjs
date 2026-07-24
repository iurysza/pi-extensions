import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagesDir = resolve(root, "packages");
const failures = [];
const forbidden = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)npm-shrinkwrap\.json$/,
  /(^|\/)AGENTS\.md$/,
  /(^|\/)AINE-PLAN\.md$/,
  /(^|\/)tsconfig(?:\.[^/]+)?\.json$/,
  /(^|\/)(?:tests?|plans?|ai-artifacts|openspec)(?:\/|$)/,
  /\.(?:test|spec)\.[cm]?[jt]sx?$/,
];

function normalized(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function coveredByAllowlist(path, allowlist) {
  if (path === "package.json") return true;
  return allowlist.some((entry) => {
    const allowed = normalized(entry);
    return path === allowed || path.startsWith(`${allowed}/`);
  });
}

function resourceIncluded(resource, packedFiles) {
  const path = normalized(resource);
  return packedFiles.has(path) || [...packedFiles].some((file) => file.startsWith(`${path}/`));
}

const entries = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));

for (const entry of entries) {
  const packageDir = resolve(packagesDir, entry.name);
  const manifest = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
  if (manifest.private) continue;

  console.log(`Checking ${manifest.name}`);
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", "--workspace", manifest.name],
    { cwd: root, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    failures.push(`${manifest.name} npm pack failed: ${(result.stderr || result.stdout).trim()}`);
    continue;
  }

  let report;
  try {
    [report] = JSON.parse(result.stdout);
  } catch {
    failures.push(`${manifest.name} returned invalid npm pack JSON`);
    continue;
  }
  const packedFiles = new Set((report.files ?? []).map((file) => normalized(file.path)));
  const allowlist = manifest.files ?? [];

  for (const path of packedFiles) {
    if (!coveredByAllowlist(path, allowlist)) {
      failures.push(`${manifest.name} packs file outside its allowlist: ${path}`);
    }
    if (forbidden.some((pattern) => pattern.test(path))) {
      failures.push(`${manifest.name} packs forbidden development file: ${path}`);
    }
  }

  for (const required of ["package.json", "README.md", "LICENSE"]) {
    if (!packedFiles.has(required)) failures.push(`${manifest.name} tarball is missing ${required}`);
  }
  for (const kind of ["extensions", "skills", "themes"]) {
    for (const resource of manifest.pi?.[kind] ?? []) {
      if (!resourceIncluded(resource, packedFiles)) {
        failures.push(`${manifest.name} tarball omits pi.${kind} resource ${resource}`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error(`Pack checks failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Pack checks passed (${entries.length} publishable workspaces).`);
}
