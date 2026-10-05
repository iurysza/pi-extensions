import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  DEFAULT_CONFIG,
  MODE_ENTRY,
  MODES,
  TOOL_NAP,
  TOOL_NOTE,
  TOOL_RECALL,
  TOOL_ZOOM,
  WAKE_MESSAGE,
  detectSubagent,
  findMemoInvocations,
  guardBash,
  isInside,
  isMode,
  missingMemoHint,
  nextActiveTools,
  parseConfig,
  persistedMode,
  RANK,
  resolveMode,
  resolvePaths,
  resolveToolPath,
  rewriteForTools,
  systemSection,
  toolAllowed,
  wakeAll,
  wakeMessage,
  withMemoryDir,
  type MemoRun,
  type MemoryMode,
  type ModeSource,
  type OptMemConfig,
} from "./core.js";

export const CONFIG_FILE_NAME = "pi-optmem.json";
const STATUS_KEY = "optmem";

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.PI_OPTMEM_CONFIG || join(getAgentDir(), CONFIG_FILE_NAME);
}

export async function loadConfig(path: string): Promise<{ config: OptMemConfig; error?: string }> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { config: DEFAULT_CONFIG };
    return { config: DEFAULT_CONFIG, error: `cannot read ${path}: ${(error as Error).message}` };
  }
  try {
    const parsed = parseConfig(JSON.parse(text));
    return parsed.ok ? { config: parsed.config } : { config: DEFAULT_CONFIG, error: `${path}: ${parsed.error}` };
  } catch (error) {
    return { config: DEFAULT_CONFIG, error: `${path}: ${(error as Error).message}` };
  }
}

export function memoRunner(memoPath: string, memoryDir: string, env: NodeJS.ProcessEnv = process.env): MemoRun {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        memoPath,
        args,
        { env: { ...env, MEMORY_DIR: memoryDir }, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : "")) });
        },
      );
    });
}

export type OptMemDeps = {
  readonly env?: NodeJS.ProcessEnv;
  readonly loadConfig?: () => Promise<{ config: OptMemConfig; error?: string }>;
  readonly memoExists?: (path: string) => boolean;
  readonly runner?: (memoPath: string, memoryDir: string) => MemoRun;
};

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }], details: undefined };
}

export function registerOptMem(pi: ExtensionAPI, deps: OptMemDeps = {}): void {
  const env = deps.env ?? process.env;
  const readConfig = deps.loadConfig ?? (() => loadConfig(configPath(env)));
  const memoExists = deps.memoExists ?? existsSync;
  const makeRunner = deps.runner ?? ((memoPath: string, memoryDir: string) => memoRunner(memoPath, memoryDir, env));

  let config: OptMemConfig = DEFAULT_CONFIG;
  let mode: MemoryMode = "off";
  let source: ModeSource = "default";
  let isSubagent = false;
  let wakeLoaded = false;
  let lastWakeLines = 0;

  const paths = () => resolvePaths(config, env);
  const run: MemoRun = (args) => {
    const { memoPath, memoryDir } = paths();
    return makeRunner(memoPath, memoryDir)(args);
  };

  pi.registerFlag("memory", { description: "Start this session with OptMem memory on", type: "boolean" });
  pi.registerFlag("memory-read", { description: "Start this session with OptMem memory read-only", type: "boolean" });
  pi.registerFlag("no-memory", { description: "Start this session with OptMem memory off", type: "boolean" });

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    const missing = mode !== "off" && !memoExists(paths().memoPath);
    ctx.ui.setStatus(STATUS_KEY, `mem:${mode}${missing ? " (no memo)" : ""}`);
  }

  function applyMode(next: MemoryMode, ctx: ExtensionContext): void {
    if (next !== mode && next !== "off") wakeLoaded = false;
    mode = next;
    pi.setActiveTools(nextActiveTools(pi.getActiveTools(), mode));
    updateStatus(ctx);
  }

  function wakeOnBranch(ctx: ExtensionContext): boolean {
    const branch = ctx.sessionManager.getBranch();
    let lastCompaction = -1;
    branch.forEach((entry, index) => {
      if (entry.type === "compaction") lastCompaction = index;
    });
    return branch.some(
      (entry, index) => index > lastCompaction && entry.type === "custom_message" && entry.customType === WAKE_MESSAGE,
    );
  }

  pi.on("session_start", async (_event, ctx) => {
    const loaded = await readConfig();
    config = loaded.config;
    if (loaded.error && ctx.hasUI) ctx.ui.notify(`pi-optmem: ${loaded.error}. Using defaults.`, "warning");

    isSubagent = detectSubagent(ctx.mode, env);
    const persisted = persistedMode(ctx.sessionManager.getBranch());
    const resolution = resolveMode({
      flags: {
        memory: pi.getFlag("memory"),
        memoryRead: pi.getFlag("memory-read"),
        noMemory: pi.getFlag("no-memory"),
      },
      persisted,
      config,
      cwd: ctx.cwd,
      isSubagent,
    });
    source = resolution.source;
    mode = resolution.mode;
    wakeLoaded = mode !== "off" && wakeOnBranch(ctx);
    if (!isSubagent && resolution.mode !== persisted) pi.appendEntry(MODE_ENTRY, { mode });
    pi.setActiveTools(nextActiveTools(pi.getActiveTools(), mode));
    updateStatus(ctx);
    if (mode !== "off" && ctx.hasUI && !memoExists(paths().memoPath)) {
      ctx.ui.notify(missingMemoHint(paths().memoPath), "warning");
    }
  });

  pi.on("session_compact", () => {
    wakeLoaded = false;
  });

  pi.registerCommand("memory", {
    description: "Show or set OptMem memory for this session: /memory [on|off|read]",
    getArgumentCompletions: (prefix) =>
      MODES.filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const requested = args.trim();
      const { memoPath, memoryDir } = paths();
      if (!requested) {
        const lines = [
          `mode: ${mode} (${source}${isSubagent ? ", subagent" : ""})`,
          `memo: ${memoPath}${memoExists(memoPath) ? "" : " (missing)"}`,
          `memory: ${memoryDir}`,
          `config: ${configPath(env)}`,
          `wake: ${wakeLoaded ? `loaded (${lastWakeLines} lines this run)` : mode === "off" ? "not loaded" : "loads on next turn"}`,
        ];
        if (!memoExists(memoPath)) lines.push(missingMemoHint(memoPath));
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }
      if (!isMode(requested)) {
        ctx.ui.notify("Usage: /memory [on|off|read]", "warning");
        return;
      }
      if (isSubagent && RANK[requested] > RANK[config.subagentMode]) {
        ctx.ui.notify(`Subagent sessions cannot go above mem:${config.subagentMode}.`, "warning");
        return;
      }
      applyMode(requested, ctx);
      source = "session";
      pi.appendEntry(MODE_ENTRY, { mode });
      const note =
        mode === "off"
          ? "Memory off. Writes stop now; the wake view and instructions leave the next request."
          : "The wake view loads on the next turn.";
      ctx.ui.notify(`mem:${mode}. ${note}`, "info");
      if (mode !== "off" && !memoExists(memoPath)) ctx.ui.notify(missingMemoHint(memoPath), "warning");
    },
  });

  pi.on("before_agent_start", async (event) => {
    if (mode === "off") return undefined;
    const { memoPath, memoryDir } = paths();
    const section = systemSection(mode, memoryDir);
    const systemPrompt = section ? `${event.systemPrompt}\n\n${section}` : undefined;
    if (wakeLoaded) return { systemPrompt };

    if (!memoExists(memoPath)) {
      wakeLoaded = true;
      return {
        systemPrompt,
        message: {
          customType: WAKE_MESSAGE,
          content: `<optmem-wake status="missing">\n${missingMemoHint(memoPath)}\n</optmem-wake>`,
          display: false,
        },
      };
    }
    const result = await wakeAll(run);
    // A blocked wake in "on" mode retries next turn, after the agent naps.
    wakeLoaded = !(result.kind === "blocked" && mode === "on");
    lastWakeLines = result.kind === "awake" ? result.lines.length : 0;
    return {
      systemPrompt,
      message: { customType: WAKE_MESSAGE, content: wakeMessage(mode, result), display: false },
    };
  });

  // Keep only the newest wake view, and none while memory is off.
  pi.on("context", async (event) => {
    const isWake = (message: (typeof event.messages)[number]) =>
      message.role === "custom" && (message as { customType?: string }).customType === WAKE_MESSAGE;
    let last = -1;
    event.messages.forEach((message, index) => {
      if (isWake(message)) last = index;
    });
    if (last === -1) return undefined;
    const messages = event.messages.filter((message, index) => !isWake(message) || (mode !== "off" && index === last));
    return messages.length === event.messages.length ? undefined : { messages };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const input = event.input as { command?: unknown };
      if (typeof input.command !== "string") return undefined;
      const decision = guardBash(input.command, mode);
      if (!decision.allow) return { block: true, reason: decision.reason };
      if (findMemoInvocations(input.command).length > 0) {
        input.command = withMemoryDir(input.command, paths().memoryDir);
      }
      return undefined;
    }
    if (event.toolName === "edit" || event.toolName === "write") {
      const input = event.input as { path?: unknown };
      if (typeof input.path === "string" && isInside(paths().memoryDir, resolveToolPath(input.path, ctx.cwd))) {
        return { block: true, reason: "The memory directory is managed by memo. Do not edit it." };
      }
    }
    return undefined;
  });

  async function runTool(tool: string, args: string[]) {
    if (!toolAllowed(tool, mode)) {
      throw new Error(`${tool} is not available: memory is ${mode} in this session.`);
    }
    const { memoPath } = paths();
    if (!memoExists(memoPath)) throw new Error(missingMemoHint(memoPath));
    const result = await run(args);
    const output = rewriteForTools(`${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.trim());
    if (result.code !== 0) throw new Error(output || `memo exited with ${result.code}`);
    return text(output);
  }

  pi.registerTool({
    name: TOOL_NOTE,
    label: "Memo note",
    description:
      "Record one permanent memory: one line of at most 280 bytes. If the result asks for a compression, call memo_nap before your next action.",
    parameters: Type.Object({ line: Type.String({ description: "The memory, one line, at most 280 bytes" }) }),
    execute: async (_id, params) => runTool(TOOL_NOTE, ["note", params.line]),
  });

  pi.registerTool({
    name: TOOL_NAP,
    label: "Memo nap",
    description:
      "Answer a compression request: merge the listed memories into one line. Use the exact range from the request, like 0-1.",
    parameters: Type.Object({
      range: Type.String({ description: "Block id from the request, like 0-1 or 16-31" }),
      line: Type.String({ description: "The merged summary, one line, at most 280 bytes" }),
    }),
    execute: async (_id, params) => runTool(TOOL_NAP, ["nap", params.range, params.line]),
  });

  pi.registerTool({
    name: TOOL_ZOOM,
    label: "Memo zoom",
    description: "Open one node of the memory tree, like 16-31, into its two halves.",
    parameters: Type.Object({ range: Type.String({ description: "Block id as the wake view prints it, like 16-31" }) }),
    execute: async (_id, params) => runTool(TOOL_ZOOM, ["zoom", params.range]),
  });

  pi.registerTool({
    name: TOOL_RECALL,
    label: "Memo recall",
    description: "Search every memory ever recorded with a case-insensitive regex.",
    parameters: Type.Object({ regex: Type.String({ description: "Case-insensitive regular expression" }) }),
    execute: async (_id, params) => runTool(TOOL_RECALL, ["recall", params.regex]),
  });
}

export default function optmem(pi: ExtensionAPI): void {
  registerOptMem(pi);
}
