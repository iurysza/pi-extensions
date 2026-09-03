import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSuggestions,
  recentConversation,
  selectSuggestion,
  textFromContent,
  visibleUnicodeCharacterCount,
} from "../src/core.js";
import { DEFAULT_CONFIG, readSuggestionConfig } from "../src/config.js";

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

test("focuses, wraps navigation, and dismisses selection without deleting suggestions", () => {
  const initial = { suggestions: ["one", "two", "three"], focusedIndex: undefined };
  const focused = selectSuggestion(initial, "focus");
  assert.equal(focused.focusedIndex, 0);
  assert.equal(selectSuggestion(focused, "up").focusedIndex, 2);
  assert.equal(selectSuggestion(focused, "down").focusedIndex, 1);
  assert.deepEqual(selectSuggestion(focused, "dismiss"), {
    suggestions: ["one", "two", "three"],
    focusedIndex: undefined,
  });
});

test("reads safe flag overrides and retains defaults for invalid values", () => {
  const flags = new Map([
    ["next-message-suggestions-threshold", "42"],
    ["next-message-suggestions-recent-messages", "2"],
    ["next-message-suggestions-count", "4"],
    ["next-message-suggestions-prompt", "Custom prompt"],
    ["next-message-suggestions-provider", "test-provider"],
    ["next-message-suggestions-model", "test-model"],
    ["next-message-suggestions-thinking", "minimal"],
  ]);
  const config = readSuggestionConfig({ getFlag: (name) => flags.get(name) });
  assert.deepEqual(config, {
    threshold: 42,
    recentMessages: 2,
    count: 4,
    prompt: "Custom prompt",
    provider: "test-provider",
    model: "test-model",
    thinking: "minimal",
  });

  flags.set("next-message-suggestions-threshold", "0");
  flags.set("next-message-suggestions-thinking", "invalid");
  const safe = readSuggestionConfig({ getFlag: (name) => flags.get(name) });
  assert.equal(safe.threshold, DEFAULT_CONFIG.threshold);
  assert.equal(safe.thinking, DEFAULT_CONFIG.thinking);
});
