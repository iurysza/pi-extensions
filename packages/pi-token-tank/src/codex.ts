import type { CodexAuthResult, CredentialSourceLike } from "./auth.js";
import { getCodexAuth } from "./auth.js";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const FETCH_TIMEOUT_MS = 10_000;

interface CodexWindow {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_at?: unknown;
  [key: string]: unknown;
}

interface CodexUsageBody {
  plan_type?: unknown;
  rate_limit?: {
    primary_window?: CodexWindow;
    secondary_window?: CodexWindow;
  };
  [key: string]: unknown;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseWindow(
  value: unknown,
  fallback: Pick<QuotaWindow, "id" | "shortLabel" | "longLabel" | "resetStyle">,
): QuotaWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const usedPercent = toNumber(record.used_percent);
  if (usedPercent === undefined) return undefined;
  const durationSeconds = toNumber(record.limit_window_seconds);
  const window = durationSeconds === 5 * 60 * 60
    ? { id: "five-hour", shortLabel: "5h", longLabel: "5h", resetStyle: "time" as const }
    : durationSeconds === 7 * 24 * 60 * 60
      ? { id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time" as const }
      : fallback;
  const resetRaw = toNumber(record.reset_at);
  const resetsAt =
    resetRaw === undefined
      ? undefined
      : resetRaw < 1_000_000_000_000
        ? resetRaw * 1000
        : resetRaw;
  return {
    ...window,
    usedPercent: clampPercent(usedPercent),
    resetsAt,
  };
}

function parseCodexBody(body: unknown): Omit<ProviderQuota, "provider" | "state" | "fetchedAt" | "error"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid Codex usage response: expected object");
  }
  const record = body as CodexUsageBody;
  const primary = parseWindow(record.rate_limit?.primary_window, {
    id: "five-hour", shortLabel: "5h", longLabel: "5h", resetStyle: "time",
  });
  const secondary = parseWindow(record.rate_limit?.secondary_window, {
    id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time",
  });
  const windows = [primary, secondary].filter((window): window is QuotaWindow => Boolean(window));
  if (windows.length === 0) {
    throw new Error("Invalid Codex usage response: missing rate-limit windows");
  }
  return {
    plan: typeof record.plan_type === "string" ? record.plan_type : undefined,
    windows,
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Never echo response bodies, tokens, or account ids.
  return message.replace(/(["'])[^"']*\1/g, '"..."').split("\n")[0] ?? "Codex request failed";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function performCodexFetch(
  auth: { token: string; accountId: string },
): Promise<ProviderQuota> {
  const response = await fetchWithTimeout(
    CODEX_USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        "ChatGPT-Account-Id": auth.accountId,
        Accept: "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Codex quota request failed (${response.status})`);
  }

  const body = await response.json();
  const parsed = parseCodexBody(body);
  return {
    provider: "codex",
    state: "live",
    fetchedAt: Date.now(),
    ...parsed,
  };
}

export async function fetchCodexQuota(credentials: CredentialSourceLike): Promise<ProviderQuota> {
  const auth: CodexAuthResult = await getCodexAuth(credentials);
  if ("error" in auth) {
    return { provider: "codex", state: "missing", windows: [], error: auth.error };
  }

  try {
    return await performCodexFetch(auth);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const authError = message.includes("401") || message.includes("403");
    if (authError) {
      const retry = await getCodexAuth(credentials);
      if ("error" in retry) {
        return {
          provider: "codex",
          state: "error",
          windows: [],
          error: retry.error,
        };
      }
      if (retry.token !== auth.token) {
        try {
          return await performCodexFetch(retry);
        } catch (retryError) {
          return {
            provider: "codex",
            state: "error",
            windows: [],
            error: sanitizeError(retryError),
          };
        }
      }
    }
    return {
      provider: "codex",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  }
}
