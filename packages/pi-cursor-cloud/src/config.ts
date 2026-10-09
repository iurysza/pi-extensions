import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const configPath = () => join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "pi-cursor-cloud.json");

export function loadDefaultModel(path = configPath()): string | undefined {
  try {
    const config: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (typeof config === "object" && config !== null && "defaultModel" in config && typeof config.defaultModel === "string") return config.defaultModel.trim() || undefined;
  } catch { /* Missing or invalid configuration uses the built-in default. */ }
  return undefined;
}

export async function saveDefaultModel(defaultModel: string, path = configPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ defaultModel }, null, 2) + "\n", "utf8");
}
