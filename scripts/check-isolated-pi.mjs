#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

const repoRoot = fs.realpathSync(process.argv[2] || ".");
const cwd = fs.realpathSync(process.argv[3] || process.cwd());
const agentDir = process.env.PI_CODING_AGENT_DIR;

if (!agentDir) throw new Error("PI_CODING_AGENT_DIR is required");

const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const settingsManager = SettingsManager.create(cwd, agentDir);
const loader = new DefaultResourceLoader({
  cwd,
  agentDir,
  settingsManager,
  noContextFiles: true,
});

await loader.reload();

const loaded = loader.getExtensions();
const skills = loader.getSkills();
const themes = loader.getThemes();
const diagnostics = [...skills.diagnostics, ...loader.getPrompts().diagnostics, ...themes.diagnostics]
  .filter((item) => item.type === "error" || item.type === "collision");
const failures = [];

for (const error of loaded.errors) failures.push(`${error.path}: ${error.error}`);
for (const diagnostic of diagnostics) failures.push(`${diagnostic.path || "resource"}: ${diagnostic.message}`);

if (loaded.extensions.length !== manifest.pi.extensions.length) {
  failures.push(`expected ${manifest.pi.extensions.length} extensions, loaded ${loaded.extensions.length}`);
}

for (const extension of loaded.extensions) {
  const relative = path.relative(repoRoot, fs.realpathSync(extension.resolvedPath));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    failures.push(`extension loaded outside monorepo: ${extension.resolvedPath}`);
  }
}

if (skills.skills.length !== manifest.pi.skills.length) {
  failures.push(`expected ${manifest.pi.skills.length} skills, loaded ${skills.skills.length}`);
}

if (failures.length > 0) {
  throw new Error(`Isolated Pi check failed:\n- ${failures.join("\n- ")}`);
}

console.log("Isolated Pi check passed.");
console.log(`Extensions: ${loaded.extensions.length}`);
console.log(`Skills: ${skills.skills.map((skill) => skill.name).sort().join(", ")}`);
console.log(`Themes: ${themes.themes.length}`);
