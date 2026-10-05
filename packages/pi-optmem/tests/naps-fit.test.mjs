import assert from "node:assert/strict";
import test from "node:test";

import { fallbackSummary, fitBytes, parseNaps } from "../src/generate/model.js";

// Pilot: the fallback join was 281 bytes and the model's own lines could exceed the limit.
test("nap lines always fit the 280-byte limit", () => {
  const long = Array.from({ length: 16 }, (_, i) => `#${i} 2025-01-01 décision número ${i} sobre o projeto`);
  for (const text of [fallbackSummary(long), fitBytes("é".repeat(400)), fitBytes("word ".repeat(100))]) {
    assert.ok(Buffer.byteLength(text, "utf8") <= 280, `${Buffer.byteLength(text)} bytes`);
    assert.ok(text.endsWith("…"));
  }
  assert.equal(fitBytes("short"), "short");
  const [[, line]] = [...parseNaps(`B1 ${"x ".repeat(200)}`, 1)];
  assert.ok(Buffer.byteLength(line, "utf8") <= 280);
});
