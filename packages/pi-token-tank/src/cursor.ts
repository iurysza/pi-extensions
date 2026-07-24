import type { ProviderQuota, QuotaWindow } from "./types.js";

const CURSOR_USAGE_URL = "https://cursor.com/api/usage-summary";
const CURSOR_SESSION_ENV = "CURSOR_SESSION_TOKEN";
const CURSOR_API_KEY_PLACEHOLDER = "pi-cursor-sdk-cursor-api-key-placeholder";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_SESSION_TOKEN_LENGTH = 16_384;
const MAX_RESPONSE_BYTES = 1_000_000;
const CURSOR_SESSION_STATE = Symbol.for("pi-token-tank.cursor-session-token");

interface CursorUsageBody {
  billingCycleEnd?: unknown;
  individualUsage?: unknown;
  membershipType?: unknown;
  teamUsage?: unknown;
  [key: string]: unknown;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  return undefined;
}

function clampPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)) * 10) / 10;
}

function parseDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function percentFromBlock(block: Record<string, unknown> | undefined): number | undefined {
  if (!block) return undefined;
  const used = toNumber(block.used);
  const limit = toNumber(block.limit);
  if (used === undefined || limit === undefined || limit <= 0) return undefined;
  return clampPercent((used / limit) * 100);
}

function window(
  id: string,
  shortLabel: string,
  longLabel: string,
  usedPercent: number,
  resetsAt?: number,
  block?: Record<string, unknown>,
): QuotaWindow {
  return {
    id,
    shortLabel,
    longLabel,
    resetStyle: "weekday-time",
    usedPercent: clampPercent(usedPercent),
    used: toNumber(block?.used),
    limit: toNumber(block?.limit),
    resetsAt,
  };
}

export function parseCursorUsage(body: unknown, fetchedAt = Date.now()): ProviderQuota {
  const record = toRecord(body) as CursorUsageBody | undefined;
  if (!record) throw new Error("Invalid Cursor usage response: expected object");
  if (record.isUnlimited === true) {
    throw new Error("Invalid Cursor usage response: missing finite quota data");
  }

  const individual = toRecord(record.individualUsage);
  const plan = toRecord(individual?.plan);
  const overall = toRecord(individual?.overall);
  const team = toRecord(record.teamUsage);
  const pooled = toRecord(team?.pooled);
  const resetsAt = parseDate(record.billingCycleEnd);

  const totalPercent = toNumber(plan?.totalPercentUsed);
  const primaryBlock = totalPercent !== undefined || percentFromBlock(plan) !== undefined
    ? plan
    : percentFromBlock(overall) !== undefined
      ? overall
      : pooled;
  const primaryPercent = totalPercent !== undefined
    ? clampPercent(totalPercent)
    : percentFromBlock(primaryBlock);

  if (primaryPercent === undefined) {
    throw new Error("Invalid Cursor usage response: missing quota data");
  }

  const windows: QuotaWindow[] = [
    window("billing-cycle", "cycle", "Total", primaryPercent, resetsAt, primaryBlock),
  ];
  const autoPercent = toNumber(plan?.autoPercentUsed);
  if (autoPercent !== undefined) {
    windows.push(window("auto", "auto", "Auto", autoPercent, resetsAt));
  }
  const apiPercent = toNumber(plan?.apiPercentUsed);
  if (apiPercent !== undefined) {
    windows.push(window("api", "api", "API", apiPercent, resetsAt));
  }

  return {
    provider: "cursor",
    state: "live",
    fetchedAt,
    plan: typeof record.membershipType === "string" && /^[A-Za-z0-9._ -]{1,40}$/.test(record.membershipType.trim())
      ? record.membershipType.trim()
      : undefined,
    windows,
  };
}

function takeEnvironmentSessionToken(): string | undefined {
  const token = process.env[CURSOR_SESSION_ENV];
  delete process.env[CURSOR_SESSION_ENV];
  return token;
}

export function captureCursorSessionToken(): string | undefined {
  const state = process as NodeJS.Process & Record<symbol, unknown>;
  const token = takeEnvironmentSessionToken();
  if (token !== undefined) {
    Object.defineProperty(state, CURSOR_SESSION_STATE, {
      value: token,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  const captured = state[CURSOR_SESSION_STATE];
  return typeof captured === "string" ? captured : undefined;
}

function validateSessionToken(value: string | undefined): string | undefined {
  const token = value?.trim();
  if (!token || token === CURSOR_API_KEY_PLACEHOLDER) return undefined;
  if (token.length > MAX_SESSION_TOKEN_LENGTH || /[;\r\n]/.test(token)) {
    throw new Error("Cursor dashboard session token is invalid");
  }
  return token;
}

async function readJsonBounded(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Invalid Cursor usage response: expected object");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Cursor quota response exceeded size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("Invalid Cursor usage response:")) return message;
  if (message === "Cursor dashboard session token is invalid") return message;
  if (/^Cursor quota request failed \(\d{3}\)$/.test(message)) return message;
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return "Cursor quota request timed out";
  }
  return "Cursor quota request failed";
}

export async function fetchCursorQuotaWithToken(sessionToken: string | undefined): Promise<ProviderQuota> {
  let token: string | undefined;
  try {
    token = validateSessionToken(sessionToken);
  } catch (error) {
    return { provider: "cursor", state: "error", windows: [], error: sanitizeError(error) };
  }
  if (!token) {
    return { provider: "cursor", state: "missing", windows: [] };
  }

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(CURSOR_USAGE_URL, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        Cookie: `WorkosCursorSessionToken=${token}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return { provider: "cursor", state: "missing", windows: [] };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`Cursor quota request failed (${response.status})`);
    }
    return parseCursorUsage(await readJsonBounded(response));
  } catch (error) {
    return {
      provider: "cursor",
      state: "error",
      windows: [],
      error: sanitizeError(error),
    };
  } finally {
    clearTimeout(id);
  }
}

export async function fetchCursorQuota(): Promise<ProviderQuota> {
  return fetchCursorQuotaWithToken(takeEnvironmentSessionToken());
}
