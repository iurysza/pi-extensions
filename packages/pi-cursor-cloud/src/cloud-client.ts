import { Agent, Cursor, type SDKAgent, type SendOptions, type RunResult } from "@cursor/sdk";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Activity, Outcome } from "./state.js";

type Delta = Parameters<NonNullable<SendOptions["onDelta"]>>[0]["update"];
type Step = Parameters<NonNullable<SendOptions["onStep"]>>[0]["step"];
export type StreamEvent = { type: "delta" | "step"; activity: Activity };
export type Completion =
  | { type: "finished" | "cancelled"; result: Outcome }
  | { type: "error"; error: string; result: Outcome };
export interface SpawnOptions { repo: string; ref: string; model: string; name: string }
export interface CloudRun {
  id: string;
  wait(): Promise<Completion>;
  cancel(): Promise<void>;
}
export interface CloudHandle {
  id: string;
  send(prompt: string, emit: (event: StreamEvent) => void): Promise<CloudRun>;
  close(): void;
}
export interface CloudClient {
  models(): Promise<{ id: string; displayName?: string }[]>;
  create(options: SpawnOptions): Promise<CloudHandle>;
  delete(id: string): Promise<void>;
}

export async function readApiKey(): Promise<string> {
  if (process.env.CURSOR_API_KEY?.trim()) return process.env.CURSOR_API_KEY.trim();
  try {
    const auth: unknown = JSON.parse(await readFile(join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "auth.json"), "utf8"));
    if (typeof auth === "object" && auth !== null && "cursor" in auth) {
      const cursor = auth.cursor;
      if (typeof cursor === "object" && cursor !== null && "key" in cursor && typeof cursor.key === "string" && cursor.key.trim()) return cursor.key.trim();
    }
  } catch { /* Never attach the parsed auth or underlying exception to an error. */ }
  throw new Error("Cursor Cloud needs CURSOR_API_KEY or cursor.key in Pi's auth.json.");
}

export function redact(text: string, key: string): string {
  return key ? text.replaceAll(key, "[redacted]") : text;
}

/** No raw SDK errors: they can include a serialized client holding credentials. */
export function cloudError(error: unknown, operation: string): string {
  if (error instanceof Error && error.message.includes("[agent_busy]")) return "Agent already has an active run. Wait until it is idle before sending a follow-up.";
  return `Cursor Cloud ${operation} failed. Check authentication, repository access, and Cursor service availability.`;
}

function toolActivity(tool: { type: string; args?: unknown }): string {
  let detail = "";
  if (typeof tool.args === "object" && tool.args !== null) {
    for (const field of ["command", "path", "pattern", "query", "globPattern"] as const) {
      if (field in tool.args) {
        const value = Reflect.get(tool.args, field);
        if (typeof value === "string") { detail = value.slice(0, 200); break; }
      }
    }
  }
  return `${tool.type === "shell" ? "run_terminal_cmd" : tool.type}${detail ? `: ${detail}` : ""}`;
}

export function mapDelta(update: Delta): StreamEvent | undefined {
  switch (update.type) {
    case "thinking-delta": return { type: "delta", activity: { type: "thinking" } };
    case "text-delta": return { type: "delta", activity: { type: "text", text: update.text } };
    case "tool-call-started": return { type: "delta", activity: { type: "tool", callId: update.callId, activity: toolActivity(update.toolCall) } };
    default: return undefined;
  }
}

export function mapStep(step: Step): StreamEvent | undefined {
  switch (step.type) {
    case "thinkingMessage": return { type: "step", activity: { type: "thinking" } };
    case "assistantMessage": return { type: "step", activity: { type: "text", text: step.message.text, replace: true } };
    // Tool starts are counted by callId in onDelta, not counted twice here.
    case "toolCall": return { type: "step", activity: { type: "activity", activity: toolActivity(step.message) } };
    default: return undefined;
  }
}

export function mapCompletion(result: RunResult, key: string): Completion {
  const outcome: Outcome = {
    text: redact(result.result ?? "", key),
    durationMs: result.durationMs ?? 0,
    branches: (result.git?.branches ?? []).map(branch => ({
      repoUrl: redact(branch.repoUrl, key),
      branch: branch.branch === undefined ? undefined : redact(branch.branch, key),
      prUrl: branch.prUrl === undefined ? undefined : redact(branch.prUrl, key),
    })),
  };
  if (result.status === "error") return { type: "error", error: "Cursor Cloud run failed.", result: outcome };
  return { type: result.status === "cancelled" ? "cancelled" : "finished", result: outcome };
}

function wrapHandle(agent: SDKAgent, key: string): CloudHandle {
  return {
    id: agent.agentId,
    close() {
      try { agent.close(); } catch (error) { throw new Error(cloudError(error, "close")); }
    },
    async send(prompt, emit) {
      const publish = (event: StreamEvent | undefined) => {
        if (!event) return;
        const activity = event.activity;
        if (activity.type === "text") emit({ ...event, activity: { ...activity, text: redact(activity.text, key) } });
        else if (activity.type === "tool" || activity.type === "activity") emit({ ...event, activity: { ...activity, activity: redact(activity.activity, key) } });
        else emit(event);
      };
      try {
        const run = await agent.send(prompt, {
          onDelta: ({ update }) => publish(mapDelta(update)),
          onStep: ({ step }) => publish(mapStep(step)),
        });
        return {
          id: run.id,
          async cancel() {
            try { await run.cancel(); } catch (error) { throw new Error(cloudError(error, "cancel")); }
          },
          async wait() {
            try { return mapCompletion(await run.wait(), key); }
            catch (error) { throw new Error(cloudError(error, "wait")); }
          },
        };
      } catch (error) { throw new Error(cloudError(error, "send")); }
    },
  };
}

export function createCloudClient(getKey: () => Promise<string> = readApiKey): CloudClient {
  return {
    async models() {
      const apiKey = await getKey();
      try { return (await Cursor.models.list({ apiKey })).map(({ id, displayName }) => ({ id, displayName })); }
      catch (error) { throw new Error(cloudError(error, "model listing")); }
    },
    async create(options) {
      const apiKey = await getKey();
      try {
        return wrapHandle(await Agent.create({ apiKey, model: { id: options.model },
          cloud: { repos: [{ url: options.repo, startingRef: options.ref }] } }), apiKey);
      } catch (error) { throw new Error(cloudError(error, "create")); }
    },
    async delete(id) {
      const apiKey = await getKey();
      try { await Agent.delete(id, { apiKey }); }
      catch (error) { throw new Error(cloudError(error, "delete")); }
    },
  };
}
