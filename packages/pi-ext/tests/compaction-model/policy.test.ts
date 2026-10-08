import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../../extensions/compaction-model/config.js";
import {
  decorateSummary,
  firstUserText,
  mergeInstructions,
  overThreshold,
  stripAdditions,
} from "../../extensions/compaction-model/policy.js";

const quiet = () => {};
const user = (content: unknown) => ({ type: "message", message: { role: "user", content } });

test("first user text skips non-user entries and empty messages", () => {
  const entries = [
    { type: "model_change" },
    { type: "message", message: { role: "assistant", content: "hi" } },
    user([{ type: "image" }]),
    user([{ type: "text", text: "Fix the login bug" }]),
    user("later"),
  ];
  assert.equal(firstUserText(entries), "Fix the login bug");
  assert.equal(firstUserText([]), undefined);
});

test("long first messages are truncated", () => {
  const text = firstUserText([user("x".repeat(5000))]);
  assert.ok(text && text.length < 2100 && text.endsWith("[… truncated]"));
});

test("decorate adds anchor and pointer, and redecorating does not duplicate them", () => {
  const once = decorateSummary("## Goal\nship it", "Fix the login bug", "/s/a.jsonl");
  assert.match(once, /<session-start verbatim>\nFix the login bug\n<\/session-start>/);
  assert.match(once, /reference only/);
  assert.match(once, /\/s\/a\.jsonl/);
  assert.equal(stripAdditions(once), "## Goal\nship it");
  const twice = decorateSummary(once, "Fix the login bug", "/s/a.jsonl");
  assert.equal(twice.match(/<session-start/g)?.length, 1);
  assert.equal(twice.match(/<summary-note>/g)?.length, 1);
});

test("decorate without anchor or file still points to the session", () => {
  const out = decorateSummary("s", undefined, undefined);
  assert.doesNotMatch(out, /session-start/);
  assert.match(out, /this session's file/);
});

test("user focus is appended after the default instructions", () => {
  assert.equal(mergeInstructions("A", "  B "), "A\n\nB");
  assert.equal(mergeInstructions("A", "  "), "A");
  assert.equal(mergeInstructions("A"), "A");
});

test("threshold compares tokens with the percent of the window", () => {
  assert.equal(overThreshold({ tokens: 140_000, contextWindow: 200_000 }, 70), true);
  assert.equal(overThreshold({ tokens: 139_999, contextWindow: 200_000 }, 70), false);
  assert.equal(overThreshold({ tokens: null, contextWindow: 200_000 }, 70), false);
  assert.equal(overThreshold({ tokens: 190_000, contextWindow: 200_000 }, undefined), false);
  assert.equal(overThreshold(undefined, 70), false);
});

test("thresholdPercent and compactOnExitMinTokens are parsed and validated", () => {
  const ok = resolveConfig({ compactionModel: { model: "a/b", thresholdPercent: 70, compactOnExitMinTokens: 100_000 } }, undefined, quiet);
  assert.equal(ok?.thresholdPercent, 70);
  assert.equal(ok?.compactOnExitMinTokens, 100_000);
  const warnings: string[] = [];
  const bad = resolveConfig({ compactionModel: { model: "a/b", thresholdPercent: 120, compactOnExitMinTokens: -1 } }, undefined, (w) => warnings.push(w));
  assert.equal(bad?.thresholdPercent, undefined);
  assert.equal(bad?.compactOnExitMinTokens, undefined);
  assert.equal(warnings.length, 2);
});
