import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ProviderQuota, QuotaWindow } from "./types.js";

const execFileAsync = promisify(execFile);
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

// The usage endpoint answers 429 to clients that do not identify as Claude Code.
const FALLBACK_CLAUDE_CODE_VERSION = "2.1.283";

type CredentialReader = () => Promise<string | undefined>;
type VersionReader = () => Promise<string>;

let cachedVersion: Promise<string> | undefined;

/** Installed Claude Code CLI version, read once per process. Falls back when the CLI is unavailable. */
export function readClaudeCodeVersion(): Promise<string> {
  cachedVersion ??= execFileAsync("claude", ["--version"], { timeout: 5_000 })
    .then(({ stdout }) => /\d+\.\d+\.\d+/.exec(stdout)?.[0] ?? FALLBACK_CLAUDE_CODE_VERSION)
    .catch(() => FALLBACK_CLAUDE_CODE_VERSION);
  return cachedVersion;
}

/** Read the CLI's existing login. Never return the token through quota snapshots or errors. */
export async function readClaudeCodeToken(): Promise<string | undefined> {
  let raw: string;
  try {
    if (process.platform === "darwin" && !process.env.CLAUDE_CONFIG_DIR) {
      const result = await execFileAsync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      });
      raw = result.stdout;
    } else {
      raw = await readFile(join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json"), "utf8");
    }
    const credential = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } };
    const oauth = credential.claudeAiOauth;
    if (typeof oauth?.accessToken !== "string" || !oauth.accessToken) return undefined;
    if (typeof oauth.expiresAt === "number" && oauth.expiresAt <= Date.now()) return undefined;
    return oauth.accessToken;
  } catch {
    return undefined;
  }
}

function parseWindow(value: unknown, id: string, shortLabel: string, longLabel: string): QuotaWindow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.utilization !== "number" || !Number.isFinite(record.utilization)) return undefined;
  const reset = typeof record.resets_at === "string" ? Date.parse(record.resets_at) : NaN;
  return {
    id, shortLabel, longLabel, resetStyle: id === "five-hour" ? "time" : "weekday-time",
    usedPercent: Math.max(0, Math.min(100, record.utilization)),
    resetsAt: Number.isFinite(reset) ? reset : undefined,
  };
}

export function parseClaudeCodeUsage(body: unknown): QuotaWindow[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid Claude Code usage response");
  const record = body as Record<string, unknown>;
  const windows = [
    parseWindow(record.five_hour, "five-hour", "5h", "5h"),
    parseWindow(record.seven_day, "weekly", "7d", "Weekly"),
  ].filter((window): window is QuotaWindow => Boolean(window));
  if (!windows.length) throw new Error("Claude Code usage windows unavailable");
  return windows;
}

export async function fetchClaudeCodeQuota(
  _credentials: unknown,
  readToken: CredentialReader = readClaudeCodeToken,
  readVersion: VersionReader = readClaudeCodeVersion,
): Promise<ProviderQuota> {
  const token = await readToken();
  if (!token) {
    return { provider: "claude-code", state: "missing", windows: [], error: "Claude Code login missing or expired. Run claude auth login." };
  }
  try {
    const response = await fetch(USAGE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
        "User-Agent": `claude-code/${await readVersion()}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Claude Code quota request failed (${response.status})`);
    return {
      provider: "claude-code", state: "live", fetchedAt: Date.now(),
      windows: parseClaudeCodeUsage(await response.json()),
    };
  } catch (error) {
    return {
      provider: "claude-code", state: "error", windows: [],
      error: error instanceof Error && /^Claude Code quota request failed \(\d+\)$/.test(error.message)
        ? error.message : "Claude Code quota unavailable.",
    };
  }
}
