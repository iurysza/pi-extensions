import { homedir } from "node:os";
import { isAbsolute, join, resolve, sep } from "node:path";

export type MemoryMode = "off" | "read" | "on";
export const MODES: readonly MemoryMode[] = ["off", "read", "on"];

export function isMode(value: unknown): value is MemoryMode {
  return value === "off" || value === "read" || value === "on";
}

// ---------------------------------------------------------------- config

export type CwdRule = { readonly cwd: string; readonly mode: MemoryMode };

export type OptMemConfig = {
  readonly defaultMode: MemoryMode;
  readonly subagentMode: "off" | "read";
  readonly memoPath: string;
  readonly memoryDir: string;
  readonly rules: readonly CwdRule[];
};

export const DEFAULT_MEMO_PATH = "~/.local/share/optmem/memo";
export const DEFAULT_MEMORY_DIR = "~/.local/share/optmem/memory";

export const DEFAULT_CONFIG: OptMemConfig = {
  defaultMode: "off",
  subagentMode: "off",
  memoPath: DEFAULT_MEMO_PATH,
  memoryDir: DEFAULT_MEMORY_DIR,
  rules: [],
};

export function expandHome(path: string, home = homedir()): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}

export type ConfigResult =
  | { readonly ok: true; readonly config: OptMemConfig }
  | { readonly ok: false; readonly error: string };

const CONFIG_KEYS = new Set(["defaultMode", "subagentMode", "memoPath", "memoryDir", "rules"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseConfig(value: unknown): ConfigResult {
  if (!isRecord(value)) return { ok: false, error: "expected a JSON object" };
  const unknown = Object.keys(value).find((key) => !CONFIG_KEYS.has(key));
  if (unknown) return { ok: false, error: `unknown property ${JSON.stringify(unknown)}` };

  const defaultMode = value.defaultMode ?? DEFAULT_CONFIG.defaultMode;
  if (!isMode(defaultMode)) return { ok: false, error: "defaultMode must be off, read or on" };
  const subagentMode = value.subagentMode ?? DEFAULT_CONFIG.subagentMode;
  if (subagentMode !== "off" && subagentMode !== "read") {
    return { ok: false, error: "subagentMode must be off or read" };
  }
  const memoPath = value.memoPath ?? DEFAULT_CONFIG.memoPath;
  const memoryDir = value.memoryDir ?? DEFAULT_CONFIG.memoryDir;
  if (typeof memoPath !== "string" || !memoPath.trim()) return { ok: false, error: "memoPath must be a non-empty string" };
  if (typeof memoryDir !== "string" || !memoryDir.trim()) return { ok: false, error: "memoryDir must be a non-empty string" };

  const rawRules = value.rules ?? [];
  if (!Array.isArray(rawRules)) return { ok: false, error: "rules must be an array" };
  const rules: CwdRule[] = [];
  for (const [index, rule] of rawRules.entries()) {
    if (!isRecord(rule) || typeof rule.cwd !== "string" || !rule.cwd.trim() || !isMode(rule.mode)) {
      return { ok: false, error: `rules[${index}] must be { "cwd": string, "mode": "off" | "read" | "on" }` };
    }
    rules.push({ cwd: rule.cwd, mode: rule.mode });
  }
  return { ok: true, config: { defaultMode, subagentMode, memoPath, memoryDir, rules } };
}

/** Effective paths. `MEMORY_DIR` in the environment wins over the config file. */
export function resolvePaths(
  config: OptMemConfig,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): { memoPath: string; memoryDir: string } {
  return {
    memoPath: resolve(expandHome(config.memoPath, home)),
    memoryDir: resolve(expandHome(env.MEMORY_DIR || config.memoryDir, home)),
  };
}

// ---------------------------------------------------------------- mode resolution

export type FlagValues = {
  readonly memory?: boolean | string;
  readonly memoryRead?: boolean | string;
  readonly noMemory?: boolean | string;
};

export type ModeSource = "flag" | "session" | "rule" | "default";

export type ModeResolution = {
  readonly mode: MemoryMode;
  readonly source: ModeSource;
  /** True when the subagent cap lowered the requested mode. */
  readonly capped: boolean;
};

/** The most restrictive flag wins when several are given. */
export function modeFromFlags(flags: FlagValues): MemoryMode | undefined {
  if (flags.noMemory === true) return "off";
  if (flags.memoryRead === true) return "read";
  if (flags.memory === true) return "on";
  return undefined;
}

export function modeFromRules(rules: readonly CwdRule[], cwd: string, home = homedir()): MemoryMode | undefined {
  let best: { length: number; mode: MemoryMode } | undefined;
  const target = resolve(cwd);
  for (const rule of rules) {
    const base = resolve(expandHome(rule.cwd, home));
    const inside = target === base || target.startsWith(base.endsWith(sep) ? base : base + sep);
    if (inside && (!best || base.length > best.length)) best = { length: base.length, mode: rule.mode };
  }
  return best?.mode;
}

export const RANK: Record<MemoryMode, number> = { off: 0, read: 1, on: 2 };

export function capMode(mode: MemoryMode, cap: MemoryMode): MemoryMode {
  return RANK[mode] > RANK[cap] ? cap : mode;
}

/** flag > persisted session entry > cwd rule > default, then the subagent cap. */
export function resolveMode(input: {
  readonly flags: FlagValues;
  readonly persisted: MemoryMode | undefined;
  readonly config: OptMemConfig;
  readonly cwd: string;
  readonly isSubagent: boolean;
  readonly home?: string;
}): ModeResolution {
  const fromFlag = modeFromFlags(input.flags);
  const fromRule = modeFromRules(input.config.rules, input.cwd, input.home);
  const [requested, source]: [MemoryMode, ModeSource] =
    fromFlag !== undefined
      ? [fromFlag, "flag"]
      : input.persisted !== undefined
        ? [input.persisted, "session"]
        : fromRule !== undefined
          ? [fromRule, "rule"]
          : [input.config.defaultMode, "default"];
  if (!input.isSubagent) return { mode: requested, source, capped: false };
  const mode = capMode(requested, input.config.subagentMode);
  return { mode, source, capped: mode !== requested };
}

/**
 * How a session tells it is a child. `@tintinweb/pi-subagents` (Agent tool,
 * workflows, schedules) binds child sessions without a mode or UI, so they run
 * as "print". Out-of-process spawners run `pi --mode json -p`. A spawner can
 * also set PI_OPTMEM_SUBAGENT=1 explicitly.
 */
export function detectSubagent(mode: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PI_OPTMEM_SUBAGENT === "1") return true;
  return mode === "print" || mode === "json";
}

export const MODE_ENTRY = "optmem-mode";

export type ModeEntryData = { readonly mode: MemoryMode };

/** Latest persisted mode on the current branch. */
export function persistedMode(branch: readonly unknown[]): MemoryMode | undefined {
  let found: MemoryMode | undefined;
  for (const entry of branch) {
    if (!isRecord(entry) || entry.type !== "custom" || entry.customType !== MODE_ENTRY) continue;
    const data = entry.data;
    if (isRecord(data) && isMode(data.mode)) found = data.mode;
  }
  return found;
}

// ---------------------------------------------------------------- tools

export const TOOL_NOTE = "memo_note";
export const TOOL_NAP = "memo_nap";
export const TOOL_ZOOM = "memo_zoom";
export const TOOL_RECALL = "memo_recall";
export const ALL_TOOLS = [TOOL_NOTE, TOOL_ZOOM, TOOL_RECALL, TOOL_NAP] as const;

export function toolsForMode(mode: MemoryMode): string[] {
  if (mode === "on") return [TOOL_NOTE, TOOL_ZOOM, TOOL_RECALL, TOOL_NAP];
  if (mode === "read") return [TOOL_ZOOM, TOOL_RECALL];
  return [];
}

export function toolAllowed(tool: string, mode: MemoryMode): boolean {
  return toolsForMode(mode).includes(tool);
}

/** Replace this extension's tools in the active set, keeping everything else. */
export function nextActiveTools(active: readonly string[], mode: MemoryMode): string[] {
  const ours = new Set<string>(ALL_TOOLS);
  return [...active.filter((name) => !ours.has(name)), ...toolsForMode(mode)];
}

// ---------------------------------------------------------------- bash guard

const READ_COMMANDS = new Set(["wake", "zoom", "recall"]);
const INTERPRETERS = new Set(["python", "python3"]);

function basename(word: string): string {
  const parts = word.split("/");
  return parts[parts.length - 1] ?? word;
}

/** A word that names memo: `memo`, `memo.py`, any path ending in them, or the configured path. */
export function isMemoWord(word: string, memoPath?: string): boolean {
  const name = basename(word);
  return name === "memo" || name === "memo.py" || (memoPath !== undefined && word === memoPath);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MEMO_MENTION = /(^|[\s/'"`=;&|()<>{}$])memo(\.py)?(?=$|[\s'"`;&|()<>{}])/;

/** True when the command mentions memo anywhere, in any form. Deliberately over-matches. */
export function mentionsMemo(command: string, memoPath?: string, memoryDir?: string): boolean {
  if (MEMO_MENTION.test(command)) return true;
  for (const path of [memoPath, memoryDir]) {
    if (path && new RegExp(escapeRegExp(path)).test(command)) return true;
  }
  return false;
}

/**
 * Split a simple command into words. Returns undefined for anything that is
 * not a simple command: unquoted operators, redirections, grouping,
 * substitutions anywhere, or unbalanced quotes.
 */
export function simpleWords(command: string): string[] | undefined {
  if (/[`$\\\n\r]/.test(command)) return undefined;
  const words: string[] = [];
  let current = "";
  let started = false;
  let quote: "'" | '"' | undefined;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
      continue;
    }
    if (";&|<>(){}!#*?[]".includes(char)) return undefined;
    current += char;
    started = true;
  }
  if (quote) return undefined;
  if (started) words.push(current);
  return words;
}

/** `[VAR=x ...] [python3] memo wake|zoom|recall args...`, and nothing else. */
export function isReadOnlyMemoCommand(command: string, memoPath?: string): boolean {
  const words = simpleWords(command.trim());
  if (!words || words.length === 0) return false;
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]!)) i++;
  if (words[i] !== undefined && INTERPRETERS.has(words[i]!)) i++;
  const head = words[i];
  const sub = words[i + 1];
  return head !== undefined && isMemoWord(head, memoPath) && sub !== undefined && READ_COMMANDS.has(sub);
}

export type GuardDecision = { readonly allow: true } | { readonly allow: false; readonly reason: string };

/**
 * Fail closed. In off mode any mention of memo is blocked. In read mode only a
 * simple read-only memo command passes; every other mention is blocked.
 */
export function guardBash(command: string, mode: MemoryMode, memoPath?: string, memoryDir?: string): GuardDecision {
  if (mode === "on" || !mentionsMemo(command, memoPath, memoryDir)) return { allow: true };
  if (mode === "off") {
    return {
      allow: false,
      reason: "Memory is off in this session, so commands that mention memo are blocked. The user can enable it with /memory on.",
    };
  }
  if (isReadOnlyMemoCommand(command, memoPath)) return { allow: true };
  return {
    allow: false,
    reason:
      "Memory is read-only in this session. Only a simple `memo wake`, `memo zoom` or `memo recall` command may mention memo; use memo_zoom or memo_recall instead.",
  };
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Point bash-run memo at the configured store. */
export function withMemoryDir(command: string, memoryDir: string): string {
  return `export MEMORY_DIR=${shellQuote(memoryDir)}; ${command}`;
}

export function isInside(parent: string, child: string): boolean {
  const base = resolve(parent);
  const target = resolve(child);
  return target === base || target.startsWith(base + sep);
}

export function resolveToolPath(path: string, cwd: string, home = homedir()): string {
  const expanded = expandHome(path.replace(/^@/, ""), home);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

// ---------------------------------------------------------------- memo output

/** Turn the `Run: <memo> nap a-b "<your line>"` lines memo prints into tool calls. Paths may contain spaces. */
export function rewriteForTools(text: string): string {
  return text
    .replace(/^Run: .+ nap (\d+-\d+) "<your line>"$/gm, 'Call memo_nap with range "$1" and line "<your line>" before your next action.')
    .replace(/Run: .+ nap$/gm, "Call memo_nap with the range and line it asks for.")
    .replace(/Run: .+ wake( \d+)*$/gm, "The memory view reloads on the next turn.")
    .replace(/Record the first with: .+ note "<one line>"$/gm, "Record the first with memo_note.");
}

export type WakePart = {
  readonly lines: string[];
  /** Arguments for the next part, when memo says it is not awake yet. */
  readonly next: readonly [string, string] | undefined;
  /** True only when memo printed "You are awake.". */
  readonly awake: boolean;
  /** Anything printed after "You are awake.", such as a pending compression. */
  readonly tail: string;
};

const PART_HEADER = /^Your memory, part \d+ of \d+, oldest first \(.*\)\.$/;
// Anchored on the suffix: the memo path before ` wake` may contain spaces.
const NOT_AWAKE = /^Not awake yet\. Run: .+ wake (\d+) (\d+)$/;

export function parseWakePart(output: string): WakePart {
  const lines: string[] = [];
  const all = output.replace(/\r/g, "").split("\n");
  for (let i = 0; i < all.length; i++) {
    const line = all[i]!;
    const notAwake = NOT_AWAKE.exec(line.trim());
    if (notAwake) return { lines, next: [notAwake[1]!, notAwake[2]!], awake: false, tail: "" };
    if (line.trim() === "You are awake.") {
      return { lines, next: undefined, awake: true, tail: all.slice(i + 1).join("\n").trim() };
    }
    if (PART_HEADER.test(line.trim())) continue;
    if (line.trim() !== "") lines.push(line);
  }
  return { lines, next: undefined, awake: false, tail: "" };
}

export type WakeResult =
  | { readonly kind: "awake"; readonly lines: string[]; readonly nap: string }
  | { readonly kind: "blocked"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export type MemoRun = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const MAX_WAKE_PARTS = 32;

/** Run `memo wake`, then every part it asks for, and join them. */
export async function wakeAll(run: MemoRun): Promise<WakeResult> {
  const lines: string[] = [];
  let args = ["wake"];
  for (let count = 0; count < MAX_WAKE_PARTS; count++) {
    const result = await run(args);
    if (result.code !== 0) {
      if (/^Cannot wake:/m.test(result.stdout)) return { kind: "blocked", message: result.stdout.trim() };
      return { kind: "error", message: (result.stderr || result.stdout).trim() || `memo exited with ${result.code}` };
    }
    const part = parseWakePart(result.stdout);
    lines.push(...part.lines);
    if (part.awake) return { kind: "awake", lines, nap: part.tail };
    if (!part.next) return { kind: "error", message: "memo wake ended without \"You are awake.\" or a next part" };
    args = ["wake", part.next[0], part.next[1]];
  }
  return { kind: "error", message: `memo wake asked for more than ${MAX_WAKE_PARTS} parts` };
}

// ---------------------------------------------------------------- prompts

export const WAKE_MESSAGE = "optmem-wake";

export function systemSection(mode: MemoryMode, memoryDir: string): string | undefined {
  if (mode === "off") return undefined;
  const shared = [
    "Your memories also form a binary tree. Every `#a-b` line in the wake view is one node.",
    "`memo_zoom` opens a node into its two halves, down to the raw memories.",
    "`memo_recall` searches every memory ever recorded with a case-insensitive regex.",
    `Never edit or delete anything under \`${memoryDir}\`. The tool manages it.`,
  ];
  if (mode === "read") {
    return [
      "## Memory (OptMem, read-only)",
      "",
      "This session can read your permanent memory but must not write to it.",
      "The wake view arrives as a message tagged <optmem-wake> at the start of the conversation. Use it as background about the user and past work.",
      "",
      ...shared.map((line) => `- ${line}`),
      "- Do not record or compress memories. If something is worth keeping, tell the user so they can note it in a session with memory on.",
    ].join("\n");
  }
  return [
    "## Memory (OptMem)",
    "",
    "Your memory is OptMem. It outlives every session, compaction, model and vendor change.",
    "The wake view arrives as a message tagged <optmem-wake> at the start of the conversation. Read it before you act.",
    "",
    "### Register memories",
    "",
    "- Call `memo_note` with one line of at most 280 bytes whenever you learn something new or something worth keeping happens: a task worth real effort, a fact or insight the user teaches you, anything about their life, any event of lasting effect.",
    "- Do not register redundant memories.",
    "- Store pointers, not payloads: name the vault note or file that holds the details. Never store IDs, credentials, tokens or other secrets.",
    "- If a memo tool result asks for a compression, call `memo_nap` with that range and your merged line before your next action.",
    "",
    "### Find old memories",
    "",
    ...shared.map((line) => `- ${line}`),
    "",
    "### Subagents",
    "",
    "Subagents never write memories. When you spawn one, write: `You are a subagent. Don't run memo.`",
  ].join("\n");
}

export function wakeMessage(mode: MemoryMode, result: WakeResult): string {
  if (result.kind === "error") {
    return `<optmem-wake status="error">\nMemory could not be loaded: ${result.message}\n</optmem-wake>`;
  }
  if (result.kind === "blocked") {
    if (mode === "on") {
      return [
        '<optmem-wake status="needs-compression">',
        rewriteForTools(result.message),
        "Do the compressions with memo_nap first. The memory view loads on the next turn.",
        "</optmem-wake>",
      ].join("\n");
    }
    return '<optmem-wake status="unavailable">\nMemory needs compressions that a read-only session cannot do. Continue without it.\n</optmem-wake>';
  }
  const body = result.lines.length ? result.lines.join("\n") : "No memories yet.";
  const parts = [`<optmem-wake mode="${mode}">`, body, "</optmem-wake>"];
  if (mode === "on" && result.nap) parts.push("", rewriteForTools(result.nap));
  return parts.join("\n");
}

export function missingMemoHint(memoPath: string): string {
  return `OptMem's memo was not found at ${memoPath}. Install it with packages/pi-optmem/scripts/install-memo.sh, then run /memory again.`;
}
