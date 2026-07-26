import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packagesDir = resolve(root, "packages");
const resourceKinds = ["extensions", "skills", "themes"];
const sourceExtensions = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx"]);
const failures = [];
const machineHomeMarker = `/${["Us", "ers"].join("")}/`;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function normalizedRelativePath(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

function isSafeRelativePath(value) {
  if (typeof value !== "string") return false;
  const normalized = normalizedRelativePath(value);
  return (
    normalized.length > 0 &&
    !isAbsolute(value) &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

function isInside(parent, child) {
  return child === parent || child.startsWith(`${parent}${sep}`);
}

function prefixedResource(packageDir, resource) {
  return `./packages/${packageDir}/${normalizedRelativePath(resource)}`;
}

function coveredByFiles(resource, files) {
  const normalized = normalizedRelativePath(resource);
  return files.some((entry) => {
    const allowed = normalizedRelativePath(entry);
    return normalized === allowed || normalized.startsWith(`${allowed}/`);
  });
}

const rootManifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (rootManifest.name !== "@iurysza/pi-extensions") {
  failures.push('root package name must be "@iurysza/pi-extensions"');
}
if (rootManifest.private !== true) failures.push("root package must be private");
if (Object.hasOwn(rootManifest, "publishConfig")) {
  failures.push("root package must not define publishConfig");
}
if (JSON.stringify(rootManifest.workspaces) !== JSON.stringify(["packages/*"])) {
  failures.push('root workspaces must equal ["packages/*"]');
}

const packageEntries = (await readdir(packagesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name));
const packages = [];
const packageNames = new Map();

for (const entry of packageEntries) {
  const packageDir = resolve(packagesDir, entry.name);
  const manifestPath = resolve(packageDir, "package.json");
  if (!(await exists(manifestPath))) {
    failures.push(`packages/${entry.name} is missing package.json`);
    continue;
  }

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  packages.push({ dir: entry.name, path: packageDir, manifest });

  if (typeof manifest.name !== "string" || manifest.name.length === 0) {
    failures.push(`packages/${entry.name} is missing a package name`);
  } else {
    const previous = packageNames.get(manifest.name);
    if (previous) failures.push(`duplicate package name ${manifest.name}: ${previous}, ${entry.name}`);
    packageNames.set(manifest.name, entry.name);
    if (manifest.name !== `@iurysza/${entry.name}`) {
      failures.push(`packages/${entry.name} must be named @iurysza/${entry.name}`);
    }
  }

  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(manifest.version)) {
    failures.push(`${manifest.name ?? entry.name} is missing a valid version`);
  }

  for (const required of ["README.md", "LICENSE"]) {
    if (!(await exists(resolve(packageDir, required)))) {
      failures.push(`${manifest.name ?? entry.name} is missing ${required}`);
    }
  }

  if (manifest.publishConfig?.access !== "public") {
    failures.push(`${manifest.name ?? entry.name} must set publishConfig.access to public`);
  }
  if (
    manifest.repository?.url !== "git+https://github.com/iurysza/pi-extensions.git" ||
    manifest.repository?.directory !== `packages/${entry.name}`
  ) {
    failures.push(`${manifest.name ?? entry.name} has incorrect repository metadata`);
  }
  const expectedBugs = "https://github.com/iurysza/pi-extensions/issues";
  const expectedHomepage = `https://github.com/iurysza/pi-extensions/tree/main/packages/${entry.name}#readme`;
  if (manifest.bugs?.url !== expectedBugs || manifest.homepage !== expectedHomepage) {
    failures.push(`${manifest.name ?? entry.name} has incorrect bugs or homepage metadata`);
  }

  const keywords = new Set(manifest.keywords ?? []);
  for (const keyword of ["pi-package", "pi-extension"]) {
    if (!keywords.has(keyword)) failures.push(`${manifest.name ?? entry.name} is missing keyword ${keyword}`);
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    failures.push(`${manifest.name ?? entry.name} must define a strict files allowlist`);
    continue;
  }

  const seenFiles = new Set();
  for (const file of manifest.files) {
    if (!isSafeRelativePath(file) || [".", "*"].includes(file)) {
      failures.push(`${manifest.name ?? entry.name} has unsafe files entry: ${file}`);
      continue;
    }
    const normalized = normalizedRelativePath(file);
    if (seenFiles.has(normalized)) failures.push(`${manifest.name ?? entry.name} repeats files entry ${file}`);
    seenFiles.add(normalized);
    const filePath = resolve(packageDir, normalized);
    if (!isInside(packageDir, filePath) || !(await exists(filePath))) {
      failures.push(`${manifest.name ?? entry.name} files entry does not exist: ${file}`);
    }
  }
  for (const required of ["README.md", "LICENSE"]) {
    if (!seenFiles.has(required)) failures.push(`${manifest.name ?? entry.name} files must include ${required}`);
  }

  for (const kind of resourceKinds) {
    const resources = manifest.pi?.[kind] ?? [];
    if (!Array.isArray(resources)) {
      failures.push(`${manifest.name ?? entry.name} pi.${kind} must be an array`);
      continue;
    }
    const seenResources = new Set();
    for (const resource of resources) {
      if (!isSafeRelativePath(resource)) {
        failures.push(`${manifest.name ?? entry.name} has unsafe pi.${kind} path: ${resource}`);
        continue;
      }
      const normalized = normalizedRelativePath(resource);
      if (seenResources.has(normalized)) {
        failures.push(`${manifest.name ?? entry.name} repeats pi.${kind} resource ${resource}`);
      }
      seenResources.add(normalized);
      const resourcePath = resolve(packageDir, normalized);
      if (!isInside(packageDir, resourcePath) || !(await exists(resourcePath))) {
        failures.push(`${manifest.name ?? entry.name} pi.${kind} path does not exist: ${resource}`);
      }
      if (!coveredByFiles(resource, manifest.files)) {
        failures.push(`${manifest.name ?? entry.name} omits pi.${kind} resource from files: ${resource}`);
      }
    }
  }
}

for (const kind of resourceKinds) {
  const actual = rootManifest.pi?.[kind];
  if (!Array.isArray(actual)) {
    failures.push(`root pi.${kind} must be an array`);
    continue;
  }

  const seenActual = new Set();
  for (const resource of actual) {
    if (!isSafeRelativePath(resource) || !resource.startsWith("./packages/")) {
      failures.push(`root pi.${kind} contains an invalid child path: ${resource}`);
      continue;
    }
    const normalized = `./${normalizedRelativePath(resource)}`;
    if (seenActual.has(normalized)) failures.push(`root pi.${kind} repeats ${resource}`);
    seenActual.add(normalized);
    if (!(await exists(resolve(root, normalizedRelativePath(resource))))) {
      failures.push(`root pi.${kind} path does not exist: ${resource}`);
    }
  }

  const expected = new Set();
  for (const pkg of packages) {
    for (const resource of pkg.manifest.pi?.[kind] ?? []) {
      const prefixed = prefixedResource(pkg.dir, resource);
      if (expected.has(prefixed)) failures.push(`child pi.${kind} union repeats ${prefixed}`);
      expected.add(prefixed);
    }
  }
  for (const missing of [...expected].filter((resource) => !seenActual.has(resource))) {
    failures.push(`root pi.${kind} is missing ${missing}`);
  }
  for (const extra of [...seenActual].filter((resource) => !expected.has(resource))) {
    failures.push(`root pi.${kind} has extra resource ${extra}`);
  }
}

for (const file of await walk(packagesDir)) {
  const name = file.split(sep).at(-1);
  if (["package-lock.json", "npm-shrinkwrap.json"].includes(name)) {
    failures.push(`nested lockfile is forbidden: ${relative(root, file)}`);
  }
}

for (const file of await walk(root)) {
  if (file === resolve(root, "package-lock.json")) continue;
  const info = await stat(file);
  if (info.size > 1_000_000) continue;
  const buffer = await readFile(file);
  if (buffer.includes(0)) continue;
  const text = buffer.toString("utf8");
  const displayPath = relative(root, file);
  if (text.includes(machineHomeMarker)) {
    failures.push(`hard-coded machine home path in ${displayPath}`);
  }
  const extension = `.${file.split(".").at(-1)}`;
  if (sourceExtensions.has(extension) && /@mariozechner\/pi-|@sinclair\/typebox/.test(text)) {
    failures.push(`obsolete Pi import in ${displayPath}`);
  }
}

if (failures.length > 0) {
  console.error(`Catalog check failed:\n- ${failures.join("\n- ")}`);
  process.exitCode = 1;
} else {
  console.log(`Catalog checks passed (${packages.length} packages).`);
}
