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
  it("buckets pressure into four truthful cells", () => {
    assert.deepEqual([0, 1, 24, 25, 26, 50, 51, 72, 75, 76, 100].map(formatGauge), [
      "▱▱▱▱", "▰▱▱▱", "▰▱▱▱", "▰▱▱▱", "▰▰▱▱", "▰▰▱▱",
      "▰▰▰▱", "▰▰▰▱", "▰▰▰▱", "▰▰▰▰", "▰▰▰▰",
    ]);
  });

  it("renders exact minimal and full shapes", () => {
    const quota = liveQuota("codex", 24, 15);
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▱▱▱  24%  ↻ 3h 25m");
    assert.equal(formatFooter(quota, "full", plainTheme, undefined, NOW_MS), "5h  ▰▱▱▱  24%  ↻ 3h 25m   ·   7d  ▰▱▱▱  15%  ↻ 4d 11h");
  });

  it("falls back to and labels a remaining weekly window", () => {
    const quota = liveQuota("codex", 24, 34);
    quota.windows = quota.windows.filter((window) => window.id === "weekly");
    assert.equal(
      formatFooter(quota, "minimal", plainTheme, ["five-hour"], NOW_MS),
      "7d  ▰▰▱▱  34%  ↻ 4d 11h",
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
      "cycle  ▰▱▱▱  19.4%   ·   auto  ▰▱▱▱  12.5%   ·   api  ▰▰▱▱  26.3%",
    );
  });

  it("marks cached quota percentages as stale", () => {
    const quota = liveQuota("kimi", 48, 35);
    quota.state = "stale";
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▰▱▱  48%~  ↻ 3h 25m");
  });

  it("colors only exact percentages at thresholds", () => {
    const warning = formatFooter(liveQuota("codex", 70, 89), "full", theme);
    assert.ok(warning.includes("[warning:70%]"));
    assert.ok(warning.includes("[warning:89%]"));
    assert.ok(warning.includes("[dim:5h  ▰▰▰▱  ]"));
    assert.ok(!warning.includes("[warning:5h"));
    assert.ok(formatFooter(liveQuota("codex", 69, 90), "full", theme).includes("[error:90%]"));
  });

  it("formats reset timestamps in local wall-clock time", () => {
    assert.equal(formatResetTime(new Date(2025, 6, 12, 3, 5).getTime(), false), "3:05");
    assert.equal(formatResetTime(new Date(2025, 6, 13, 9, 0).getTime(), true), "Sun 9:00");
  });
});

describe("formatWidget", () => {
  it("keeps every provider to one line below Pi's widget cap", () => {
    const registry = [...providers, createCursorProvider()];
    const snapshot: QuotaSnapshot = {
      codex: liveQuota("codex", 24, 61),
      kimi: liveQuota("kimi", 18, 43),
      copilot: { provider: "copilot", state: "missing", windows: [] },
      cursor: { provider: "cursor", state: "missing", windows: [] },
    };
    const lines = formatWidget(snapshot, registry, theme, 1752306000000);
    const text = lines.join("\n");
    assert.equal(lines.length, 6);
    assert.ok(text.includes("Codex"));
    assert.ok(text.includes("Kimi"));
    assert.ok(text.includes("GitHub Copilot"));
    assert.ok(text.includes("Cursor"));
    assert.ok(text.includes("24% used"));
    assert.ok(text.includes("/token-tank minimal|full"));
    assert.ok(text.includes("/token-tank hides"));
  });
});
