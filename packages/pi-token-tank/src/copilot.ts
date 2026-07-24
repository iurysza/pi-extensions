import type { CredentialSourceLike } from "./auth.js";
import { withGitHubCopilotAuth } from "./auth.js";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const COPILOT_USAGE_URL = "https://api.github.com/copilot_internal/user";
const FETCH_TIMEOUT_MS = 10_000;
const COPILOT_HEADERS = {
  Accept: "application/json",
  "X-GitHub-Api-Version": "2026-06-01",
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;

interface CopilotUsageBody {
  copilot_plan?: unknown;
  limited_user_quotas?: unknown;
  limited_user_reset_date?: unknown;
  monthly_quotas?: unknown;
  quota_reset_date?: unknown;
  quota_reset_date_utc?: unknown;
  quota_snapshots?: unknown;
  [key: string]: unknown;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function roundedPercent(value: number): number {
  return Math.round(clamp(value, 0, 100) * 10) / 10;
}

function parseDate(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^\d+$/.test(value.trim())) {
    const timestamp = Number(value);
    return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function monthlyWindow(usedPercent: number, resetsAt?: number, used?: number, limit?: number): QuotaWindow {
  return {
    id: "monthly",
    shortLabel: "30d",
    longLabel: "Monthly",
    resetStyle: "weekday-time",
    usedPercent: roundedPercent(usedPercent),
    used,
    limit,
    resetsAt,
  };
}

function parseSnapshot(value: unknown, fallbackResetsAt?: number): QuotaWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.unlimited === true || record.has_quota === false) return undefined;

  const hasEntitlement = Object.hasOwn(record, "entitlement");
  const entitlement = toNumber(record.entitlement);
  if (hasEntitlement && (entitlement === undefined || entitlement <= 0)) return undefined;

  const hasRemaining = Object.hasOwn(record, "quota_remaining") || Object.hasOwn(record, "remaining");
  const remaining = toNumber(record.quota_remaining) ?? toNumber(record.remaining);
  if (hasRemaining && remaining === undefined) return undefined;

  const resetsAt = parseDate(record.quota_reset_at) ?? fallbackResetsAt;
  const percentRemaining = toNumber(record.percent_remaining);
  if (percentRemaining !== undefined) {
    if (entitlement !== undefined && remaining !== undefined) {
      const used = clamp(entitlement - remaining, 0, entitlement);
      return monthlyWindow(100 - percentRemaining, resetsAt, used, entitlement);
    }
    if (!hasEntitlement) return monthlyWindow(100 - percentRemaining, resetsAt);
  }

  if (entitlement !== undefined && remaining !== undefined) {
    const used = clamp(entitlement - remaining, 0, entitlement);
    return monthlyWindow((used / entitlement) * 100, resetsAt, used, entitlement);
  }
  return undefined;
}

function parseFreeQuota(record: CopilotUsageBody): QuotaWindow | undefined {
  if (!record.monthly_quotas || typeof record.monthly_quotas !== "object" || Array.isArray(record.monthly_quotas)) return undefined;
  if (!record.limited_user_quotas || typeof record.limited_user_quotas !== "object" || Array.isArray(record.limited_user_quotas)) return undefined;
  const limits = record.monthly_quotas as Record<string, unknown>;
  const remaining = record.limited_user_quotas as Record<string, unknown>;
  const resetsAt = parseDate(record.limited_user_reset_date);

  for (const key of ["chat", "completions"]) {
    const limit = toNumber(limits[key]);
    const left = toNumber(remaining[key]);
    if (limit !== undefined && limit > 0 && left !== undefined) {
      const used = clamp(limit - left, 0, limit);
      return monthlyWindow((used / limit) * 100, resetsAt, used, limit);
    }
  }
  return undefined;
}

function parseCopilotBody(
  body: unknown,
): Omit<ProviderQuota, "provider" | "state" | "fetchedAt" | "error"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid GitHub Copilot usage response: expected object");
  }
  const record = body as CopilotUsageBody;
  let monthly: QuotaWindow | undefined;

  if (record.quota_snapshots && typeof record.quota_snapshots === "object" && !Array.isArray(record.quota_snapshots)) {
    const snapshots = record.quota_snapshots as Record<string, unknown>;
    const resetsAt = parseDate(record.quota_reset_date_utc) ?? parseDate(record.quota_reset_date);
    monthly = ["premium_interactions", "chat", "completions"]
      .map((key) => parseSnapshot(snapshots[key], resetsAt))
      .find(Boolean);
  } else {
    monthly = parseFreeQuota(record);
    if (!monthly) throw new Error("Invalid GitHub Copilot usage response: missing quota data");
  }

  return {
    plan: typeof record.copilot_plan === "string" && record.copilot_plan.trim()
      ? record.copilot_plan
      : undefined,
    windows: monthly ? [monthly] : [],
  };
}

async function performCopilotFetch(token: string): Promise<ProviderQuota> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(COPILOT_USAGE_URL, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        ...COPILOT_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub Copilot quota request failed (${response.status})`);
    }
    const parsed = parseCopilotBody(await response.json());
    return {
      provider: "copilot",
      state: "live",
      fetchedAt: Date.now(),
      ...parsed,
    };
  } finally {
    clearTimeout(id);
  }
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Invalid GitHub Copilot usage response:")) return message;
  if (/^GitHub Copilot quota request failed \(\d{3}\)$/.test(message)) return message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "GitHub Copilot quota request timed out";
  }
  return "GitHub Copilot quota request failed";
}

export async function fetchCopilotQuota(credentials: CredentialSourceLike): Promise<ProviderQuota> {
  try {
    let quota: ProviderQuota | undefined;
    const auth = await withGitHubCopilotAuth(credentials, async (token) => {
      quota = await performCopilotFetch(token);
    });
    if ("error" in auth) {
      const state = auth.error.includes("custom enterprise domains") ? "error" : "missing";
      return { provider: "copilot", state, windows: [], error: auth.error };
    }
    return quota!;
  } catch (error) {
    return {
      provider: "copilot",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  }
}
