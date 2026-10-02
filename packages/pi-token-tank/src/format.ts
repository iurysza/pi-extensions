import { visibleWidth } from "@earendil-works/pi-tui";
import type { FooterMode } from "./preferences.js";
import type { ProviderQuota, QuotaProvider, QuotaSnapshot, QuotaWindow } from "./types.js";

interface ThemeLike {
  fg(color: "success" | "warning" | "error" | "dim" | "text" | "accent", text: string): string;
}

function thresholdColor(percent: number): "success" | "error" {
  return percent >= 90 ? "error" : "success";
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

export function formatGauge(percent: number): string {
  const filled = percent <= 0 ? 0 : Math.min(5, Math.ceil(percent / 20));
  return "▰".repeat(filled) + "▱".repeat(5 - filled);
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
  const reset = window.resetsAt ? `  󰔛 ${formatResetDuration(window.resetsAt - nowMs)}` : "";
  const prefix = label ? `${window.shortLabel}  ` : "";
  const gauge = theme.fg(thresholdColor(window.usedPercent), formatGauge(window.usedPercent));
  return `${theme.fg("dim", prefix)}${gauge}${theme.fg("dim", `${stale ? "~" : ""}${reset}`)}`;
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
  const showLabels = mode === "full";
  return windows
    .map((window) => formatFooterWindow(window, showLabels, stale, theme, nowMs))
    .join(theme.fg("dim", "   ·   "));
}

/** Quota older than this is refetched, and the panel starts showing its age. */
export const FRESHNESS_MS = 5 * 60 * 1000;

type Color = Parameters<ThemeLike["fg"]>[0];
type Cell = readonly [text: string, color: Color];
/** A provider row is either full table cells or a problem message that spans the quota columns. */
type Row = { cells: Cell[] } | { lead: Cell[]; reason: Cell; hint: string };

const HEADERS = ["Plan", "Window", "Used", "Resets in", "Status"];
const GAP = "  ";

function padCell(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
}

/** Blank when fresh, so an empty Status column means every provider is healthy. */
function statusCell(quota: ProviderQuota, nowMs: number): Cell {
  const age = quota.fetchedAt ? formatResetDuration(nowMs - quota.fetchedAt) : undefined;
  if (quota.state === "live") {
    const fresh = !quota.fetchedAt || nowMs - quota.fetchedAt < FRESHNESS_MS;
    return fresh ? ["", "dim"] : [`${age} old`, "dim"];
  }
  const retry = quota.retryAt ? ` · retry ${formatResetDuration(quota.retryAt - nowMs)}` : "";
  return [`stale${age ? ` ${age}` : ""}${retry}`, "warning"];
}

function problemReason(quota: ProviderQuota): Cell {
  if (quota.state === "missing") return ["not set up", "error"];
  const code = /\((\d{3})\)/.exec(quota.error ?? "")?.[1];
  if (code === "401" || code === "403") return [`auth failed (${code})`, "error"];
  return [code ? `unavailable (${code})` : "unavailable", "error"];
}

function hasProblem(quota: ProviderQuota): boolean {
  return quota.state === "missing" || quota.state === "error" || quota.windows.length === 0;
}

function providerRows(provider: QuotaProvider, quota: ProviderQuota, active: boolean, nowMs: number): Row[] {
  const name: Cell = [`${active ? "▸" : " "} ${provider.label}`, active ? "accent" : "text"];
  if (hasProblem(quota)) {
    const reason: Cell = quota.windows.length === 0 && (quota.state === "live" || quota.state === "stale")
      ? ["no quota windows", "dim"]
      : problemReason(quota);
    return [{ lead: [name, ["", "dim"]], reason, hint: provider.credentialsHint.replace(/\.$/, "") }];
  }
  const blankLead: Cell[] = [["", "dim"], ["", "dim"]];
  return quota.windows.map((window, index) => ({
    cells: [
      ...(index === 0 ? [name, [quota.plan ?? "", "dim"] as Cell] : blankLead),
      [window.longLabel, "text"],
      [`${formatGauge(window.usedPercent)} ${`${Math.round(window.usedPercent)}%`.padStart(4)}`, thresholdColor(window.usedPercent)],
      [window.resetsAt ? formatResetDuration(window.resetsAt - nowMs) : "", "dim"],
      index === 0 ? statusCell(quota, nowMs) : ["", "dim"],
    ],
  }));
}

export function formatWidget(
  snapshot: QuotaSnapshot,
  registry: readonly QuotaProvider[],
  theme: ThemeLike,
  nowMs: number,
  activeProviderId?: string,
): string[] {
  const present = registry.filter((provider) => snapshot[provider.id]);
  // Providers with data keep registry order; unavailable ones go last so they do not break the scan.
  const ordered = [
    ...present.filter((provider) => !hasProblem(snapshot[provider.id]!)),
    ...present.filter((provider) => hasProblem(snapshot[provider.id]!)),
  ];
  const rows = ordered.flatMap((provider) =>
    providerRows(provider, snapshot[provider.id]!, provider.id === activeProviderId, nowMs));

  const header: Cell[] = [["Token Tank", "accent"], ...HEADERS.map((text): Cell => [text, "dim"])];
  const widths = header.map(([text]) => visibleWidth(text));
  for (const row of rows) {
    const cells = "cells" in row ? row.cells : row.lead;
    cells.forEach(([text], index) => { widths[index] = Math.max(widths[index]!, visibleWidth(text)); });
  }

  const renderCells = (cells: readonly Cell[], last: boolean) => {
    // Drop empty trailing cells so rows carry no trailing spaces.
    let end = cells.length;
    while (last && end > 0 && cells[end - 1]![0] === "") end--;
    return cells.slice(0, end)
      .map(([text, color], index) => theme.fg(color, last && index === end - 1 ? text : padCell(text, widths[index]!)))
      .join(GAP);
  };

  return [
    renderCells(header, true),
    ...rows.map((row) => "cells" in row
      ? renderCells(row.cells, true)
      : `${renderCells(row.lead, false)}${GAP}${theme.fg(row.reason[1], row.reason[0])}${theme.fg("dim", ` · ${row.hint}`)}`),
  ];
}

export { formatResetDuration };
