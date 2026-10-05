import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, layerConfigs, parseConfig, type OptMemConfig } from "./core.ts";

export const CONFIG_FILE_NAME = "pi-optmem.json";
export const DEFAULTS_FILE_NAME = "pi-optmem.defaults.json";

/** Same rule as Pi's getAgentDir, without importing Pi (the CLI runs outside Pi). */
export function agentDir(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const dir = env.PI_CODING_AGENT_DIR;
  if (dir) return dir === "~" ? home : dir.startsWith("~/") ? join(home, dir.slice(2)) : dir;
  return join(home, ".pi", "agent");
}

/** User config, written by the menu. agents2 never renders it. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_OPTMEM_CONFIG || join(agentDir(env), CONFIG_FILE_NAME);
}

/** Profile defaults, rendered and linked by agents2. Read-only for us. */
export function defaultsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_OPTMEM_DEFAULTS || join(agentDir(env), DEFAULTS_FILE_NAME);
}

type Layer = { name: string; value: unknown };

function readLayer(path: string): { layer?: Layer; error?: string } {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    return { error: `cannot read ${path}: ${(error as Error).message}` };
  }
  try {
    return { layer: { name: path, value: JSON.parse(text) } };
  } catch (error) {
    return { error: `${path}: ${(error as Error).message}` };
  }
}

/**
 * built-in < profile defaults < user file. A broken layer is skipped with an
 * error, so a bad user edit falls back to the profile defaults, not to off.
 */
export function loadLayeredConfig(env: NodeJS.ProcessEnv = process.env): { config: OptMemConfig; error?: string } {
  const errors: string[] = [];
  const layers: Layer[] = [];
  for (const path of [defaultsPath(env), configPath(env)]) {
    const { layer, error } = readLayer(path);
    if (error) errors.push(error);
    if (!layer) continue;
    const alone = layerConfigs([...layers, layer]);
    if (alone.ok) layers.push(layer);
    else errors.push(alone.error);
  }
  const merged = layerConfigs(layers);
  const config = merged.ok ? merged.config : DEFAULT_CONFIG;
  return errors.length ? { config, error: errors.join("; ") } : { config };
}

/** The user file as raw JSON (only what the user set), or {} when missing. */
export function readUserConfig(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const { layer, error } = readLayer(configPath(env));
  if (error) throw new Error(error);
  const value = layer?.value;
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

/** Validate, then write atomically. Throws on an invalid result. */
export function writeUserConfig(value: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): void {
  const parsed = parseConfig(value);
  if (!parsed.ok) throw new Error(parsed.error);
  const path = configPath(env);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

/** Read the user file, change it, write it back. */
export function updateUserConfig(
  change: (current: Record<string, unknown>) => Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const next = change(readUserConfig(env));
  writeUserConfig(next, env);
  return next;
}
