import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSuggestions,
  recentConversation,
  textFromContent,
  visibleUnicodeCharacterCount,
} from "../src/core.js";

test("counts visible Unicode code points instead of UTF-16 units", () => {
  assert.equal(visibleUnicodeCharacterCount("A😀é"), 3);
});

test("keeps only text content and excludes hidden assistant metadata", () => {
  assert.equal(textFromContent([
    { type: "thinking", thinking: "hidden" },
    { type: "toolCall", id: "call", name: "bash", arguments: {} },
    { type: "text", text: "Visible answer" },
  ]), "Visible answer");
});

test("takes the newest conversational messages only", () => {
  const context = recentConversation([
    { role: "user", text: "first" },
    { role: "assistant", text: "second" },
    { role: "user", text: "third" },
    { role: "assistant", text: "" },
    { role: "assistant", text: "fourth" },
  ], 3);
  assert.deepEqual(context, [
    { role: "assistant", text: "second" },
    { role: "user", text: "third" },
    { role: "assistant", text: "fourth" },
  ]);
});

test("accepts only the exact structured suggestion contract", () => {
  assert.deepEqual(parseSuggestions({
    suggestions: ["Could you add tests?", "Explain the trade-off.", "Ship this."],
  }, 3), ["Could you add tests?", "Explain the trade-off.", "Ship this."]);
  assert.equal(parseSuggestions({ suggestions: ["one", "two"] }, 3), undefined);
  assert.equal(parseSuggestions({ suggestions: ["one", "two", "ONE"] }, 3), undefined);
  assert.equal(parseSuggestions({ suggestions: ["one", "two", "three"], explanation: "no" }, 3), undefined);
  assert.equal(parseSuggestions(["one", "two", "three"], 3), undefined);
});
