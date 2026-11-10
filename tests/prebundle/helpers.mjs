import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
const tsx = import.meta.resolve("tsx");

/** Runs a probe script in a fresh Node process, so each case gets its own module state. */
export function runProbe(probe, target, env = {}) {
  const cleaned = { ...process.env, ...env };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete cleaned[key];
  try {
    const stdout = execFileSync(process.execPath, ["--import", tsx, resolve(import.meta.dirname, probe), target], {
      env: { ...cleaned, PI_PREBUNDLE_DEBUG: "1" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { stdout, stderr: "" };
  } catch (error) {
    throw new Error(`${probe} failed for ${target}:\n${error.stderr ?? error.message}`);
  }
}

/** Same, but also returns the loader's debug notes from stderr. */
export function runProbeWithNotes(probe, target, env = {}) {
  const cleaned = { ...process.env, ...env, PI_PREBUNDLE_DEBUG: "1" };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete cleaned[key];
  const script = `
    const { spawnSync } = require("node:child_process");
    const r = spawnSync(process.execPath, ["--import", ${JSON.stringify(tsx)}, ${JSON.stringify(resolve(import.meta.dirname, probe))}, ${JSON.stringify(target)}], { encoding: "utf8" });
    process.stdout.write(JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr }));
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["-e", script], { env: cleaned, encoding: "utf8", timeout: 60_000 }));
  if (result.status !== 0) throw new Error(`${probe} failed for ${target}:\n${result.stderr}`);
  return { stdout: result.stdout, notes: result.stderr };
}
