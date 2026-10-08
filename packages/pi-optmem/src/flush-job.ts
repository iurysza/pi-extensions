import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlushJob } from "./flush.ts";

export const FLUSH_CHILD = "PI_OPTMEM_FLUSH_CHILD";
export const FLUSH_JOB = "PI_OPTMEM_FLUSH_JOB";
export type FlushLaunch = (job: FlushJob, env: NodeJS.ProcessEnv, cwd: string) => void;

/** An inherited environment variable must never authorise deleting an arbitrary directory. */
export function removeFlushSnapshot(file: string): void {
  const dir = dirname(file);
  if (basename(file) !== "span.json" || !basename(dir).startsWith("pi-optmem-flush-")) return;
  try {
    if (realpathSync(dirname(dir)) !== realpathSync(tmpdir())) return;
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Already removed, or not a snapshot we can safely delete.
  }
}

export function flushLogPath(memoryDir: string): string {
  return join(dirname(memoryDir), "flush", "flush.jsonl");
}

/** No transcript, model output, credentials, or memory payloads in the log. */
export function logFlush(job: FlushJob, result: Record<string, unknown>): void {
  try {
    const path = flushLogPath(job.memoryDir);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${JSON.stringify({ time: new Date().toISOString(), model: job.model, session: job.session, ...result })}\n`, { mode: 0o600 });
  } catch {
    // A log failure must not discard saved facts or stop worker shutdown.
  }
}

/** Pi loads the configured provider extensions in the child. No prompt is sent:
 * the explicit worker extension makes one registry call on session_start.
 */
export const launchFlush: FlushLaunch = (job, env, cwd) => {
  const dir = mkdtempSync(join(tmpdir(), "pi-optmem-flush-"));
  const file = join(dir, "span.json");
  try {
    writeFileSync(file, JSON.stringify(job), { mode: 0o600 });
    const worker = join(dirname(fileURLToPath(import.meta.url)), import.meta.url.endsWith(".ts") ? "flush-worker.ts" : "flush-worker.js");
    const child = spawn(env.PI_OPTMEM_PI || "pi", ["--mode", "rpc", "--no-session", "--no-tools", "--no-skills", "--no-context-files", "-e", worker], {
      cwd,
      detached: true,
      stdio: "ignore",
      env: { ...env, [FLUSH_CHILD]: "1", [FLUSH_JOB]: file, PI_OPTMEM_SUBAGENT: "1", MEMORY_DIR: job.memoryDir },
    });
    child.on("error", () => {
      try { logFlush(job, { status: "failed", stage: "spawn" }); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    child.unref();
    logFlush(job, { status: "started", pid: child.pid });
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
};
