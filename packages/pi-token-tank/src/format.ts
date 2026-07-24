import type { FooterMode } from "./preferences.js";
import type { ProviderQuota, QuotaProvider, QuotaSnapshot, QuotaWindow } from "./types.js";

interface ThemeLike {
  fg(color: "success" | "warning" | "error" | "dim" | "text" | "accent", text: string): string;
}

function thresholdColor(percent: number): "success" | "warning" | "error" {
  if (percent >= 90) return "error";
  if (percent >= 70) return "warning";
  return "success";
}

function formatResetDuration(deltaMs: number): string {
  if (deltaMs <= 0) return "soon";
  const minutes = Math.floor(deltaMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const remMinutes = minutes % 60;
  const remHours = hours % 24;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (remHours > 0 || (days > 0 && remMinutes > 0)) parts.push(`${remHours}h`);
  if (days === 0 && remMinutes > 0) parts.push(`${remMinutes}m`);
  if (parts.length === 0) return "soon";
  return parts.join(" ");
}

function formatUpdatedTime(fetchedAt?: number): string {
  if (!fetchedAt) return "—";
  const date = new Date(fetchedAt);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatGauge(percent: number): string {
  const filled = percent <= 0 ? 0 : Math.min(4, Math.ceil(percent / 25));
  return "▰".repeat(filled) + "▱".repeat(4 - filled);
}

export function formatResetTime(resetsAt: number, weekly: boolean): string {
  const date = new Date(resetsAt);
  const time = `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  return weekly ? `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}` : time;
}

function formatFooterWindow(
  window: QuotaWindow,
  label: boolean,
  stale: boolean,
  theme: ThemeLike,
  nowMs: number,
): string {
  const percent = `${window.usedPercent}%${stale ? "~" : ""}`;
  const reset = window.resetsAt ? `  ↻ ${formatResetDuration(window.resetsAt - nowMs)}` : "";
  const prefix = label ? `${window.shortLabel}  ` : "";
  return `${theme.fg("dim", `${prefix}${formatGauge(window.usedPercent)}  `)}${theme.fg(thresholdColor(window.usedPercent), percent)}${theme.fg("dim", reset)}`;
}

export function formatFooter(
  quota: ProviderQuota,
  mode: FooterMode,
  theme: ThemeLike,
  windowIds?: readonly string[],
  nowMs = Date.now(),
): string {
  if (quota.state === "missing") return theme.fg("dim", "—");
  if (quota.state === "error") return theme.fg("dim", "!");
  const ids = windowIds ?? quota.windows.slice(0, mode === "minimal" ? 1 : 2).map((window) => window.id);
  const selected = ids
    .map((id) => quota.windows.find((window) => window.id === id))
    .filter((window): window is QuotaWindow => Boolean(window));
  const windows = selected.length > 0 ? selected : quota.windows.slice(0, 1);
  if (windows.length === 0) return theme.fg("dim", "—");
  const stale = quota.state === "stale";
  const showLabels = mode === "full" || selected.length === 0;
  return windows
    .map((window) => formatFooterWindow(window, showLabels, stale, theme, nowMs))
    .join(theme.fg("dim", "   ·   "));
}

export function formatWidget(
  snapshot: QuotaSnapshot,
  registry: readonly QuotaProvider[],
  theme: ThemeLike,
  nowMs: number,
): string[] {
  const lines = [
    `${theme.fg("accent", "Quota usage")}${theme.fg("dim", " · footer /token-tank minimal|full")}`,
  ];

  for (const provider of registry) {
    const q = snapshot[provider.id];
    if (!q) continue;
    const prefix = `${theme.fg("accent", provider.label)}${theme.fg("dim", ` · ${q.plan ?? "—"} · ${q.state}`)}`;

    if (q.state === "missing") {
      lines.push(`${prefix}${theme.fg("dim", ` · Credentials missing. ${provider.credentialsHint}`)}`);
      continue;
    }
    if (q.state === "error") {
      lines.push(`${prefix}${theme.fg("error", ` · ${q.error ?? "Quota unavailable."}`)}`);
      continue;
    }

    const windows = q.windows.map((window) => {
      const reset = window.resetsAt ? ` ↻ ${formatResetDuration(window.resetsAt - nowMs)}` : "";
      return `${window.longLabel} ${theme.fg(thresholdColor(window.usedPercent), `${Math.round(window.usedPercent)}% used`)}${theme.fg("dim", reset)}`;
    });
    const details = windows.length > 0 ? windows.join(theme.fg("dim", " · ")) : theme.fg("dim", "No quota windows");
    const staleError = q.error && q.state === "stale" ? theme.fg("warning", ` · ${q.error}`) : "";
    lines.push(`${prefix}${theme.fg("dim", " · ")}${details}${staleError}`);
  }

  const updated = formatUpdatedTime(registry.map((provider) => snapshot[provider.id]?.fetchedAt).find(Boolean));
  lines.push(theme.fg("dim", `Updated ${updated} · /token-tank hides`));
  return lines;
}

export { formatResetDuration };
