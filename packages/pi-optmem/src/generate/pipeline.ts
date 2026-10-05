// The generation pipeline. Every phase checkpoints to job.json so a killed
// process resumes where it stopped. memo is the only writer of the store.
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { formatDropped, filterLines, type DatedLine } from "./filter.ts";
import {
  acquireLock,
  genPaths,
  logLine,
  newJob,
  readJob,
  readState,
  releaseLock,
  writeJob,
  writeState,
  type GenPaths,
  type Job,
  type JobKind,
} from "./job.ts";
import { blockInput, logLength, readMemories, readyBlocks, pendingBlocks, type Block } from "../memstore.ts";
import { ModelClient, distilLines, distilPrompt, fallbackSummary, makeBatches, napPrompt, parseNaps, type ModelCall } from "./model.ts";
import { discoverSessions, readAndExtract, type Extracted, type SessionHeader } from "./sessions.ts";

export type PipelineDeps = {
  readonly memoPath: string;
  readonly memoryDir: string;
  readonly sessionsDir: string;
  readonly model: string;
  readonly call: ModelCall;
  readonly env?: NodeJS.ProcessEnv;
  readonly concurrency?: number;
  readonly backoffMs?: number;
  readonly now?: () => Date;
  readonly print?: (message: string) => void;
};

export type MemoResult = { code: number; stdout: string; stderr: string };

export function runMemo(memoPath: string, memoryDir: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<MemoResult> {
  return new Promise((resolve) => {
    execFile(memoPath, args, { env: { ...env, MEMORY_DIR: memoryDir }, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : "")) });
    });
  });
}

/** Evenly spaced sample, so `--limit` covers the whole history, not just the oldest sessions. */
export function spread<T>(items: readonly T[], limit: number | undefined): T[] {
  if (!limit || limit >= items.length) return [...items];
  if (limit <= 0) return [];
  if (limit === 1) return [items[0]!];
  return Array.from({ length: limit }, (_, i) => items[Math.round((i * (items.length - 1)) / (limit - 1))]!);
}

export type DistilOptions = { readonly limit?: number; readonly dryRun?: boolean; readonly fresh?: boolean };

type Context = { deps: PipelineDeps; paths: GenPaths; job: Job; client: ModelClient; log: (message: string) => void };

function context(deps: PipelineDeps, job: Job): Context {
  const paths = genPaths(deps.memoryDir);
  const now = deps.now ?? (() => new Date());
  const log = (message: string) => {
    logLine(paths, message, now());
    deps.print?.(message);
  };
  const client = new ModelClient({
    call: deps.call,
    model: deps.model,
    concurrency: deps.concurrency ?? 4,
    backoffMs: deps.backoffMs,
    log,
    onCall: () => job.modelCalls++,
  });
  return { deps, paths, job, client, log };
}

function save(c: Context): void {
  c.job.modelUsed = c.client.modelUsed;
  writeJob(c.paths, c.job, (c.deps.now ?? (() => new Date()))());
}

const RESUMABLE = new Set(["distil", "importing", "naps"]);

/** The job to continue, or a new one. A finished, cancelled or failed job is replaced. */
function startJob(deps: PipelineDeps, kind: JobKind, fresh: boolean): Job {
  const paths = genPaths(deps.memoryDir);
  const previous = readJob(paths);
  if (!fresh && previous && previous.kind === kind && RESUMABLE.has(previous.phase)) {
    previous.error = undefined;
    previous.pid = process.pid;
    return previous;
  }
  for (const path of [paths.lines, paths.draft]) rmSync(path, { force: true });
  const job = newJob(kind, deps.model, (deps.now ?? (() => new Date()))());
  job.pid = process.pid;
  if (kind === "catchup") job.since = readState(paths).lastSessionTime;
  return job;
}

function rawLines(paths: GenPaths): string[] {
  if (!existsSync(paths.lines)) return [];
  const out: string[] = [];
  for (const line of readFileSync(paths.lines, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(...(JSON.parse(line) as { lines: string[] }).lines);
    } catch {
      // a torn last record from a kill; its sessions were not marked processed
    }
  }
  return out;
}

export function writeDraft(path: string, lines: readonly DatedLine[]): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, lines.map((l) => `${l.date} ${l.text}\n`).join(""));
  renameSync(tmp, path);
}

export function readDraft(path: string): DatedLine[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => ({ date: l.slice(0, 10), text: l.slice(11) }));
}

function catchupSessions(all: readonly SessionHeader[], since: string | undefined): SessionHeader[] {
  if (!since) return [...all];
  // A session started before `since` can still have newer turns; extraction filters by entry time.
  return all.filter((s) => {
    try {
      return readFileSync(s.path).length > 0 && (s.timestamp > since || newerThan(s.path, since));
    } catch {
      return false;
    }
  });
}

function newerThan(path: string, since: string): boolean {
  const text = readFileSync(path, "utf8");
  const tail = text.slice(-4000);
  const times = [...tail.matchAll(/"timestamp":"([^"]+)"/g)].map((m) => m[1]!);
  return times.some((t) => t > since);
}

/** Distil sessions into draft.txt and stop at awaiting-confirm. */
export async function distil(deps: PipelineDeps, kind: "generate" | "rebuild" | "catchup", options: DistilOptions = {}): Promise<Job> {
  const job = startJob(deps, kind, options.fresh ?? false);
  const c = context(deps, job);
  if (job.phase !== "distil") return job;
  const all = discoverSessions(deps.sessionsDir);
  const candidates = spread(kind === "catchup" ? catchupSessions(all, job.since) : all, options.limit);
  const done = new Set(job.processedSessions);
  job.total = candidates.length;
  const todo = candidates.filter((s) => !done.has(s.path));
  c.log(`${kind}: ${candidates.length} sessions (${todo.length} to do), model ${deps.model}${job.since ? `, since ${job.since}` : ""}`);
  save(c);

  const extracted: Extracted[] = [];
  for (const session of todo) {
    let item: Extracted | undefined;
    try {
      item = readAndExtract(session, job.since);
    } catch (error) {
      c.log(`skip ${session.path}: ${(error as Error).message}`);
    }
    if (item) extracted.push(item);
    else markDone(c, [session]);
  }
  save(c);

  const batches = makeBatches(extracted);
  c.log(`${extracted.length} non-empty sessions in ${batches.length} batches`);
  let failed = 0;
  await Promise.all(
    batches.map(async (batch) => {
      let output: string;
      try {
        output = await c.client.complete(distilPrompt(batch));
      } catch (error) {
        failed++;
        c.log(`batch failed (${batch.items.length} sessions, first ${batch.items[0]!.session.path}): ${(error as Error).message}`);
        return;
      }
      const lines = distilLines(output, batch);
      appendFileSync(c.paths.lines, `${JSON.stringify({ sessions: batch.items.map((i) => i.session.path), lines })}\n`);
      for (const item of batch.items) if (!job.lastSessionTime || item.lastTime > job.lastSessionTime) job.lastSessionTime = item.lastTime;
      markDone(c, batch.items.map((i) => i.session));
      save(c);
    }),
  );
  if (failed) {
    job.error = `${failed} batches failed; run again to retry them`;
    c.log(job.error);
    save(c);
    return job;
  }
  const filtered = filterLines(rawLines(c.paths));
  writeDraft(c.paths.draft, filtered.lines);
  job.lines = filtered.lines.length;
  job.dropped = filtered.droppedTotal;
  job.phase = "awaiting-confirm";
  c.log(`draft: ${job.lines} lines at ${c.paths.draft}; post-filter dropped ${job.dropped} (${formatDropped(filtered.dropped)})${options.dryRun ? "; dry run, nothing imported" : ""}`);
  save(c);
  return job;
}

function markDone(c: Context, sessions: readonly SessionHeader[]): void {
  for (const s of sessions) c.job.processedSessions.push(s.path);
  c.job.processed = c.job.processedSessions.length;
}

/** Python one-shot: take memo's lock without blocking, then move the store. */
const MOVE_UNDER_LOCK = `
import fcntl, os, sys
src, dst = sys.argv[1], sys.argv[2]
lock = open(os.path.join(src, ".lock"), "a")
try:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError:
    print("busy"); sys.exit(3)
os.rename(src, dst)
print("moved")
`;

export function backupName(memoryDir: string, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  let candidate = `${memoryDir}.bak-${stamp}`;
  for (let i = 2; existsSync(candidate); i++) candidate = `${memoryDir}.bak-${stamp}-${i}`;
  return candidate;
}

export function moveStore(memoryDir: string, target: string): Promise<"moved" | "busy" | string> {
  return new Promise((resolve) => {
    execFile("python3", ["-c", MOVE_UNDER_LOCK, memoryDir, target], (error, stdout, stderr) => {
      const out = String(stdout).trim();
      if (out === "moved" || out === "busy") resolve(out);
      else resolve(String(stderr || error?.message || "move failed").trim());
    });
  });
}

/** Import the confirmed draft, then run naps. */
export async function importDraft(deps: PipelineDeps): Promise<Job> {
  const paths = genPaths(deps.memoryDir);
  const job = readJob(paths);
  if (!job || (job.phase !== "awaiting-confirm" && job.phase !== "importing")) throw new Error("No draft is waiting for import.");
  const c = context(deps, job);
  const env = deps.env ?? process.env;
  const memo = (args: string[]) => runMemo(deps.memoPath, deps.memoryDir, args, env);

  if (job.phase === "awaiting-confirm") {
    if (job.kind === "rebuild" && existsSync(deps.memoryDir) && logLength(deps.memoryDir) > 0) {
      const backup = backupName(deps.memoryDir, (deps.now ?? (() => new Date()))());
      const moved = await moveStore(deps.memoryDir, backup);
      if (moved !== "moved") {
        throw new Error(moved === "busy" ? "Memory is busy, try again." : `Could not move the memory: ${moved}`);
      }
      job.backup = backup;
      c.log(`moved the old memory to ${backup}`);
    }
    job.phase = "importing";
    save(c);
  }

  if (!existsSync(deps.memoryDir)) {
    const init = await memo(["init"]);
    if (init.code !== 0) throw new Error(`memo init failed: ${init.stderr || init.stdout}`);
  }
  // A resumed import may have landed already: memo appends atomically.
  if (job.imported === undefined) {
    const total = logLength(deps.memoryDir);
    const last = total ? readMemories(deps.memoryDir, total - 1, total)[0]!.date : "0000-00-00";
    const draft = readDraft(paths.draft);
    const keep = draft.filter((l) => l.date >= last);
    job.skippedOlder = draft.length - keep.length;
    if (job.skippedOlder) c.log(`skipped ${job.skippedOlder} lines dated before the last memory (${last})`);
    if (keep.length) {
      const file = join(paths.dir, "import.txt");
      writeDraft(file, keep);
      const result = await memo(["import", file]);
      if (result.code !== 0) throw new Error(`memo import failed: ${(result.stderr || result.stdout).trim()}`);
      c.log(result.stdout.trim().split("\n")[0] ?? "imported");
    }
    job.imported = keep.length;
    const state = readState(paths);
    if (job.lastSessionTime && (!state.lastSessionTime || job.lastSessionTime > state.lastSessionTime)) {
      writeState(paths, { lastSessionTime: job.lastSessionTime, lastJobId: job.id });
    }
    save(c);
  }
  job.phase = "naps";
  save(c);
  return naps(deps, job);
}

export const NAPS_PER_CALL = 24;
const MAX_ROUND_FAILURES = 3;

/** Build every pending summary: batched model calls, then `memo nap` in memo's order. */
export async function naps(deps: PipelineDeps, existing?: Job): Promise<Job> {
  const paths = genPaths(deps.memoryDir);
  let job = existing;
  if (!job) {
    const previous = readJob(paths);
    job = previous && previous.phase === "naps" ? previous : newJob("naps", deps.model, (deps.now ?? (() => new Date()))());
    job.pid = process.pid;
    job.error = undefined;
  }
  const c = context(deps, job);
  const env = deps.env ?? process.env;
  const failures = new Map<string, number>();
  job.phase = "naps";
  job.napsPending = pendingBlocks(deps.memoryDir).length;
  save(c);
  c.log(`naps: ${job.napsPending} pending, model ${deps.model}`);

  let stalled = 0;
  for (;;) {
    const ready = readyBlocks(deps.memoryDir);
    if (!ready.length) break;
    if (stalled >= MAX_ROUND_FAILURES + 1) {
      job.error = "naps stopped making progress; run naps again later";
      c.log(job.error);
      break;
    }
    const groups: Block[][] = [];
    for (let i = 0; i < ready.length; i += NAPS_PER_CALL) groups.push(ready.slice(i, i + NAPS_PER_CALL));
    const summaries = new Map<string, string>();
    await Promise.all(
      groups.map(async (group) => {
        const requests = group.map((b) => ({ ...b, input: blockInput(deps.memoryDir, b) }));
        try {
          const parsed = parseNaps(await c.client.complete(napPrompt(requests)), requests.length);
          for (const [index, line] of parsed) summaries.set(key(group[index]!), line);
        } catch (error) {
          c.log(`nap batch failed: ${(error as Error).message}`);
        }
      }),
    );
    let wrote = 0;
    for (const block of ready) {
      let line = summaries.get(key(block));
      if (!line) {
        const fails = (failures.get(key(block)) ?? 0) + 1;
        failures.set(key(block), fails);
        if (fails < MAX_ROUND_FAILURES) break; // keep memo's order: retry next round
        line = fallbackSummary(blockInput(deps.memoryDir, block));
        c.log(`nap ${block.lo}-${block.hi - 1}: model gave no line ${fails} times; used a truncated join`);
      }
      const result = await runMemo(deps.memoPath, deps.memoryDir, ["nap", `${block.lo}-${block.hi - 1}`, line], env);
      const out = `${result.stdout}${result.stderr}`;
      if (result.code !== 0 && !/already settled/.test(out)) {
        // Another session napped meanwhile, or the store moved on: recompute.
        c.log(`nap ${block.lo}-${block.hi - 1}: ${out.trim().split("\n")[0]}`);
        break;
      }
      wrote++;
      job.napsDone++;
    }
    job.napsPending = pendingBlocks(deps.memoryDir).length;
    save(c);
    stalled = wrote ? 0 : stalled + 1;
  }
  job.napsPending = pendingBlocks(deps.memoryDir).length;
  job.phase = job.error ? "failed" : "done";
  c.log(`naps ${job.phase}: wrote ${job.napsDone}, ${job.napsPending} pending, ${job.modelCalls} model calls`);
  save(c);
  return job;
}

function key(block: Block): string {
  return `${block.lo}-${block.hi}`;
}

/** Run a job body under the one-job lock. */
export async function withLock<T>(memoryDir: string, body: () => Promise<T>): Promise<T> {
  const paths = genPaths(memoryDir);
  if (!acquireLock(paths)) throw new Error("Another generation job is running. Check it with `status`, or stop it with `cancel`.");
  try {
    return await body();
  } finally {
    releaseLock(paths);
  }
}

export function storeDirExists(memoryDir: string): boolean {
  return existsSync(dirname(memoryDir));
}
