// Generation job state: <memoryDir>/../generate/. One job at a time, enforced
// with an O_EXCL lock file holding the owner's PID. A dead owner's lock is stale.
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

export type JobKind = "generate" | "rebuild" | "catchup" | "naps";
export type JobPhase = "distil" | "awaiting-confirm" | "importing" | "naps" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  kind: JobKind;
  phase: JobPhase;
  total: number;
  processed: number;
  /** Session file paths already distilled; resume skips them. */
  processedSessions: string[];
  /** Newest session entry time seen, ISO. Catch up starts after it. */
  lastSessionTime?: string;
  /** Catch up: only entries after this time. */
  since?: string;
  lines: number;
  dropped: number;
  modelCalls: number;
  model: string;
  modelUsed?: string;
  napsDone: number;
  napsPending?: number;
  pid?: number;
  startedAt: string;
  updatedAt: string;
  error?: string;
  imported?: number;
  skippedOlder?: number;
  backup?: string;
};

export type GenPaths = {
  dir: string;
  job: string;
  log: string;
  lock: string;
  lines: string;
  draft: string;
  state: string;
  onboarding: string;
};

export function genPaths(memoryDir: string): GenPaths {
  const dir = join(dirname(memoryDir), "generate");
  return {
    dir,
    job: join(dir, "job.json"),
    log: join(dir, "job.log"),
    lock: join(dir, "lock"),
    lines: join(dir, "lines.jsonl"),
    draft: join(dir, "draft.txt"),
    state: join(dir, "state.json"),
    onboarding: join(dir, "onboarding-shown"),
  };
}

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
}

export function readJob(paths: GenPaths): Job | undefined {
  return readJson<Job>(paths.job);
}

export function writeJob(paths: GenPaths, job: Job, now = new Date()): void {
  job.updatedAt = now.toISOString();
  writeJson(paths.job, job);
}

export type GenState = { lastSessionTime?: string; lastJobId?: string };

export function readState(paths: GenPaths): GenState {
  return readJson<GenState>(paths.state) ?? {};
}

export function writeState(paths: GenPaths, state: GenState): void {
  writeJson(paths.state, state);
}

export function pidAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function lockOwner(paths: GenPaths): number | undefined {
  try {
    const pid = Number(readFileSync(paths.lock, "utf8").trim());
    return pidAlive(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** Take the job lock. Returns false when a live process holds it. A stale lock is replaced. */
export function acquireLock(paths: GenPaths, pid = process.pid): boolean {
  mkdirSync(paths.dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(paths.lock, "wx");
      writeSync(fd, String(pid));
      closeSync(fd);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lockOwner(paths) !== undefined) return false;
      rmSync(paths.lock, { force: true });
    }
  }
  return false;
}

export function releaseLock(paths: GenPaths, pid = process.pid): void {
  try {
    if (Number(readFileSync(paths.lock, "utf8").trim()) === pid) rmSync(paths.lock, { force: true });
  } catch {
    // already gone
  }
}

/** True while a job process is alive. */
export function jobRunning(paths: GenPaths): boolean {
  return lockOwner(paths) !== undefined;
}

export function logLine(paths: GenPaths, message: string, now = new Date()): void {
  mkdirSync(paths.dir, { recursive: true });
  appendFileSync(paths.log, `${now.toISOString()} ${message}\n`);
}

export function newJob(kind: JobKind, model: string, now = new Date()): Job {
  const stamp = now.toISOString();
  return {
    id: `${kind}-${stamp.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
    kind,
    phase: kind === "naps" ? "naps" : "distil",
    total: 0,
    processed: 0,
    processedSessions: [],
    lines: 0,
    dropped: 0,
    modelCalls: 0,
    model,
    napsDone: 0,
    startedAt: stamp,
    updatedAt: stamp,
  };
}

export function describeJob(job: Job | undefined, running: boolean): string {
  if (!job) return "No generation job has run yet.";
  const lines = [
    `job: ${job.id} (${job.kind})`,
    `phase: ${job.phase}${running ? " (running)" : job.phase === "distil" || job.phase === "naps" || job.phase === "importing" ? " (stopped; run it again to resume)" : ""}`,
    `sessions: ${job.processed}/${job.total}`,
    `draft lines: ${job.lines} (filter dropped ${job.dropped})`,
    `model: ${job.modelUsed ?? job.model}${job.modelUsed && job.modelUsed !== job.model ? ` (fallback from ${job.model})` : ""}, calls: ${job.modelCalls}`,
    `naps written: ${job.napsDone}${job.napsPending !== undefined ? `, pending: ${job.napsPending}` : ""}`,
    `started: ${job.startedAt}, updated: ${job.updatedAt}`,
  ];
  if (job.imported !== undefined) lines.push(`imported: ${job.imported}${job.skippedOlder ? ` (skipped ${job.skippedOlder} older than the last memory)` : ""}`);
  if (job.backup) lines.push(`backup: ${job.backup}`);
  if (job.error) lines.push(`error: ${job.error}`);
  return lines.join("\n");
}

export function exists(path: string): boolean {
  return existsSync(path);
}
