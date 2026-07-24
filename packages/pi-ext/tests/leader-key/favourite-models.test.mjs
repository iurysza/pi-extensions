import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import {
  activeDefaultNickname,
  buildPickerViewModel,
  buildSetupHint,
  catalogPath,
  loadModelCatalog,
  matchCatalogToRegistry,
} from "../../extensions/leader-key/model-catalog.mjs";

function makeModel(provider, id, name) {
  return { provider, id, name };
}

describe("catalogPath", () => {
  it("prefers explicit agentDir override", () => {
    const p = catalogPath({ agentDir: "/tmp/agent" });
    assert.strictEqual(p, "/tmp/agent/model-catalog.json");
  });

  it("falls back to the normal Pi agent directory when no env", () => {
    const original = process.env.PI_CODING_AGENT_DIR;
    delete process.env.PI_CODING_AGENT_DIR;
    assert.strictEqual(catalogPath(), path.join(os.homedir(), ".pi/agent/model-catalog.json"));
    if (original) process.env.PI_CODING_AGENT_DIR = original;
  });
});

describe("loadModelCatalog", () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "model-catalog-"));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when sidecar missing", () => {
    assert.strictEqual(loadModelCatalog({ agentDir: tmpDir }), null);
  });

  it("parses valid sidecar", () => {
    fs.writeFileSync(
      path.join(tmpDir, "model-catalog.json"),
      JSON.stringify({
        defaultModel: "Deep",
        entries: [
          { nickname: "Deep", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
          { nickname: "Workhorse", provider: "kimi-coding", model: "kimi-for-coding", thinking: "high" },
        ],
        setupHint: "hint text",
      })
    );
    const catalog = loadModelCatalog({ agentDir: tmpDir });
    assert.strictEqual(catalog.defaultModel, "Deep");
    assert.strictEqual(catalog.entries.length, 2);
    assert.strictEqual(catalog.entries[1].nickname, "Workhorse");
  });

  it("returns null for malformed sidecar", () => {
    fs.writeFileSync(path.join(tmpDir, "model-catalog.json"), "not-json");
    assert.strictEqual(loadModelCatalog({ agentDir: tmpDir }), null);
  });
});

describe("matchCatalogToRegistry", () => {
  it("matches entries to available models in order", () => {
    const catalog = {
      defaultModel: "Deep",
      entries: [
        { nickname: "Deep", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
        { nickname: "Workhorse", provider: "kimi-coding", model: "kimi-for-coding", thinking: "high" },
      ],
      setupHint: "hint",
    };
    const available = [
      makeModel("kimi-coding", "kimi-for-coding", "Kimi for Coding"),
      makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
    ];
    const matched = matchCatalogToRegistry(catalog, available);
    assert.strictEqual(matched.length, 2);
    assert.strictEqual(matched[0].matched.name, "GPT-5.6 Sol");
    assert.strictEqual(matched[1].matched.name, "Kimi for Coding");
  });

  it("leaves matched undefined for unavailable models", () => {
    const catalog = {
      defaultModel: "Deep",
      entries: [{ nickname: "Deep", provider: "missing", model: "missing", thinking: "xhigh" }],
      setupHint: "hint",
    };
    const matched = matchCatalogToRegistry(catalog, []);
    assert.strictEqual(matched[0].matched, undefined);
  });

  it("handles duplicate IDs gracefully", () => {
    const catalog = {
      defaultModel: "Deep",
      entries: [
        { nickname: "Deep", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
        { nickname: "Deep2", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
      ],
      setupHint: "hint",
    };
    const available = [makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol")];
    const matched = matchCatalogToRegistry(catalog, available);
    assert.strictEqual(matched[0].matched.name, "GPT-5.6 Sol");
    assert.strictEqual(matched[1].matched.name, "GPT-5.6 Sol");
  });
});

describe("buildPickerViewModel", () => {
  const current = makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol");

  it("shows the active model and setup hint when the sidecar is absent", () => {
    const view = buildPickerViewModel({ catalog: null, availableModels: [current], currentModel: current, currentThinking: "xhigh" });
    assert.deepStrictEqual(view.entries, [{ label: "GPT-5.6 Sol", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh", active: true }]);
    assert.match(view.fallbackHint, /install-config\.json/);
  });

  it("shows the synthesized Default entry plus its actionable hint", () => {
    const catalog = { defaultModel: "Default", fallback: true, entries: [{ nickname: "Default", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" }], setupHint: "Configure profiles.work.models in install-config.json" };
    const view = buildPickerViewModel({ catalog, availableModels: [current], currentModel: current, currentThinking: "xhigh" });
    assert.strictEqual(view.entries[0].label, "Default — GPT-5.6 Sol");
    assert.strictEqual(view.entries[0].active, true);
    assert.strictEqual(view.fallbackHint, catalog.setupHint);
  });

  it("preserves labels and order while dropping unknown and duplicate models", () => {
    const catalog = { defaultModel: "Deep", entries: [
      { nickname: "Deep", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
      { nickname: "Missing", provider: "unknown", model: "none", thinking: "high" },
      { nickname: "Duplicate", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
      { nickname: "Coder", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
    ], setupHint: "unused" };
    const view = buildPickerViewModel({ catalog, availableModels: [current], currentModel: current, currentThinking: "medium" });
    assert.deepStrictEqual(view.entries.map((entry) => entry.label), ["Deep — GPT-5.6 Sol", "Coder — GPT-5.6 Sol"]);
    assert.strictEqual(view.fallbackHint, undefined);
  });
});

describe("helpers", () => {
  it("returns default nickname and hint", () => {
    const catalog = { defaultModel: "Coder", entries: [], setupHint: "setup me" };
    assert.strictEqual(activeDefaultNickname(catalog), "Coder");
    assert.strictEqual(buildSetupHint(catalog), "setup me");
    assert.strictEqual(buildSetupHint(null), "Add named models to install-config.json under profiles.<profile>.models.");
  });
});
