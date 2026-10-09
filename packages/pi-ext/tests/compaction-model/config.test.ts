import assert from "node:assert/strict";
import test from "node:test";
import { parseModelReference, resolveConfig } from "../../extensions/compaction-model/config.js";

const quiet = () => {};

test("no compactionModel keeps Pi's default compaction", () => {
  assert.equal(resolveConfig({}, undefined, quiet), null);
});

test("a global model routes every reason", () => {
  assert.deepEqual(resolveConfig({ compactionModel: { model: "claude-code/claude-haiku-5-5" } }, undefined, quiet), {
    model: "claude-code/claude-haiku-5-5", thinkingLevel: undefined, reasons: ["manual", "threshold", "overflow"], summaryMaxTokens: 24000,
  });
});

test("project settings can override or switch it off", () => {
  const global = { compactionModel: { model: "claude-code/claude-haiku-5-5" } };
  assert.equal(resolveConfig(global, { compactionModel: false }, quiet), null);
  assert.equal(resolveConfig(global, { compactionModel: { model: "cursor/claude-haiku-5-5@300k" } }, quiet)?.model, "cursor/claude-haiku-5-5@300k");
  assert.equal(resolveConfig({ compactionModel: { model: "a/b", enabled: false } }, undefined, quiet), null);
});

test("bad values warn and fall back", () => {
  const warnings: string[] = [];
  const config = resolveConfig({ compactionModel: { model: "a/b", thinkingLevel: "huge", reasons: ["nope"] } }, undefined, (m) => warnings.push(m));
  assert.equal(config?.thinkingLevel, undefined);
  assert.deepEqual(config?.reasons, ["manual", "threshold", "overflow"]);
  assert.equal(warnings.length, 2);
});

test("model references split on the first slash only", () => {
  assert.deepEqual(parseModelReference("cursor/claude-haiku-5-5@300k"), { provider: "cursor", modelId: "claude-haiku-5-5@300k" });
  assert.deepEqual(parseModelReference("openrouter/anthropic/claude"), { provider: "openrouter", modelId: "anthropic/claude" });
  assert.equal(parseModelReference("no-slash"), null);
  assert.equal(parseModelReference("/x"), null);
});
