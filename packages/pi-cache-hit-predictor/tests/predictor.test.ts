import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  cacheLaneKey,
  predictCacheSwitchImpact,
  renderSwitchImpact,
  scanCacheHistory,
} from "../src/predictor.js";

let nextId = 0;

function base(type: string) {
  nextId += 1;
  return {
    type,
    id: nextId.toString(16).padStart(8, "0"),
    parentId: nextId === 1 ? null : (nextId - 1).toString(16).padStart(8, "0"),
    timestamp: new Date(nextId * 1_000).toISOString(),
  };
}

function thinking(level: string): SessionEntry {
  return {
    ...base("thinking_level_change"),
    type: "thinking_level_change",
    thinkingLevel: level,
  };
}

function assistant(model: string, prompt: number, timestamp: number, cacheRead = 0): SessionEntry {
  return {
    ...base("message"),
    type: "message",
    message: {
      role: "assistant",
      content: [],
      api: "openai-responses",
      provider: "openai",
      model,
      usage: {
        input: prompt - cacheRead,
        output: 10,
        cacheRead,
        cacheWrite: 0,
        totalTokens: prompt + 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp,
    },
  } as SessionEntry;
}

describe("cache lane history", () => {
  test("uses the live reasoning level when old sessions have no initial entry", () => {
    const history = scanCacheHistory([assistant("gpt-test", 25_000, 1_000, 8_000)], "medium");
    assert.equal([...history.lanes.values()][0]?.thinkingLevel, "medium");
  });

  test("keeps separate snapshots for reasoning levels", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);
    assert.equal(history.lanes.size, 2);
    assert.equal(history.lanes.get(cacheLaneKey({
      provider: "openai",
      api: "openai-responses",
      model: "gpt-test",
      thinkingLevel: "low",
    }))?.promptTokens, 25_000);
  });

  test("drops incompatible pre-compaction snapshots", () => {
    const compaction = {
      ...base("compaction"),
      type: "compaction",
      summary: "summary",
      firstKeptEntryId: "00000001",
      tokensBefore: 50_000,
    } as SessionEntry;
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-old", 50_000, 1_000, 20_000),
      compaction,
      assistant("gpt-new", 10_000, 2_000, 0),
    ]);
    assert.equal(history.lanes.size, 1);
    assert.equal([...history.lanes.values()][0]?.model, "gpt-new");
  });
});

const lowLane = {
  provider: "openai",
  api: "openai-responses",
  model: "gpt-test",
  thinkingLevel: "low",
} as const;

const highLane = {
  provider: "openai",
  api: "openai-responses",
  model: "gpt-test",
  thinkingLevel: "high",
} as const;

const otherLane = {
  provider: "openai",
  api: "openai-responses",
  model: "gpt-other",
  thinkingLevel: "low",
} as const;

const testTheme = {
  fg(color: string, text: string) {
    return `[${color}:${text}]`;
  },
};

describe("cache switch impact", () => {
  test("reports no loss when destination carries more than source", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, highLane, 100_000, 200_000);
    assert.equal(impact.sourceTokens, 25_000);
    assert.equal(impact.destTokens, 100_000);
    assert.equal(impact.lostTokens, 0);
    assert.equal(impact.dropPercent, 0);
    assert.equal(impact.windowImpactPercent, 0);
  });

  test("computes partial loss between lanes", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);
    const impact = predictCacheSwitchImpact(history, highLane, lowLane, 100_000, 200_000);
    assert.equal(impact.sourceTokens, 100_000);
    assert.equal(impact.destTokens, 25_000);
    assert.equal(impact.lostTokens, 75_000);
    assert.equal(impact.dropPercent, 75);
    assert.equal(impact.windowImpactPercent, 37.5);
  });

  test("reports a full drop when destination is cold", () => {
    const history = scanCacheHistory([
      thinking("high"),
      assistant("gpt-test", 100_000, 1_000, 20_000),
    ]);
    const impact = predictCacheSwitchImpact(history, highLane, otherLane, 100_000, 200_000);
    assert.equal(impact.sourceTokens, 100_000);
    assert.equal(impact.destTokens, 0);
    assert.equal(impact.lostTokens, 100_000);
    assert.equal(impact.dropPercent, 100);
    assert.equal(impact.windowImpactPercent, 50);
  });

  test("caps source tokens by the current prompt size", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, otherLane, 10_000, 200_000);
    assert.equal(impact.sourceTokens, 10_000);
    assert.equal(impact.destTokens, 0);
    assert.equal(impact.lostTokens, 10_000);
    assert.equal(impact.dropPercent, 100);
  });

  test("returns null drop when source lane has no history", () => {
    const history = scanCacheHistory([
      thinking("high"),
      assistant("gpt-test", 100_000, 1_000, 20_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, highLane, 100_000, 200_000);
    assert.equal(impact.sourceTokens, 0);
    assert.equal(impact.destTokens, 100_000);
    assert.equal(impact.lostTokens, 0);
    assert.equal(impact.dropPercent, null);
  });
});

describe("switch impact rendering", () => {
  test("renders a full drop with a small red segment inside the window", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 20_000, 1_000, 8_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, otherLane, 20_000, 200_000);
    const text = renderSwitchImpact(impact, testTheme, { barWidth: 8 });
    assert.equal(text, "cache gpt-other · low ↓100% [[error:█][dim:░░░░░░░]]");
  });

  test("renders a partial drop with green, red, and dim segments", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);
    const impact = predictCacheSwitchImpact(history, highLane, lowLane, 100_000, 200_000);
    const text = renderSwitchImpact(impact, testTheme, { barWidth: 8 });
    assert.equal(text, "cache gpt-test · low ↓75% [[success:█][error:███][dim:░░░░]]");
  });

  test("renders a warm destination with no red segment", () => {
    const history = scanCacheHistory([
      thinking("high"),
      assistant("gpt-test", 100_000, 1_000, 20_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, highLane, 100_000, 200_000);
    const text = renderSwitchImpact(impact, testTheme, { barWidth: 8 });
    assert.equal(text, "cache gpt-test · high warm [[success:████][dim:░░░░]]");
  });

  test("renders no-loss switch from a warm source lane", () => {
    const history = scanCacheHistory([
      thinking("low"),
      assistant("gpt-test", 25_000, 1_000, 8_000),
      thinking("high"),
      assistant("gpt-test", 100_000, 2_000, 24_000),
    ]);
    const impact = predictCacheSwitchImpact(history, lowLane, highLane, 100_000, 200_000);
    const text = renderSwitchImpact(impact, testTheme, { barWidth: 8 });
    assert.equal(text, "cache gpt-test · high ↓0% [[success:████][dim:░░░░]]");
  });

  test("falls back to cold label when both lanes are cold", () => {
    const history = scanCacheHistory([]);
    const impact = predictCacheSwitchImpact(history, lowLane, otherLane, 100_000, 200_000);
    const text = renderSwitchImpact(impact, testTheme, { barWidth: 8 });
    assert.equal(text, "cache gpt-other · low · cold");
  });
});

