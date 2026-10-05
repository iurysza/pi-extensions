// The /memory generation subcommands. Work runs in a detached generate.mjs
// process; this module only launches it, reads its job file, and asks for
// the import confirmation.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandEnv, Handler } from "../commands.ts";
import { agentDir } from "../config-file.ts";
import { logLength } from "../memstore.ts";
import { main } from "./cli.ts";
import { describeJob, footerText, genPaths, jobRunning, readJob, writeJob, type Job } from "./job.ts";
import { readDraft } from "./pipeline.ts";
import { countSessionFiles } from "./sessions.ts";

export const LEADER_PATH = "Leader → b → g";
const SAMPLE_LINES = 12;

export type Launch = (args: string[], memoryDir: string, env: NodeJS.ProcessEnv) => void;

export function scriptPath(env: NodeJS.ProcessEnv): string {
  return env.PI_OPTMEM_GENERATE_SCRIPT || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "generate.mjs");
}

/** Start generate.mjs detached in its own process group, so it outlives Pi and cancel can stop its children. */
export const launchDetached: Launch = (args, memoryDir, env) => {
  const paths = genPaths(memoryDir);
  mkdirSync(paths.dir, { recursive: true });
  const out = openSync(join(paths.dir, "cli.out"), "a");
  const node = /node/.test(basename(process.execPath)) ? process.execPath : "node";
  const child = spawn(node, [scriptPath(env), ...args], { detached: true, stdio: ["ignore", out, out], env });
  child.unref();
};

function cliArgs(c: CommandEnv): string[] {
  return ["--memory-dir", c.paths.memoryDir, "--model", c.config.model];
}

function sessionsDir(env: NodeJS.ProcessEnv): string {
  return join(agentDir(env), "sessions");
}

/** Footer suffix, e.g. `gen 120/1840`. */
export function generationFooter(memoryDir: string): string | undefined {
  const paths = genPaths(memoryDir);
  if (!existsSync(paths.job)) return undefined;
  return footerText(readJob(paths), jobRunning(paths));
}

/** Evenly spaced sample of draft lines. */
export function sample<T>(items: readonly T[], count = SAMPLE_LINES): T[] {
  if (items.length <= count) return [...items];
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]!);
}

export function reviewText(job: Job, draft: readonly { date: string; text: string }[]): string {
  const span = draft.length ? `${draft[0]!.date} to ${draft.at(-1)!.date}` : "no lines";
  const head = [
    `${draft.length} memory lines from ${job.processed} sessions (${span}).`,
    `Privacy filter dropped ${job.dropped} lines.${job.kind === "rebuild" ? " Import moves the current memory to memory.bak-<date> first; open sessions keep their wake view until /memory on." : ""}`,
    "",
    ...sample(draft).map((l) => `${l.date} ${l.text}`),
  ];
  return head.join("\n");
}

function busy(c: CommandEnv): boolean {
  const paths = genPaths(c.paths.memoryDir);
  if (!jobRunning(paths)) return false;
  c.ctx.ui.notify(`A generation job is running.\n${describeJob(readJob(paths), true)}`, "info");
  return true;
}

function requireMemo(c: CommandEnv): boolean {
  if (c.memoExists(c.paths.memoPath)) return true;
  c.ctx.ui.notify(`memo is missing at ${c.paths.memoPath}. Install it first (see /memory paths).`, "warning");
  return false;
}

/** Show the draft dialog: Import, Open draft, Cancel. */
async function review(c: CommandEnv, job: Job): Promise<void> {
  const paths = genPaths(c.paths.memoryDir);
  const draft = readDraft(paths.draft);
  if (!c.ctx.hasUI) {
    c.ctx.ui.notify(`Draft waiting: ${paths.draft} (${draft.length} lines). Import it with: node ${scriptPath(c.env)} import`, "info");
    return;
  }
  if (!draft.length) {
    c.ctx.ui.notify("The draft is empty: nothing worth remembering was found.", "info");
    job.phase = "done";
    writeJob(paths, job);
    return;
  }
  for (;;) {
    const choice = await c.ctx.ui.select(reviewText(job, draft), ["Import", "Open draft", "Cancel"]);
    if (choice === "Open draft") {
      await c.ctx.ui.editor(`Draft (read-only): ${paths.draft}`, readFileSync(paths.draft, "utf8"));
      continue;
    }
    if (choice === "Import") {
      (c.launch ?? launchDetached)(["import", ...cliArgs(c)], c.paths.memoryDir, c.env);
      c.ctx.ui.notify("Importing in the background, then running naps. Progress shows in the footer.", "info");
      return;
    }
    // Cancel, Escape: keep the draft so Generate can show it again.
    c.ctx.ui.notify(`Not imported. The draft stays at ${paths.draft}; Generate shows it again.`, "info");
    return;
  }
}

const generate: Handler = async (args, c) => {
  if (!requireMemo(c) || busy(c)) return;
  const paths = genPaths(c.paths.memoryDir);
  const job = readJob(paths);
  if (job?.phase === "awaiting-confirm") return review(c, job);
  const empty = logLength(c.paths.memoryDir) === 0;
  const count = countSessionFiles(sessionsDir(c.env));
  let kind: "generate" | "rebuild" | "catchup" = "generate";
  if (!empty) {
    if (!c.ctx.hasUI && args !== "rebuild") {
      c.ctx.ui.notify("Memory is not empty. Use /memory generate rebuild, or /memory catchup.", "warning");
      return;
    }
    const choice =
      args === "rebuild"
        ? "Rebuild"
        : await c.ctx.ui.select(`Memory has ${logLength(c.paths.memoryDir)} memories.`, ["Catch up (new sessions only)", "Rebuild from all sessions", "Cancel"]);
    if (choice?.startsWith("Catch up")) kind = "catchup";
    else if (choice?.startsWith("Rebuild")) {
      const ok = await c.ctx.ui.confirm(
        "Rebuild memory?",
        `This distils ${count} sessions with ${c.config.model}. After you confirm the draft, the current memory moves to memory.bak-YYYYMMDD-HHMM. Open sessions keep their current wake view until they reload.`,
      );
      if (!ok) return;
      kind = "rebuild";
    } else return;
  } else if (c.ctx.hasUI) {
    const ok = await c.ctx.ui.confirm("Generate memory?", `Distil ${count} past sessions with ${c.config.model} in the background. You confirm the draft before anything is written.`);
    if (!ok) return;
  }
  (c.launch ?? launchDetached)([kind, ...cliArgs(c)], c.paths.memoryDir, c.env);
  c.ctx.ui.notify(`${kind === "catchup" ? "Catch up" : "Generation"} started in the background. The footer shows progress; you are asked before import.`, "info");
};

const catchup: Handler = async (_args, c) => {
  if (!requireMemo(c) || busy(c)) return;
  const job = readJob(genPaths(c.paths.memoryDir));
  if (job?.phase === "awaiting-confirm") return review(c, job);
  if (logLength(c.paths.memoryDir) === 0) {
    c.ctx.ui.notify(`Memory is empty. Use Generate (${LEADER_PATH} → g) first.`, "info");
    return;
  }
  (c.launch ?? launchDetached)(["catchup", ...cliArgs(c)], c.paths.memoryDir, c.env);
  c.ctx.ui.notify("Catch up started in the background.", "info");
};

const naps: Handler = async (_args, c) => {
  if (!requireMemo(c) || busy(c)) return;
  if (logLength(c.paths.memoryDir) === 0) {
    c.ctx.ui.notify("Memory is empty: nothing to nap.", "info");
    return;
  }
  (c.launch ?? launchDetached)(["naps", ...cliArgs(c)], c.paths.memoryDir, c.env);
  c.ctx.ui.notify(`Naps started in the background with ${c.config.model}.`, "info");
};

const jobStatus: Handler = async (_args, c) => {
  const paths = genPaths(c.paths.memoryDir);
  const job = readJob(paths);
  if (job?.phase === "awaiting-confirm" && !jobRunning(paths)) return review(c, job);
  const tail = existsSync(paths.log) ? readFileSync(paths.log, "utf8").trim().split("\n").slice(-30).join("\n") : "";
  const text = `${describeJob(job, jobRunning(paths))}\n\nlog: ${paths.log}\n${tail}`;
  if (c.ctx.hasUI) await c.ctx.ui.editor("Generation job (read-only)", text);
  else c.ctx.ui.notify(text, "info");
};

const cancel: Handler = async (_args, c) => {
  const out: string[] = [];
  await main(["cancel", "--memory-dir", c.paths.memoryDir], c.env, (m) => out.push(m));
  c.ctx.ui.notify(out.join("\n"), "info");
};

export const GENERATE_HANDLERS: Record<string, Handler> = { generate, catchup, naps, job: jobStatus, cancel };

/**
 * One notification per machine when memory is empty: the marker sits next to
 * the memory dir. Returns true when it was shown.
 */
export function maybeOnboard(ctx: ExtensionContext, memoryDir: string, env: NodeJS.ProcessEnv): boolean {
  const paths = genPaths(memoryDir);
  if (existsSync(paths.onboarding) || logLength(memoryDir) > 0 || existsSync(paths.job)) return false;
  const count = countSessionFiles(sessionsDir(env));
  if (!count) return false;
  mkdirSync(paths.dir, { recursive: true });
  writeFileSync(paths.onboarding, `${new Date().toISOString()}\n`);
  ctx.ui.notify(`Memory is empty. ${LEADER_PATH} → g (Generate) builds it from ${count} past sessions.`, "info");
  return true;
}

/** Notify once when a background job reaches the draft or finishes. */
export function jobWatcher(memoryDir: string, notify: (message: string) => void): () => void {
  let last = readJob(genPaths(memoryDir))?.phase;
  return () => {
    const job = readJob(genPaths(memoryDir));
    const phase = job?.phase;
    if (!job || phase === last) return;
    last = phase;
    if (phase === "awaiting-confirm") notify(`Memory draft ready: ${job.lines} lines. ${LEADER_PATH} → g to review and import.`);
    else if (phase === "done") notify(`Memory job done: ${job.imported !== undefined ? `imported ${job.imported}, ` : ""}${job.napsDone} naps written.`);
    else if (phase === "failed") notify(`Memory job failed: ${job.error ?? "see /memory job"}`);
  };
}
