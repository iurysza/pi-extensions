// generate.mjs generate|rebuild|catchup|import|naps|status|cancel [options]
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { agentDir, loadLayeredConfig } from "../config-file.ts";
import { expandHome, resolvePaths } from "../core.ts";
import { logLength, readMemories } from "../memstore.ts";
import { describeJob, genPaths, jobRunning, lockOwner, logLine, readJob, readState, writeJob } from "./job.ts";
import { modelCall } from "./model.ts";
import { distil, importDraft, naps, withLock, type PipelineDeps } from "./pipeline.ts";

export const USAGE = `Usage: generate.mjs <command> [options]

Commands:
  generate   distil sessions into a draft (memory must be empty)
  rebuild    distil into a draft; import moves the old memory to memory.bak-YYYYMMDD-HHMM
  catchup    distil only sessions newer than the last generation
  import     import the waiting draft, then run naps
  naps       build every pending summary with the cheap model
  status     show the current job
  cancel     stop the running job

Options:
  --limit N            only N sessions, spread evenly across history
  --dry-run            stop after the draft (the default for generate/rebuild/catchup)
  --yes                import the draft without asking, then run naps
  --fresh              start a new job instead of resuming a stopped one
  --sessions-dir DIR   default: <pi agent dir>/sessions
  --memory-dir DIR     default: from config (MEMORY_DIR wins)
  --model ID           default: from config
  --concurrency N      parallel model calls (default 4)`;

export type CliOptions = {
  command: string;
  limit?: number;
  dryRun: boolean;
  yes: boolean;
  fresh: boolean;
  sessionsDir?: string;
  memoryDir?: string;
  model?: string;
  concurrency?: number;
};

export function parseArgs(argv: readonly string[]): CliOptions | string {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") return USAGE;
  if (!["generate", "rebuild", "catchup", "import", "naps", "status", "cancel"].includes(command)) return `Unknown command: ${command}\n\n${USAGE}`;
  const options: CliOptions = { command, dryRun: false, yes: false, fresh: false };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const value = () => {
      const next = rest[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    const number = () => {
      const n = Number(value());
      if (!Number.isInteger(n) || n <= 0) throw new Error(`${arg} needs a positive whole number`);
      return n;
    };
    try {
      if (arg === "--dry-run") options.dryRun = true;
      else if (arg === "--yes") options.yes = true;
      else if (arg === "--fresh") options.fresh = true;
      else if (arg === "--limit") options.limit = number();
      else if (arg === "--concurrency") options.concurrency = number();
      else if (arg === "--sessions-dir") options.sessionsDir = value();
      else if (arg === "--memory-dir") options.memoryDir = value();
      else if (arg === "--model") options.model = value();
      else return `Unknown option: ${arg}\n\n${USAGE}`;
    } catch (error) {
      return (error as Error).message;
    }
  }
  if (options.dryRun && options.yes) return "--dry-run and --yes cannot be combined";
  return options;
}

export function cliDeps(options: CliOptions, env: NodeJS.ProcessEnv, print: (m: string) => void): PipelineDeps & { configError?: string } {
  const loaded = loadLayeredConfig(env);
  const home = homedir();
  const paths = resolvePaths(loaded.config, env);
  return {
    memoPath: paths.memoPath,
    memoryDir: options.memoryDir ? resolve(expandHome(options.memoryDir, home)) : paths.memoryDir,
    sessionsDir: options.sessionsDir ? resolve(expandHome(options.sessionsDir, home)) : join(agentDir(env, home), "sessions"),
    model: options.model ?? loaded.config.model,
    call: modelCall(env),
    env,
    concurrency: options.concurrency,
    print,
    configError: loaded.error,
  };
}

function summary(memoryDir: string): string {
  const total = logLength(memoryDir);
  if (!total) return "empty";
  const first = readMemories(memoryDir, 0, 1)[0]!.date;
  const last = readMemories(memoryDir, total - 1, total)[0]!.date;
  return `${total} memories, ${first} to ${last}`;
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, print = (m: string) => console.log(m)): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === "string") {
    print(parsed);
    return parsed === USAGE ? 0 : 2;
  }
  const deps = cliDeps(parsed, env, print);
  if (deps.configError) print(`warning: ${deps.configError}`);
  const paths = genPaths(deps.memoryDir);

  if (parsed.command === "status") {
    print(describeJob(readJob(paths), jobRunning(paths)));
    print(`memory: ${deps.memoryDir} (${summary(deps.memoryDir)})`);
    const state = readState(paths);
    if (state.lastSessionTime) print(`last generated session time: ${state.lastSessionTime}`);
    return 0;
  }

  if (parsed.command === "cancel") {
    const pid = lockOwner(paths);
    const job = readJob(paths);
    if (pid) {
      try {
        // A detached job leads its own process group: take its model children with it.
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
    if (job && job.phase !== "done") {
      job.phase = "cancelled";
      job.pid = undefined;
      writeJob(paths, job);
      logLine(paths, "cancelled");
    }
    print(pid ? `Stopped job ${job?.id ?? pid}.` : job && job.phase === "cancelled" ? `Cancelled ${job.id}.` : "No job is running.");
    return 0;
  }

  if (!env.PI_OPTMEM_MODEL_CMD && !(await hasPython())) {
    print("python3 is required to run memo.");
    return 1;
  }

  // A cancel from another process: record it and exit without a stack trace.
  const onSignal = () => {
    const job = readJob(paths);
    if (job && job.pid === process.pid && job.phase !== "done") {
      job.phase = "cancelled";
      writeJob(paths, job);
    }
    process.exit(130);
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);

  try {
    return await withLock(deps.memoryDir, async () => {
      if (parsed.command === "naps") {
        if (!logLength(deps.memoryDir)) {
          print("Memory is empty: nothing to nap.");
          return 0;
        }
        const job = await naps(deps);
        print(describeJob(job, false));
        return job.phase === "done" ? 0 : 1;
      }
      if (parsed.command === "import") {
        const job = await importDraft(deps);
        print(describeJob(job, false));
        return job.phase === "done" ? 0 : 1;
      }
      const kind = parsed.command as "generate" | "rebuild" | "catchup";
      if (kind === "generate" && logLength(deps.memoryDir) > 0) {
        print(`Memory is not empty (${summary(deps.memoryDir)}). Use rebuild or catchup.`);
        return 1;
      }
      const job = await distil(deps, kind, { limit: parsed.limit, dryRun: !parsed.yes, fresh: parsed.fresh });
      if (job.phase !== "awaiting-confirm") {
        print(describeJob(job, false));
        return 1;
      }
      if (!parsed.yes) {
        print(`Draft ready: ${paths.draft}. Import it with: generate.mjs import${parsed.memoryDir ? ` --memory-dir ${deps.memoryDir}` : ""}`);
        return 0;
      }
      const done = await importDraft(deps);
      print(describeJob(done, false));
      return done.phase === "done" ? 0 : 1;
    });
  } catch (error) {
    const message = (error as Error).message;
    const job = readJob(paths);
    if (job && job.pid === process.pid) {
      job.error = message;
      // A busy store or a failed import leaves the draft waiting; anything else is a failure.
      if (job.phase !== "awaiting-confirm" && job.phase !== "importing") job.phase = "failed";
      if (job.phase === "importing" && job.imported === undefined && !job.backup) job.phase = "awaiting-confirm";
      writeJob(paths, job);
    }
    logLine(paths, `error: ${message}`);
    print(`error: ${message}`);
    return 1;
  } finally {
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
  }
}

async function hasPython(): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => execFile("python3", ["-c", "pass"], (error) => resolve(!error)));
}
