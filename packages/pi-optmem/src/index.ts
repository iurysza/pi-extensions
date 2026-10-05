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
  guardBash,
  mentionsMemo,
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

function isWakeMessage(message: unknown): boolean {
  const m = message as { role?: string; customType?: string } | undefined;
  return m?.role === "custom" && m.customType === WAKE_MESSAGE;
}

function isWakeEntry(entry: unknown): boolean {
  const e = entry as { type?: string; customType?: string } | undefined;
  return e?.type === "custom_message" && e.customType === WAKE_MESSAGE;
}

/** Remove matching items in place: Pi keeps references to these arrays. */
export function spliceWhere<T>(items: T[] | undefined, drop: (item: T) => boolean): void {
  if (!items) return;
  for (let i = items.length - 1; i >= 0; i--) if (drop(items[i]!)) items.splice(i, 1);
}

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
  /**
   * The wake view lives only in memory and is injected per request by the
   * `context` hook. It is never persisted, so compaction and branch summaries
   * cannot see it. `ok` views are reused; failed attempts retry next prompt.
   */
  let view: { mode: MemoryMode; ok: boolean; content: string; lines: number } | undefined;

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

  function setMode(next: MemoryMode, ctx: ExtensionContext): void {
    if (next !== mode) view = undefined;
    mode = next;
    pi.setActiveTools(nextActiveTools(pi.getActiveTools(), mode));
    updateStatus(ctx);
  }

  /** Mode for the current branch. CLI flags count only for the process's first session. */
  function resolveForBranch(ctx: ExtensionContext, useFlags: boolean) {
    const persisted = persistedMode(ctx.sessionManager.getBranch());
    const resolution = resolveMode({
      flags: useFlags
        ? { memory: pi.getFlag("memory"), memoryRead: pi.getFlag("memory-read"), noMemory: pi.getFlag("no-memory") }
        : {},
      persisted,
      config,
      cwd: ctx.cwd,
      isSubagent,
    });
    return { resolution, persisted };
  }

  pi.on("session_start", async (event, ctx) => {
    const loaded = await readConfig();
    config = loaded.config;
    if (loaded.error && ctx.hasUI) ctx.ui.notify(`pi-optmem: ${loaded.error}. Using defaults.`, "warning");

    isSubagent = detectSubagent(ctx.mode, env);
    view = undefined;
    // Reload keeps flag values, so applying them again would undo a /memory switch.
    const { resolution, persisted } = resolveForBranch(ctx, event.reason === "startup");
    source = resolution.source;
    mode = "off";
    setMode(resolution.mode, ctx);
    if (!isSubagent && resolution.mode !== persisted) pi.appendEntry(MODE_ENTRY, { mode });
    if (mode !== "off" && ctx.hasUI && !memoExists(paths().memoPath)) {
      ctx.ui.notify(missingMemoHint(paths().memoPath), "warning");
    }
  });

  // Branch navigation changes which mode entry is current; follow it.
  pi.on("session_tree", async (_event, ctx) => {
    const { resolution } = resolveForBranch(ctx, false);
    source = resolution.source;
    setMode(resolution.mode, ctx);
  });

  // Refresh the view after compaction so it picks up notes from the compacted turns.
  pi.on("session_compact", async () => {
    view = undefined;
  });

  // Legacy sessions persisted the wake view; keep it out of summaries.
  pi.on("session_before_compact", async (event) => {
    const prep = event.preparation;
    spliceWhere(prep.messagesToSummarize, isWakeMessage);
    spliceWhere(prep.turnPrefixMessages, isWakeMessage);
    return undefined;
  });

  pi.on("session_before_tree", async (event) => {
    spliceWhere(event.preparation.entriesToSummarize, isWakeEntry);
    return undefined;
  });

  pi.registerCommand("memory", {
    description: "Show or set OptMem memory for this session: /memory [on|off|read]",
    getArgumentCompletions: (prefix) =>
      MODES.filter((value) => value.startsWith(prefix.trim())).map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const requested = args.trim();
      const { memoPath, memoryDir } = paths();
      if (!requested) {
        const wake =
          mode === "off"
            ? "not loaded"
            : view?.ok && view.mode === mode
              ? `loaded (${view.lines} lines)`
              : "loads on next turn";
        const lines = [
          `mode: ${mode} (${source}${isSubagent ? ", subagent" : ""})`,
          `memo: ${memoPath}${memoExists(memoPath) ? "" : " (missing)"}`,
          `memory: ${memoryDir}`,
          `config: ${configPath(env)}`,
          `wake: ${wake}`,
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
      setMode(requested, ctx);
      // An explicit switch also retries a failed or stale wake.
      view = undefined;
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

  async function loadView(): Promise<void> {
    const { memoPath } = paths();
    if (!memoExists(memoPath)) {
      view = {
        mode,
        ok: false,
        lines: 0,
        content: `<optmem-wake status="missing">\n${missingMemoHint(memoPath)}\n</optmem-wake>`,
      };
      return;
    }
    const result = await wakeAll(run);
    view = {
      mode,
      ok: result.kind === "awake",
      lines: result.kind === "awake" ? result.lines.length : 0,
      content: wakeMessage(mode, result),
    };
  }

  pi.on("before_agent_start", async (event) => {
    if (mode === "off") return undefined;
    if (!view || !view.ok || view.mode !== mode) await loadView();
    const section = systemSection(mode, paths().memoryDir);
    return section ? { systemPrompt: `${event.systemPrompt}\n\n${section}` } : undefined;
  });

  // Drop every persisted wake message, then add the current view at the front.
  pi.on("context", async (event) => {
    const messages = event.messages.filter((message) => !isWakeMessage(message));
    // Compaction can run mid-run (threshold or overflow) and continue without a
    // new prompt, so before_agent_start never fires. Reload a cleared view here.
    // Failed views stay as they are and retry on the next prompt.
    if (mode !== "off" && (!view || view.mode !== mode)) await loadView();
    if (mode !== "off" && view && view.mode === mode) {
      messages.unshift({
        role: "custom",
        customType: WAKE_MESSAGE,
        content: view.content,
        display: false,
        timestamp: 0,
      } as (typeof event.messages)[number]);
    }
    return messages.length === event.messages.length && messages.every((m, i) => m === event.messages[i])
      ? undefined
      : { messages };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const input = event.input as { command?: unknown };
      if (typeof input.command !== "string") return undefined;
      const { memoPath, memoryDir } = paths();
      const decision = guardBash(input.command, mode, memoPath, memoryDir);
      if (!decision.allow) return { block: true, reason: decision.reason };
      if (mentionsMemo(input.command, memoPath, memoryDir)) {
        input.command = withMemoryDir(input.command, memoryDir);
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
