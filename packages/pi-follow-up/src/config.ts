import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export const CONFIG_FILE_NAME = "pi-follow-up.json";

export const DEFAULT_PROMPT = `Suggest the next user message for this conversation. Return exactly the requested number of concise, distinct, natural replies. They may be questions, confirmations, corrections, or useful next tasks. Do not explain your choices. Call the follow_up_suggestions tool and provide only its suggestion strings.`;

export type FollowUpConfig = {
  readonly threshold: number;
  readonly recentMessages: number;
  readonly count: number;
  readonly prompt: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: ThinkingLevel;
};

export const DEFAULT_CONFIG: FollowUpConfig = {
  threshold: 1_200,
  recentMessages: 3,
  count: 3,
  prompt: DEFAULT_PROMPT,
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  thinking: "low",
};

export type ConfigParseResult =
  | { readonly ok: true; readonly config: FollowUpConfig }
  | { readonly ok: false; readonly error: string };

const CONFIG_KEYS = new Set<keyof FollowUpConfig>([
  "threshold",
  "recentMessages",
  "count",
  "prompt",
  "provider",
  "model",
  "thinking",
]);
const THINKING_LEVELS = new Set<ThinkingLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

type FieldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

function positiveInteger(
  record: Record<string, unknown>,
  key: "threshold" | "recentMessages" | "count",
): FieldResult<number> {
  const value = record[key];
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG[key] };
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? { ok: true, value }
    : { ok: false, error: `${key} must be a positive integer` };
}

function nonEmptyText(
  record: Record<string, unknown>,
  key: "prompt" | "provider" | "model",
): FieldResult<string> {
  const value = record[key];
  if (value === undefined) return { ok: true, value: DEFAULT_CONFIG[key] };
  return typeof value === "string" && value.trim().length > 0
    ? { ok: true, value }
    : { ok: false, error: `${key} must be a non-empty string` };
}

export function parseFollowUpConfig(value: unknown): ConfigParseResult {
  if (!isRecord(value)) return { ok: false, error: "expected a JSON object" };

  const unknownKey = Object.keys(value).find((key) => !CONFIG_KEYS.has(key as keyof FollowUpConfig));
  if (unknownKey) return { ok: false, error: `unknown property ${JSON.stringify(unknownKey)}` };

  const threshold = positiveInteger(value, "threshold");
  if (!threshold.ok) return threshold;
  const recentMessages = positiveInteger(value, "recentMessages");
  if (!recentMessages.ok) return recentMessages;
  const count = positiveInteger(value, "count");
  if (!count.ok) return count;

  const prompt = nonEmptyText(value, "prompt");
  if (!prompt.ok) return prompt;
  const provider = nonEmptyText(value, "provider");
  if (!provider.ok) return provider;
  const model = nonEmptyText(value, "model");
  if (!model.ok) return model;

  const configuredThinking = value.thinking;
  const thinking = configuredThinking === undefined ? DEFAULT_CONFIG.thinking : configuredThinking;
  if (typeof thinking !== "string" || !THINKING_LEVELS.has(thinking as ThinkingLevel)) {
    return { ok: false, error: "thinking must be one of minimal, low, medium, high, xhigh, or max" };
  }

  return {
    ok: true,
    config: {
      threshold: threshold.value,
      recentMessages: recentMessages.value,
      count: count.value,
      prompt: prompt.value,
      provider: provider.value,
      model: model.value,
      thinking: thinking as ThinkingLevel,
    },
  };
}

export function followUpConfigPath(agentDir = getAgentDir()): string {
  return join(agentDir, CONFIG_FILE_NAME);
}

function isFileError(error: unknown, code: string): boolean {
  return Boolean(error) && typeof error === "object" && (error as NodeJS.ErrnoException).code === code;
}

async function readConfig(path: string): Promise<FollowUpConfig> {
  const source = await readFile(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}`, { cause: error });
  }

  const result = parseFollowUpConfig(value);
  if (!result.ok) throw new Error(`Invalid pi-follow-up config ${path}: ${result.error}`);
  return result.config;
}

export async function loadOrCreateFollowUpConfig(path = followUpConfigPath()): Promise<FollowUpConfig> {
  try {
    return await readConfig(path);
  } catch (error) {
    if (!isFileError(error, "ENOENT")) throw error;
  }

  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return DEFAULT_CONFIG;
  } catch (error) {
    if (isFileError(error, "EEXIST")) return readConfig(path);
    throw new Error(`Failed to create ${path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
