import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_CONFIG,
  followUpConfigPath,
  loadOrCreateFollowUpConfig,
  parseFollowUpConfig,
} from "../src/config.js";

async function temporaryConfig(t) {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-follow-up-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  return followUpConfigPath(agentDir);
}

test("creates a user-editable default config on first load", async (t) => {
  const path = await temporaryConfig(t);
  const config = await loadOrCreateFollowUpConfig(path);

  assert.deepEqual(config, DEFAULT_CONFIG);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), DEFAULT_CONFIG);
  if (process.platform !== "win32") {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});

test("loads a partial config and merges omitted defaults", async (t) => {
  const path = await temporaryConfig(t);
  await writeFile(path, JSON.stringify({ threshold: 42, count: 4, thinking: "minimal" }));

  assert.deepEqual(await loadOrCreateFollowUpConfig(path), {
    ...DEFAULT_CONFIG,
    threshold: 42,
    count: 4,
    thinking: "minimal",
  });
});

test("loads every configurable helper value", () => {
  const result = parseFollowUpConfig({
    threshold: 42,
    recentMessages: 2,
    count: 4,
    prompt: "Custom prompt",
    provider: "test-provider",
    model: "test-model",
    thinking: "minimal",
  });

  assert.deepEqual(result, {
    ok: true,
    config: {
      threshold: 42,
      recentMessages: 2,
      count: 4,
      prompt: "Custom prompt",
      provider: "test-provider",
      model: "test-model",
      thinking: "minimal",
    },
  });
});

test("rejects unknown and invalid configuration values", () => {
  const invalid = [
    [null, "expected a JSON object"],
    [{ typo: true }, 'unknown property "typo"'],
    [{ threshold: 0 }, "threshold must be a positive integer"],
    [{ recentMessages: 1.5 }, "recentMessages must be a positive integer"],
    [{ count: "3" }, "count must be a positive integer"],
    [{ prompt: " " }, "prompt must be a non-empty string"],
    [{ provider: false }, "provider must be a non-empty string"],
    [{ model: "" }, "model must be a non-empty string"],
    [{ thinking: "off" }, "thinking must be one of minimal, low, medium, high, xhigh, or max"],
  ];

  for (const [value, error] of invalid) {
    assert.deepEqual(parseFollowUpConfig(value), { ok: false, error });
  }
});

test("reports malformed JSON without replacing the user file", async (t) => {
  const path = await temporaryConfig(t);
  await writeFile(path, "{invalid");

  await assert.rejects(loadOrCreateFollowUpConfig(path), new RegExp(`Invalid JSON in ${path}`));
  assert.equal(await readFile(path, "utf8"), "{invalid");
});

test("settings.json followUpModel overrides provider, model and thinking", async (t) => {
  const { applyFollowUpModelSetting, loadFollowUpModelSetting, parseFollowUpModelSetting } = await import("../src/config.js");
  const agentDir = await mkdtemp(join(tmpdir(), "pi-follow-up-settings-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  assert.equal(await loadFollowUpModelSetting(agentDir), undefined);
  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ theme: "x" }));
  assert.equal(await loadFollowUpModelSetting(agentDir), undefined);

  await writeFile(join(agentDir, "settings.json"), JSON.stringify({ followUpModel: { model: "claude-code/claude-haiku-5-5", thinking: "high" } }));
  const setting = await loadFollowUpModelSetting(agentDir);
  assert.deepEqual(setting, { provider: "claude-code", model: "claude-haiku-5-5", thinking: "high" });
  assert.deepEqual(applyFollowUpModelSetting({ ...DEFAULT_CONFIG, threshold: 120 }, setting), {
    ...DEFAULT_CONFIG,
    threshold: 120,
    provider: "claude-code",
    model: "claude-haiku-5-5",
    thinking: "high",
  });

  assert.deepEqual(parseFollowUpModelSetting({ followUpModel: { model: "a/b" } }), { provider: "a", model: "b" });
  assert.throws(() => parseFollowUpModelSetting({ followUpModel: { model: "no-slash" } }), /provider\/model/);
  assert.throws(() => parseFollowUpModelSetting({ followUpModel: { model: "a/b", thinking: "huge" } }), /thinking/);
});
