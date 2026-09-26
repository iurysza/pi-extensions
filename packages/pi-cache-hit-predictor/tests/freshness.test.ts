import assert from "node:assert/strict";
import test from "node:test";
import { cacheMayBeStale, cacheWarmTimestamp, idleThresholdMs } from "../src/freshness.js";

test("parses minutes, disables age at zero, and falls back for invalid values", () => {
  for (const value of [undefined, "", " ", "bad", "-1", "Infinity", "1e308"]) {
    assert.equal(idleThresholdMs(value), 1_800_000);
  }
  assert.equal(idleThresholdMs("30"), 1_800_000);
  assert.equal(idleThresholdMs("5"), 300_000);
  assert.equal(idleThresholdMs("0.5"), 30_000);
  assert.equal(idleThresholdMs("0"), 0);
});

test("warns at the threshold, never for missing or invalid timestamps", () => {
  assert.equal(cacheMayBeStale(1_000, 300_999, 300_000), false);
  assert.equal(cacheMayBeStale(1_000, 301_000, 300_000), true);
  assert.equal(cacheMayBeStale(1_000, 301_000, 0), false);
  assert.equal(cacheMayBeStale(undefined, 301_000, 300_000), false);
  assert.equal(cacheMayBeStale(NaN, 301_000, 300_000), false);
  assert.equal(cacheMayBeStale(302_000, 301_000, 300_000), false);
});

test("accepts only persisted warming for the preceding response's provider and model", () => {
  const lane = { provider: "openai", api: "openai-responses", model: "gpt-test", thinkingLevel: "high" };
  const entry = { type: "usage", kind: "cache_warm", provider: "openai", model: "gpt-test", timestamp: new Date(1_000).toISOString() };
  assert.equal(cacheWarmTimestamp(entry, lane), 1_000);
  assert.equal(cacheWarmTimestamp(entry, undefined), undefined);
  assert.equal(cacheWarmTimestamp({ ...entry, kind: "other" }, lane), undefined);
  assert.equal(cacheWarmTimestamp({ ...entry, provider: "other" }, lane), undefined);
  assert.equal(cacheWarmTimestamp({ ...entry, model: "other" }, lane), undefined);
  assert.equal(cacheWarmTimestamp({ ...entry, timestamp: "invalid" }, lane), undefined);
});
