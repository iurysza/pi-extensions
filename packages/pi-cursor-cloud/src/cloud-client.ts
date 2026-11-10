import type { SDKAgent, SendOptions, RunResult } from "@cursor/sdk";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Activity, Outcome } from "./state.js";

// @cursor/sdk is heavy: load it on first Cloud call, never at Pi startup (tests/startup-import-graph.test.mjs).
type CursorSdk = typeof import("@cursor/sdk");
let loadedSdk: CursorSdk | undefined;
async function cursorSdk(): Promise<CursorSdk> {
  return loadedSdk ??= await import("@cursor/sdk");
}

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

const BUSY = "Agent already has an active run. Wait until it is idle before sending a follow-up.";
const SECRETS = [/crsr_[A-Za-z0-9_-]+/g, /Bearer\s+\S+/gi, /[\w-]*(?:key|token|secret|password)\s*[=:]\s*\S+/gi];

/** Server text is untrusted: redact the key and anything token-like, keep one short line. */
export function safeText(text: string, key: string, max = 300): string {
  let clean = redact(text, key);
  for (const pattern of SECRETS) clean = clean.replace(pattern, "[redacted]");
  clean = clean.replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function safeHelpUrl(value: unknown, key: string): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return safeText(url.href, key) === url.href ? url.href : undefined;
  } catch { return undefined; }
}

const field = (error: Error, name: string): unknown => Reflect.get(error, name);
const token = (value: unknown): string | undefined =>
  typeof value === "string" && /^[\w.:-]{1,128}$/.test(value) ? value : undefined;
const providerName = (value: string) => ({ github: "GitHub", gitlab: "GitLab", bitbucket: "Bitbucket" })[value.toLowerCase()] ?? value;

type Kind = "billing" | "auth" | "integration" | "rateLimit" | "configuration" | "network" | "busy" | "notFound" | "unknown";

/** instanceof first; the name fallback covers errors from another copy of the SDK. */
function kindOf(error: Error): Kind | undefined {
  const errorName = error.name;
  // SDK errors come from SDK calls, so the SDK is loaded by then. Before that only the name check can match.
  type ErrorClass = "AgentBusyError" | "IntegrationNotConnectedError" | "AuthenticationError" | "RateLimitError" | "ConfigurationError"
    | "NetworkError" | "AgentNotFoundError" | "UnknownAgentError" | "CursorSdkError";
  const is = (type: ErrorClass, name: string = type) => {
    const value = loadedSdk?.[type];
    return (value !== undefined && error instanceof value) || errorName === name;
  };
  if (is("AgentBusyError") || error.message.includes("[agent_busy]")) return "busy";
  if (is("IntegrationNotConnectedError") || field(error, "code") === "integration_not_connected") return "integration";
  if (field(error, "code") === "usage_limit_exceeded") return "billing";
  if (is("AuthenticationError")) return "auth";
  if (is("RateLimitError")) return "rateLimit";
  if (is("ConfigurationError")) return "configuration";
  if (is("NetworkError")) return "network";
  if (is("AgentNotFoundError")) return "notFound";
  if (is("UnknownAgentError") || is("CursorSdkError") || is("CursorSdkError", "CursorAgentError")) return "unknown";
  return undefined;
}

/**
 * Plain, credential-free text for an SDK failure. Never uses `cause`, stacks, or serialized
 * errors: they can include a client holding credentials. Unknown non-SDK errors stay generic.
 */
export function cloudError(error: unknown, operation: string, key = ""): string {
  const generic = `Cursor Cloud ${operation} failed. Check authentication, repository access, and Cursor service availability.`;
  if (!(error instanceof Error)) return generic;
  const kind = kindOf(error);
  if (kind === "busy") return BUSY;
  if (!kind) return generic;
  const code = token(field(error, "code"));
  const status = field(error, "status");
  const requestId = token(field(error, "requestId"));
  const provider = typeof field(error, "provider") === "string" ? safeText(providerName(String(field(error, "provider"))), key, 40) : "";
  const helpUrl = safeHelpUrl(field(error, "helpUrl"), key);
  const [label, hint] = {
    billing: ["usage limit reached", "Add funds or enable auto top-up in Cursor billing settings."],
    auth: ["authentication rejected", "Check the API key. Team Admin API keys do not work for Cloud Agents; use a user or service-account key."],
    integration: [`${provider || "source control"} integration not connected`,
      helpUrl ? `Connect it: ${helpUrl}` : "Connect the integration in Cursor and grant it access to the repository."],
    rateLimit: ["rate limited", "Retry later."],
    configuration: ["request rejected", "Check the model, repository URL, branch, and team admin policy."],
    network: ["network or service error", "Check your connection and Cursor service status, then retry."],
    notFound: ["agent not found", "It may have been deleted or never created. Start a new agent."],
    unknown: ["unexpected Cursor error", "Check authentication, repository access, and Cursor service availability."],
  }[kind];
  const facts = [code, typeof status === "number" && Number.isInteger(status) ? `HTTP ${status}` : undefined].filter(Boolean).join(", ");
  const message = safeText(error.message.replace(/^\[[^\]]*\]\s*/, ""), key);
  return [`Cursor Cloud ${operation} failed: ${label}${facts ? ` (${facts})` : ""}.`,
    message && `Cursor said: ${message.replace(/[.!?…]?$/, m => m || ".")}`, `${hint.replace(/[.!?]?$/, m => m || ".")}`,
    requestId && `Request: ${requestId}`].filter(Boolean).join(" ");
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
      try { agent.close(); } catch (error) { throw new Error(cloudError(error, "close", key)); }
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
            try { await run.cancel(); } catch (error) { throw new Error(cloudError(error, "cancel", key)); }
          },
          async wait() {
            try { return mapCompletion(await run.wait(), key); }
            catch (error) { throw new Error(cloudError(error, "wait", key)); }
          },
        };
      } catch (error) { throw new Error(cloudError(error, "send", key)); }
    },
  };
}

export function createCloudClient(getKey: () => Promise<string> = readApiKey): CloudClient {
  return {
    async models() {
      const apiKey = await getKey();
      try { return (await (await cursorSdk()).Cursor.models.list({ apiKey })).map(({ id, displayName }) => ({ id, displayName })); }
      catch (error) { throw new Error(cloudError(error, "model listing", apiKey)); }
    },
    async create(options) {
      const apiKey = await getKey();
      try {
        return wrapHandle(await (await cursorSdk()).Agent.create({ apiKey, model: { id: options.model },
          cloud: { repos: [{ url: options.repo, startingRef: options.ref }] } }), apiKey);
      } catch (error) { throw new Error(cloudError(error, "create", apiKey)); }
    },
    async delete(id) {
      const apiKey = await getKey();
      try { await (await cursorSdk()).Agent.delete(id, { apiKey }); }
      catch (error) { throw new Error(cloudError(error, "delete", apiKey)); }
    },
  };
}
