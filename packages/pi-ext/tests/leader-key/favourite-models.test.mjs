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

function themedCatalog(overrides = {}) {
  return {
    schemaVersion: 2,
    kind: "themed-tier-catalog",
    defaultModel: "Heavy",
    display: {
      mode: "tiers",
      showProviderGroups: false,
      showModelNames: false,
    },
    entries: [
      { nickname: "Fly", provider: "kimi-coding", model: "kimi-for-coding", thinking: "high" },
      { nickname: "Mid", provider: "openai", model: "gpt-5.6-terra", thinking: "high" },
      { nickname: "Heavy", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
    ],
    ...overrides,
  };
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

  it("keeps standard sidecar presentation unchanged", () => {
    const catalog = { defaultModel: "Deep", entries: [
      { nickname: "Deep", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "xhigh" },
    ], setupHint: "unused" };
    const view = buildPickerViewModel({ catalog, availableModels: [current], currentModel: current, currentThinking: "medium" });
    assert.deepStrictEqual(view, {
      entries: [{
        label: "Deep — GPT-5.6 Sol",
        provider: "openai-codex",
        model: "gpt-5.6-sol",
        thinking: "xhigh",
        active: true,
      }],
      fallbackHint: undefined,
    });
  });

  it("renders themed tiers as exact labels without provider groups or model names", () => {
    const available = [
      makeModel("kimi-coding", "kimi-for-coding", "Kimi for Coding"),
      makeModel("openai", "gpt-5.6-terra", "GPT-5.6 Terra"),
      makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
    ];
    const view = buildPickerViewModel({
      catalog: themedCatalog(),
      availableModels: available,
      currentModel: available[2],
      currentThinking: "medium",
    });
    assert.deepStrictEqual(view.entries.map(({ label, thinking, active }) => ({ label, thinking, active })), [
      { label: "Fly", thinking: "high", active: false },
      { label: "Mid", thinking: "high", active: false },
      { label: "Heavy", thinking: "medium", active: true },
    ]);
    assert.strictEqual(view.tierMode, true);
    assert.strictEqual(view.showProviderGroups, false);
    assert.strictEqual(view.showModelNames, false);
    assert.strictEqual(view.error, undefined);
  });

  it("accepts duplicate provider and model IDs when thinking differs", () => {
    const model = makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol");
    const catalog = themedCatalog({
      entries: [
        { nickname: "Fly", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "low" },
        { nickname: "Mid", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
        { nickname: "Heavy", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
      ],
    });
    const view = buildPickerViewModel({ catalog, availableModels: [model], currentModel: model, currentThinking: "medium" });
    assert.deepStrictEqual(view.entries.map((entry) => entry.active), [false, true, false]);
  });

  it("shows no active tier when the current tuple is custom", () => {
    const available = [
      makeModel("kimi-coding", "kimi-for-coding", "Kimi for Coding"),
      makeModel("openai", "gpt-5.6-terra", "GPT-5.6 Terra"),
      makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
    ];
    const view = buildPickerViewModel({ catalog: themedCatalog(), availableModels: available, currentModel: available[2], currentThinking: "high" });
    assert.deepStrictEqual(view.entries.map((entry) => entry.active), [false, false, false]);
  });

  it("rejects missing, unavailable, and collapsed themed tiers", () => {
    const available = [makeModel("openai-codex", "gpt-5.6-sol", "GPT-5.6 Sol")];
    const missing = themedCatalog({ entries: themedCatalog().entries.slice(0, 2) });
    assert.match(buildPickerViewModel({ catalog: missing, availableModels: available }).error, /Fly, Mid, and Heavy/);

    assert.match(buildPickerViewModel({ catalog: themedCatalog(), availableModels: available }).error, /unavailable tier Fly/);

    const collapsed = themedCatalog({
      entries: [
        { nickname: "Fly", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
        { nickname: "Mid", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "medium" },
        { nickname: "Heavy", provider: "openai-codex", model: "gpt-5.6-sol", thinking: "high" },
      ],
    });
    assert.match(buildPickerViewModel({ catalog: collapsed, availableModels: available }).error, /duplicate tuple/);
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
