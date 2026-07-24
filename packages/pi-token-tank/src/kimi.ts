import type { CredentialSourceLike, KimiAuthResult } from "./auth.js";
import { getKimiAuth } from "./auth.js";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const KIMI_USAGE_URL = "https://api.kimi.com/coding/v1/usages";
const FETCH_TIMEOUT_MS = 10_000;

const MEMBERSHIP_LEVEL_NAMES: Record<string, string> = {
  LEVEL_FREE: "Free",
  LEVEL_BASIC: "Adagio",
  LEVEL_STANDARD: "Moderato",
  LEVEL_INTERMEDIATE: "Allegretto",
  LEVEL_ADVANCED: "Allegro",
  LEVEL_PREMIUM: "Vivace",
};

const RESET_TIME_KEYS = [
  "resetTime",
  "reset_time",
  "resetAt",
  "reset_at",
  "resetsAt",
  "resets_at",
  "nextResetTime",
  "next_reset_time",
];

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseDate(value: unknown): number | undefined {
  const text = typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
  if (!text) return undefined;
  if (/^\d+$/.test(text)) {
    const ts = Number(text);
    return ts < 1_000_000_000_000 ? ts * 1000 : ts;
  }
  // Trim nanosecond precision to milliseconds for ISO parsing.
  const normalized = text.replace(/\.(\d{3})\d+Z?$/, ".$1Z");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

function deriveUsed(record: Record<string, unknown>): number | undefined {
  const used = toNumber(record.used);
  if (used !== undefined) return used;
  const limit = toNumber(record.limit);
  const remaining = toNumber(record.remaining);
  if (limit !== undefined && remaining !== undefined) {
    return Math.max(0, limit - remaining);
  }
  return undefined;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseUsageRow(
  value: unknown,
  window: Pick<QuotaWindow, "id" | "shortLabel" | "longLabel" | "resetStyle">,
): QuotaWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const limit = toNumber(record.limit);
  const used = deriveUsed(record);
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  const usedPercent = clampPercent((used / limit) * 100);

  let resetsAt: number | undefined;
  for (const key of RESET_TIME_KEYS) {
    resetsAt = parseDate(record[key]);
    if (resetsAt !== undefined) break;
  }
  return { ...window, usedPercent, used, limit, resetsAt };
}

function parseMembership(record: Record<string, unknown>): string | undefined {
  const user = record.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) return undefined;
  const membership = (user as Record<string, unknown>).membership;
  if (!membership || typeof membership !== "object" || Array.isArray(membership)) return undefined;
  const level = (membership as Record<string, unknown>).level;
  if (typeof level !== "string" || !level) return undefined;
  return MEMBERSHIP_LEVEL_NAMES[level] ?? level;
}

function parseKimiBody(body: unknown): Omit<ProviderQuota, "provider" | "state" | "fetchedAt" | "error"> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Invalid Kimi usage response: expected object");
  }
  const record = body as Record<string, unknown>;
  const weekly = parseUsageRow(record.usage, {
    id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time",
  });
  if (!weekly) {
    throw new Error("Invalid Kimi usage response: missing weekly usage");
  }

  let fiveHour: QuotaWindow | undefined;
  if (Array.isArray(record.limits)) {
    for (const item of record.limits) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const itemRecord = item as Record<string, unknown>;
      const detail =
        itemRecord.detail && typeof itemRecord.detail === "object" && !Array.isArray(itemRecord.detail)
          ? itemRecord.detail
          : itemRecord;
      const windowMeta =
        itemRecord.window && typeof itemRecord.window === "object" && !Array.isArray(itemRecord.window)
          ? (itemRecord.window as Record<string, unknown>)
          : {};
      const duration = toNumber(windowMeta.duration ?? (detail as Record<string, unknown>).duration);
      const unit = String(
        windowMeta.timeUnit ??
          windowMeta.time_unit ??
          (detail as Record<string, unknown>).timeUnit ??
          (detail as Record<string, unknown>).time_unit ??
          "",
      ).toUpperCase();
      if (duration === undefined) continue;
      const minutes = unit.includes("HOUR") ? duration * 60 : unit.includes("MINUTE") ? duration : undefined;
      if (minutes === 300) {
        const row = parseUsageRow(detail, {
          id: "five-hour", shortLabel: "5h", longLabel: "5h", resetStyle: "time",
        });
        if (row) {
          fiveHour = row;
          break;
        }
      }
    }
  }

  if (!fiveHour) {
    throw new Error("Invalid Kimi usage response: missing 5-hour window");
  }

  return {
    plan: parseMembership(record),
    windows: [fiveHour, weekly],
  };
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(["'])[^"']*\1/g, '"..."').split("\n")[0] ?? "Kimi request failed";
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

async function performKimiFetch(token: string): Promise<ProviderQuota> {
  const response = await fetchWithTimeout(
    KIMI_USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    },
    FETCH_TIMEOUT_MS,
  );

  if (!response.ok) {
    throw new Error(`Kimi quota request failed (${response.status})`);
  }

  const body = await response.json();
  const parsed = parseKimiBody(body);
  return {
    provider: "kimi",
    state: "live",
    fetchedAt: Date.now(),
    ...parsed,
  };
}

export async function fetchKimiQuota(credentials: CredentialSourceLike): Promise<ProviderQuota> {
  const auth: KimiAuthResult = await getKimiAuth(credentials);
  if ("error" in auth) {
    return { provider: "kimi", state: "missing", windows: [], error: auth.error };
  }

  try {
    return await performKimiFetch(auth.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401") && auth.type === "oauth") {
      const afterResolution = await getKimiAuth(credentials);
      const refreshed = "token" in afterResolution && afterResolution.token !== auth.token
        ? afterResolution.token
        : await credentials.refreshOAuthToken("kimi-coding", auth.token);
      if (refreshed) {
        try {
          return await performKimiFetch(refreshed);
        } catch (retryError) {
          return {
            provider: "kimi",
            state: "error",
            windows: [],
            error: sanitizeError(retryError),
          };
        }
      }
    }
    return {
      provider: "kimi",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  }
}
