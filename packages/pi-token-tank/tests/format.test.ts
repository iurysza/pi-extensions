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
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▱▱▱  󰔛 3h 25m");
    assert.equal(formatFooter(quota, "full", plainTheme, undefined, NOW_MS), "5h  ▰▱▱▱  󰔛 3h 25m   ·   7d  ▰▱▱▱  󰔛 4d 11h");
  });

  it("changes gauge colour at 90%, not before", () => {
    assert.ok(formatFooter(liveQuota("codex", 89.96, 15), "minimal", theme).includes("[success:▰▰▰▰]"));
    assert.ok(formatFooter(liveQuota("codex", 90, 15), "minimal", theme).includes("[error:▰▰▰▰]"));
  });

  it("falls back to and labels a remaining weekly window", () => {
    const quota = liveQuota("codex", 24, 34);
    quota.windows = quota.windows.filter((window) => window.id === "weekly");
    assert.equal(
      formatFooter(quota, "minimal", plainTheme, ["five-hour"], NOW_MS),
      "▰▰▱▱  󰔛 4d 11h",
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
      "cycle  ▰▱▱▱   ·   auto  ▰▱▱▱   ·   api  ▰▰▱▱",
    );
  });

  it("marks cached quota percentages as stale", () => {
    const quota = liveQuota("kimi", 48, 35);
    quota.state = "stale";
    assert.equal(formatFooter(quota, "minimal", plainTheme, undefined, NOW_MS), "▰▰▱▱~  󰔛 3h 25m");
  });

  it("keeps labels dim and only colours gauges at the 90% threshold", () => {
    const normal = formatFooter(liveQuota("codex", 70, 89), "full", theme);
    assert.ok(normal.includes("[dim:5h  ][success:▰▰▰▱]"));
    assert.ok(normal.includes("[dim:7d  ][success:▰▰▰▰]"));
    assert.ok(formatFooter(liveQuota("codex", 69, 90), "full", theme).includes("[error:▰▰▰▰]"));
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
      xai: {
        provider: "xai",
        state: "live",
        plan: "SuperGrok",
        windows: [{
          id: "weekly",
          shortLabel: "7d",
          longLabel: "Weekly",
          resetStyle: "weekday-time",
          usedPercent: 42.5,
        }],
      },
      cursor: { provider: "cursor", state: "missing", windows: [] },
    };
    const lines = formatWidget(snapshot, registry, theme, 1752306000000);
    const text = lines.join("\n");
    assert.equal(lines.length, 7);
    assert.ok(text.includes("Codex"));
    assert.ok(text.includes("Kimi"));
    assert.ok(text.includes("GitHub Copilot"));
    assert.ok(text.includes("xAI"));
    assert.ok(text.includes("SuperGrok"));
    assert.ok(text.includes("Cursor"));
    assert.ok(text.includes("24% used"));
    assert.ok(text.includes("42% used") || text.includes("43% used"));
    assert.ok(text.includes("/token-tank minimal|full"));
    assert.ok(text.includes("/token-tank hides"));
  });
});
