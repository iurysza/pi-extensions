import type { CredentialSourceLike, XaiAuthResult } from "./auth.js";
import { getXaiAuth } from "./auth.js";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const XAI_USAGE_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const FETCH_TIMEOUT_MS = 10_000;

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function centValue(value: unknown): number | undefined {
  const record = toRecord(value);
  if (!record) return undefined;
  if (!Object.hasOwn(record, "val") || record.val === undefined || record.val === null) return 0;
  const amount = toNumber(record.val);
  if (amount === undefined || !Number.isInteger(amount)) return undefined;
  return amount;
}

function periodWindow(type: unknown): Pick<QuotaWindow, "id" | "shortLabel" | "longLabel" | "resetStyle"> {
  const text = typeof type === "string" ? type.toUpperCase() : "";
  if (text.includes("MONTHLY")) {
    return { id: "monthly", shortLabel: "30d", longLabel: "Monthly", resetStyle: "weekday-time" };
  }
  if (text.includes("WEEKLY")) {
    return { id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time" };
  }
  return { id: "usage", shortLabel: "use", longLabel: "Usage", resetStyle: "weekday-time" };
}

function parsePlan(record: Record<string, unknown>): string | undefined {
  const plan = record.subscriptionTier ?? record.subscription_tier;
  if (typeof plan !== "string") return undefined;
  const trimmed = plan.trim();
  if (!trimmed || trimmed.length > 40 || !/^[A-Za-z0-9._ -]+$/.test(trimmed)) return undefined;
  return trimmed;
}

function parseXaiBody(body: unknown): Omit<ProviderQuota, "provider" | "state" | "fetchedAt" | "error"> {
  const record = toRecord(body);
  const config = toRecord(record?.config);
  if (!record || !config) {
    throw new Error("Invalid xAI usage response: expected object");
  }

  const currentPeriod = toRecord(config.currentPeriod) ?? toRecord(config.current_period);
  const percent = toNumber(config.creditUsagePercent ?? config.credit_usage_percent);
  const used = centValue(config.used);
  const limit = centValue(config.monthlyLimit ?? config.monthly_limit);
  const resetsAt = parseDate(currentPeriod?.end)
    ?? parseDate(config.billingPeriodEnd)
    ?? parseDate(config.billing_period_end);

  let window: QuotaWindow | undefined;
  if (percent !== undefined) {
    window = {
      ...periodWindow(currentPeriod?.type ?? currentPeriod?.period_type),
      usedPercent: clampPercent(percent),
      resetsAt,
    };
  } else if (used !== undefined && limit !== undefined && limit > 0 && used >= 0) {
    window = {
      ...periodWindow("USAGE_PERIOD_TYPE_MONTHLY"),
      usedPercent: clampPercent((used / limit) * 100),
      used,
      limit,
      resetsAt,
    };
  }

  if (!window) {
    throw new Error("Invalid xAI usage response: missing quota data");
  }

  return {
    plan: parsePlan(record),
    windows: [window],
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Invalid xAI usage response:")) return message;
  if (/^xAI quota request failed \(\d{3}\)$/.test(message)) return message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "xAI quota request timed out";
  }
  return "xAI quota request failed";
}

async function performXaiFetch(token: string): Promise<ProviderQuota> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(XAI_USAGE_URL, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-XAI-Token-Auth": "xai-grok-cli",
      },
    });
    if (!response.ok) {
      throw new Error(`xAI quota request failed (${response.status})`);
    }
    const parsed = parseXaiBody(await response.json());
    return {
      provider: "xai",
      state: "live",
      fetchedAt: Date.now(),
      ...parsed,
    };
  } finally {
    clearTimeout(id);
  }
}

export async function fetchXaiQuota(credentials: CredentialSourceLike): Promise<ProviderQuota> {
  const auth: XaiAuthResult = await getXaiAuth(credentials);
  if ("error" in auth) {
    return { provider: "xai", state: "missing", windows: [], error: auth.error };
  }

  try {
    return await performXaiFetch(auth.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401")) {
      const afterResolution = await getXaiAuth(credentials);
      const refreshed = "token" in afterResolution && afterResolution.token !== auth.token
        ? afterResolution.token
        : await credentials.refreshOAuthToken("xai", auth.token);
      if (refreshed) {
        try {
          return await performXaiFetch(refreshed);
        } catch (retryError) {
          return {
            provider: "xai",
            state: "error",
            windows: [],
            error: sanitizeError(retryError),
          };
        }
      }
    }
    return {
      provider: "xai",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  }
}
