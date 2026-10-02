import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatFooter, formatGauge, formatResetTime, formatWidget } from "../src/format.js";
import { createCursorProvider, providers } from "../src/providers.js";
import type { ProviderQuota, QuotaSnapshot } from "../src/types.js";

const theme = { fg: (color: string, text: string) => `[${color}:${text}]` };
const plainTheme = { fg: (_color: string, text: string) => text };
const NOW_MS = Date.UTC(2025, 6, 12, 0, 0, 0);
const FIVE_HOUR_RESET_MS = NOW_MS + (3 * 60 + 25) * 60_000;
const WEEKLY_RESET_MS = NOW_MS + ((4 * 24 + 11) * 60) * 60_000;

function liveQuota(provider: ProviderQuota["provider"], five: number, weekly: number): ProviderQuota {
  return {
    provider, state: "live", fetchedAt: 1752306000000,
    plan: provider === "codex" ? "plus" : "Allegro",
    windows: [
      { id: "five-hour", shortLabel: "5h", longLabel: "5h", resetStyle: "time", usedPercent: five, resetsAt: FIVE_HOUR_RESET_MS },
      { id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time", usedPercent: weekly, resetsAt: WEEKLY_RESET_MS },
    ],
  };
}

describe("footer gauges", () => {
  it("buckets pressure into five truthful cells", () => {
    assert.deepEqual([0, 1, 24, 25, 26, 50, 51, 72, 75, 76, 100].map(formatGauge), [
      "▱▱▱▱▱", "▰▱▱▱▱", "▰▰▱▱▱", "▰▰▱▱▱", "▰▰▱▱▱", "▰▰▰▱▱",
      "▰▰▰▱▱", "▰▰▰▰▱", "▰▰▰▰▱", "▰▰▰▰▱", "▰▰▰▰▰",
    ]);
  });

  it("renders exact minimal and full shapes", () => {
    const quota = liveQuota("codex", 24, 15);
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▰▱▱▱  󰔛 3h 25m");
    assert.equal(formatFooter(quota, "full", plainTheme, undefined, NOW_MS), "5h  ▰▰▱▱▱  󰔛 3h 25m   ·   7d  ▰▱▱▱▱  󰔛 4d 11h");
  });

  it("shows only the weekly window in Claude Code minimal mode", () => {
    const claude = providers.find((provider) => provider.id === "claude-code")!;
    const quota = liveQuota("claude-code", 24, 15);
    assert.equal(
      formatFooter(quota, "minimal", plainTheme, claude.footerWindows.minimal, NOW_MS),
      "▰▱▱▱▱  󰔛 4d 11h",
    );
  });

  it("changes gauge colour at 90%, not before", () => {
    assert.ok(formatFooter(liveQuota("codex", 89.96, 15), "minimal", theme).includes("[success:▰▰▰▰▰]"));
    assert.ok(formatFooter(liveQuota("codex", 90, 15), "minimal", theme).includes("[error:▰▰▰▰▰]"));
  });

  it("falls back to and labels a remaining weekly window", () => {
    const quota = liveQuota("codex", 24, 34);
    quota.windows = quota.windows.filter((window) => window.id === "weekly");
    assert.equal(
      formatFooter(quota, "minimal", plainTheme, ["five-hour"], NOW_MS),
      "▰▰▱▱▱  󰔛 4d 11h",
    );
  });

  it("shows Cursor total, Auto, and API windows in full mode", () => {
    const quota: ProviderQuota = {
      provider: "cursor",
      state: "live",
      windows: [
        { id: "billing-cycle", shortLabel: "cycle", longLabel: "Total", resetStyle: "weekday-time", usedPercent: 19.4 },
        { id: "auto", shortLabel: "auto", longLabel: "Auto", resetStyle: "weekday-time", usedPercent: 12.5 },
        { id: "api", shortLabel: "api", longLabel: "API", resetStyle: "weekday-time", usedPercent: 26.3 },
      ],
    };
    assert.equal(
      formatFooter(quota, "full", plainTheme, ["billing-cycle", "auto", "api"]),
      "cycle  ▰▱▱▱▱   ·   auto  ▰▱▱▱▱   ·   api  ▰▰▱▱▱",
    );
  });

  it("marks cached quota percentages as stale", () => {
    const quota = liveQuota("kimi", 48, 35);
    quota.state = "stale";
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▰▰▱▱~  󰔛 3h 25m");
  });

  it("keeps labels dim and only colours gauges at the 90% threshold", () => {
    const normal = formatFooter(liveQuota("codex", 70, 89), "full", theme);
    assert.ok(normal.includes("[dim:5h  ][success:▰▰▰▰▱]"));
    assert.ok(normal.includes("[dim:7d  ][success:▰▰▰▰▰]"));
    assert.ok(formatFooter(liveQuota("codex", 69, 90), "full", theme).includes("[error:▰▰▰▰▰]"));
  });

  it("formats reset timestamps in local wall-clock time", () => {
    assert.equal(formatResetTime(new Date(2025, 6, 12, 3, 5).getTime(), false), "3:05");
    assert.equal(formatResetTime(new Date(2025, 6, 13, 9, 0).getTime(), true), "Sun 9:00");
  });
});

describe("formatWidget", () => {
  const registry = [...providers, createCursorProvider()];
  const MINUTE = 60_000;
  const snapshot: QuotaSnapshot = {
    "claude-code": {
      ...liveQuota("claude-code", 14, 3), plan: "Max", state: "stale", fetchedAt: NOW_MS - 22 * MINUTE,
      retryAt: NOW_MS + 8 * MINUTE, error: "Claude Code quota request failed (429)",
    },
    codex: { ...liveQuota("codex", 24, 91), fetchedAt: NOW_MS - MINUTE },
    kimi: { provider: "kimi", state: "missing", windows: [] },
    copilot: { provider: "copilot", state: "error", windows: [], error: "GitHub Copilot quota request failed (401)" },
    xai: {
      provider: "xai", state: "live", plan: "SuperGrok", fetchedAt: NOW_MS - 12 * MINUTE,
      windows: [{ id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time", usedPercent: 42.5 }],
    },
    cursor: { provider: "cursor", state: "error", windows: [], error: "Cursor quota request failed (500)" },
  };

  it("renders one header line, data rows in registry order, then problem rows", () => {
    assert.deepEqual(formatWidget(snapshot, registry, plainTheme, NOW_MS, "claude-code"), [
      "Token Tank        Plan       Window  Used        Resets in  Status",
      "▸ Claude Code     Max        5h      ▰▱▱▱▱  14%  3h 25m     stale 22m · retry 8m",
      "                             Weekly  ▰▱▱▱▱   3%  4d 11h",
      "  Codex           plus       5h      ▰▰▱▱▱  24%  3h 25m",
      "                             Weekly  ▰▰▰▰▰  91%  4d 11h",
      "  xAI             SuperGrok  Weekly  ▰▰▰▱▱  43%             12m old",
      "  Kimi                       not set up · Run /login kimi-coding or set KIMI_API_KEY",
      "  GitHub Copilot             auth failed (401) · Run /login github-copilot",
      "  Cursor                     unavailable (500) · Set CURSOR_SESSION_TOKEN to your cursor.com WorkosCursorSessionToken cookie value",
    ]);
  });

  it("leaves Status blank while data is fresh and shows stale without a retry when no cooldown applies", () => {
    const fresh = formatWidget({ codex: { ...liveQuota("codex", 24, 15), fetchedAt: NOW_MS } }, providers, plainTheme, NOW_MS);
    assert.equal(fresh[1], "  Codex     plus  5h      ▰▰▱▱▱  24%  3h 25m");
    const stale = formatWidget({
      codex: { ...liveQuota("codex", 24, 15), state: "stale", fetchedAt: NOW_MS - 7 * MINUTE, error: "Codex quota request failed (500)" },
    }, providers, plainTheme, NOW_MS);
    assert.ok(stale[1]?.endsWith("stale 7m"));
  });

  it("colours usage by the 90% threshold and problem reasons as errors", () => {
    const text = formatWidget(snapshot, registry, theme, NOW_MS).join("\n");
    assert.ok(text.includes("[success:▰▰▱▱▱  24%]"));
    assert.ok(text.includes("[error:▰▰▰▰▰  91%]"));
    assert.ok(text.includes("[warning:stale 22m · retry 8m]"));
    assert.ok(text.includes("[error:auth failed (401)][dim: · Run /login github-copilot]"));
  });
});
