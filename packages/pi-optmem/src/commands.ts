// `/memory <subcommand>` handlers used by the leader menu. Mode switching and
// the plain status stay in index.ts because they own session state.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { configPath, defaultsPath, readUserConfig, updateUserConfig, writeUserConfig } from "./config-file.ts";
import { expandHome, isMode, wakeAll, type MemoRun, type OptMemConfig } from "./core.ts";
import { formatBytes, logLength, readMemories, storeStats } from "./memstore.ts";

export const PINNED_MEMO_REV = "1fb164cf39028047781f72ac3bb1e5a691c1dcb0";
export const PINNED_MEMO_SHA256 = "3dc120d01be3115ef6267eab4103e7909fc830d6227b549f20991ba999ee9ffb";
export const LOG_VIEW_MAX = 5000;

export type CommandEnv = {
  readonly ctx: ExtensionContext;
  readonly config: OptMemConfig;
  readonly paths: { memoPath: string; memoryDir: string };
  readonly run: MemoRun;
  readonly env: NodeJS.ProcessEnv;
  readonly memoExists: (path: string) => boolean;
  /** Reload config after a write so the session sees it. */
  readonly reloadConfig: () => Promise<void>;
  /** Open a path with the OS (Finder on macOS). */
  readonly open?: (path: string) => Promise<string | undefined>;
};

export type Handler = (args: string, c: CommandEnv) => Promise<void>;

/** Long text: a read-only editor view in the TUI, a notification elsewhere. */
async function show(c: CommandEnv, title: string, text: string): Promise<void> {
  if (c.ctx.hasUI) await c.ctx.ui.editor(`${title} (read-only; changes are ignored)`, text);
  else c.ctx.ui.notify(`${title}\n${text}`, "info");
}

async function ask(c: CommandEnv, given: string, title: string, placeholder: string): Promise<string | undefined> {
  if (given.trim()) return given.trim();
  if (!c.ctx.hasUI) {
    c.ctx.ui.notify(`${title}: pass it as an argument.`, "warning");
    return undefined;
  }
  const value = await c.ctx.ui.input(title, placeholder);
  return value?.trim() || undefined;
}

async function pick(c: CommandEnv, given: string, title: string, options: string[]): Promise<string | undefined> {
  if (given.trim()) return options.includes(given.trim()) ? given.trim() : undefined;
  if (!c.ctx.hasUI) return undefined;
  return c.ctx.ui.select(title, options);
}

function requireMemo(c: CommandEnv): boolean {
  if (c.memoExists(c.paths.memoPath)) return true;
  c.ctx.ui.notify(`memo not found at ${c.paths.memoPath}. Install it with packages/pi-optmem/scripts/install-memo.sh.`, "warning");
  return false;
}

async function memoOutput(c: CommandEnv, args: string[]): Promise<{ ok: boolean; text: string }> {
  const result = await c.run(args);
  const text = `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim();
  return { ok: result.code === 0, text: text || `memo exited with ${result.code}` };
}

const view: Handler = async (_args, c) => {
  if (!requireMemo(c)) return;
  const result = await wakeAll(c.run);
  if (result.kind === "awake") {
    const body = result.lines.length ? result.lines.join("\n") : "No memories yet.";
    await show(c, `Wake view (${result.lines.length} lines)`, result.nap ? `${body}\n\n${result.nap}` : body);
  } else {
    await show(c, "Wake view unavailable", result.message);
  }
};

const search: Handler = async (args, c) => {
  if (!requireMemo(c)) return;
  const regex = await ask(c, args, "Search memory (case-insensitive regex)", "e.g. berlin|flat");
  if (!regex) return;
  const out = await memoOutput(c, ["recall", regex]);
  await show(c, `Recall /${regex}/`, out.text);
};

const zoom: Handler = async (args, c) => {
  if (!requireMemo(c)) return;
  const range = await ask(c, args, "Zoom into a block", "e.g. 0-31");
  if (!range) return;
  const out = await memoOutput(c, ["zoom", range]);
  await show(c, `Zoom ${range}`, out.text);
};

const log: Handler = async (_args, c) => {
  const total = logLength(c.paths.memoryDir);
  if (!total) {
    c.ctx.ui.notify("The memory log is empty.", "info");
    return;
  }
  const from = Math.max(0, total - LOG_VIEW_MAX);
  const lines = readMemories(c.paths.memoryDir, from, total).map((m) => `#${m.id} ${m.date} ${m.text}`);
  const head = from ? `(newest ${LOG_VIEW_MAX} of ${total})\n` : "";
  await show(c, `LOG.txt (${total} memories)`, head + lines.join("\n"));
};

function openWithOs(path: string): Promise<string | undefined> {
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  return new Promise((resolve) => execFile(opener, [path], (error) => resolve(error ? error.message : undefined)));
}

const reveal: Handler = async (_args, c) => {
  const error = await (c.open ?? openWithOs)(c.paths.memoryDir);
  c.ctx.ui.notify(error ? `Could not open ${c.paths.memoryDir}: ${error}` : `Opened ${c.paths.memoryDir}`, error ? "warning" : "info");
};

/** Edit the user config in Pi's editor, validate, then write. */
const config: Handler = async (_args, c) => {
  if (!c.ctx.hasUI) {
    c.ctx.ui.notify(`User config: ${configPath(c.env)}`, "info");
    return;
  }
  let current: Record<string, unknown>;
  try {
    current = readUserConfig(c.env);
  } catch (error) {
    c.ctx.ui.notify(`${(error as Error).message}. Fix the file by hand.`, "error");
    return;
  }
  const edited = await c.ctx.ui.editor(`Edit ${configPath(c.env)} (profile defaults: ${defaultsPath(c.env)})`, `${JSON.stringify(current, null, 2)}\n`);
  if (edited === undefined || edited.trim() === JSON.stringify(current, null, 2)) return;
  try {
    writeUserConfig(JSON.parse(edited) as Record<string, unknown>, c.env);
  } catch (error) {
    c.ctx.ui.notify(`Not saved: ${(error as Error).message}`, "error");
    return;
  }
  await c.reloadConfig();
  c.ctx.ui.notify("Config saved. New sessions use it; this session's mode is unchanged.", "info");
};

export function memoVersion(memoPath: string): string {
  try {
    const sha = createHash("sha256").update(readFileSync(memoPath)).digest("hex");
    return sha === PINNED_MEMO_SHA256 ? `OptMem ${PINNED_MEMO_REV.slice(0, 7)} (pinned, sha256 ok)` : `unknown build (sha256 ${sha.slice(0, 12)})`;
  } catch {
    return "missing";
  }
}

const paths: Handler = async (_args, c) => {
  const lines = [
    `memo: ${c.paths.memoPath}`,
    `memo version: ${memoVersion(c.paths.memoPath)}`,
    `memory: ${c.paths.memoryDir}${c.env.MEMORY_DIR ? " (from MEMORY_DIR)" : ""}`,
    `user config: ${configPath(c.env)}`,
    `profile defaults: ${defaultsPath(c.env)}`,
    `model: ${c.config.model}`,
    `default mode: ${c.config.defaultMode}`,
  ];
  c.ctx.ui.notify(lines.join("\n"), "info");
};

async function writeConfig(c: CommandEnv, change: (current: Record<string, unknown>) => Record<string, unknown>, done: string) {
  try {
    updateUserConfig(change, c.env);
  } catch (error) {
    c.ctx.ui.notify(`Not saved: ${(error as Error).message}`, "error");
    return;
  }
  await c.reloadConfig();
  c.ctx.ui.notify(done, "info");
}

const defaultMode: Handler = async (args, c) => {
  const choice = await pick(c, args, `Default mode for new sessions (now ${c.config.defaultMode})`, ["on", "read", "off"]);
  if (!choice || !isMode(choice)) return;
  await writeConfig(c, (cur) => ({ ...cur, defaultMode: choice }), `New sessions start with mem:${choice}.`);
};

const rule: Handler = async (args, c) => {
  const cwd = c.ctx.cwd;
  const existing = c.config.rules.find((r) => expandHome(r.cwd) === cwd);
  const choice = await pick(c, args, `Rule for ${cwd}${existing ? ` (now ${existing.mode})` : ""}`, ["on", "read", "off", "clear"]);
  if (!choice) return;
  await writeConfig(
    c,
    (cur) => {
      const rules = (Array.isArray(cur.rules) ? cur.rules : []).filter(
        (r) => !(r && typeof r === "object" && expandHome(String((r as { cwd?: unknown }).cwd)) === cwd),
      );
      if (choice !== "clear") rules.push({ cwd, mode: choice });
      return { ...cur, rules };
    },
    choice === "clear" ? `Cleared the rule for ${cwd}.` : `New sessions in ${cwd} start with mem:${choice}.`,
  );
};

const model: Handler = async (args, c) => {
  let choice = args.trim();
  if (!choice && c.ctx.hasUI) {
    const available = c.ctx.modelRegistry.getAvailable().map((m) => `${m.provider}/${m.id}`);
    const options = [...new Set([c.config.model, ...available])];
    choice = (await c.ctx.ui.select(`Model for generation and naps (now ${c.config.model})`, options)) ?? "";
  }
  if (!choice) return;
  await writeConfig(c, (cur) => ({ ...cur, model: choice }), `Generation and naps use ${choice}.`);
};

const stats: Handler = async (_args, c) => {
  const s = storeStats(c.paths.memoryDir);
  if (!s.exists) {
    c.ctx.ui.notify(`No memory at ${c.paths.memoryDir} yet.`, "info");
    return;
  }
  const lines = [
    `memories: ${s.count}`,
    `first: ${s.first ?? "-"}, last: ${s.last ?? "-"}`,
    `pending naps: ${s.pending}`,
    `size: ${formatBytes(s.bytes)}`,
  ];
  c.ctx.ui.notify(lines.join("\n"), "info");
};

const forget: Handler = async (args, c) => {
  if (!requireMemo(c)) return;
  const range = await ask(c, args, "Forget a summary (the log keeps every memory)", "e.g. 16-31");
  if (!range) return;
  if (c.ctx.hasUI) {
    const ok = await c.ctx.ui.confirm("Forget summary", `Drop summary ${range} and every summary built on it? Naps rebuild them.`);
    if (!ok) return;
  }
  const out = await memoOutput(c, ["forget", range]);
  c.ctx.ui.notify(out.text, out.ok ? "info" : "warning");
};

export const HANDLERS: Record<string, Handler> = {
  view,
  search,
  zoom,
  log,
  reveal,
  config,
  paths,
  default: defaultMode,
  rule,
  model,
  stats,
  forget,
};
