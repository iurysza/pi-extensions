import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HANDLERS } from "../src/commands.js";
import { loadLayeredConfig, readUserConfig } from "../src/config-file.js";
import { DEFAULT_CONFIG, DEFAULT_MODEL, agents2Memo, findMemo, layerConfigs, parseConfig } from "../src/core.js";
import { COMMAND_MENU_COLLECT, MENU_GROUP, menuSubcommands, subscribeMenu } from "../src/menu.js";
import { registerOptMem } from "../src/index.js";

function tempDir() {
  return mkdtempSync(join(tmpdir(), "optmem-cfg-"));
}

test("parseConfig accepts model and an unset memoPath", () => {
  assert.deepEqual(parseConfig({}), { ok: true, config: DEFAULT_CONFIG });
  assert.equal(DEFAULT_CONFIG.memoPath, undefined);
  assert.equal(DEFAULT_CONFIG.model, DEFAULT_MODEL);
  assert.equal(parseConfig({ model: "x/y" }).config.model, "x/y");
  assert.equal(parseConfig({ model: "has space" }).ok, false);
  assert.equal(parseConfig({ memoPath: "" }).ok, false);
});

test("layers: built-in < defaults < user, whole keys replaced", () => {
  const result = layerConfigs([
    { name: "defaults", value: { defaultMode: "on", model: "a/b", rules: [{ cwd: "/x", mode: "off" }] } },
    { name: "user", value: { defaultMode: "read" } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.config.defaultMode, "read");
  assert.equal(result.config.model, "a/b");
  assert.deepEqual(result.config.rules, [{ cwd: "/x", mode: "off" }]);
  const bad = layerConfigs([{ name: "user", value: { nope: 1 } }]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /^user: unknown property/);
});

test("loadLayeredConfig reads both files and skips a broken user file", () => {
  const dir = tempDir();
  try {
    const env = { PI_CODING_AGENT_DIR: dir };
    assert.deepEqual(loadLayeredConfig(env), { config: DEFAULT_CONFIG });
    writeFileSync(join(dir, "pi-optmem.defaults.json"), JSON.stringify({ defaultMode: "on", model: "p/m" }));
    assert.equal(loadLayeredConfig(env).config.defaultMode, "on");
    writeFileSync(join(dir, "pi-optmem.json"), JSON.stringify({ defaultMode: "off" }));
    assert.equal(loadLayeredConfig(env).config.defaultMode, "off");
    assert.equal(loadLayeredConfig(env).config.model, "p/m");
    writeFileSync(join(dir, "pi-optmem.json"), "{broken");
    const loaded = loadLayeredConfig(env);
    assert.equal(loaded.config.defaultMode, "on", "profile defaults survive a broken user file");
    assert.match(loaded.error, /pi-optmem\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("findMemo: explicit path, then agents2 active rev, then install-memo location", () => {
  const home = "/h";
  const files = new Map([["/h/.local/share/agents2/tools/optmem/history.json", JSON.stringify(["rev2", "rev1"])]]);
  const existing = new Set(["/h/.local/share/agents2/tools/optmem/rev2/memo"]);
  const probe = { exists: (p) => existing.has(p), read: (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); } };
  assert.equal(findMemo("~/bin/m", home, probe), "/h/bin/m");
  assert.equal(agents2Memo(home, probe), "/h/.local/share/agents2/tools/optmem/rev2/memo");
  assert.equal(findMemo(undefined, home, probe), "/h/.local/share/agents2/tools/optmem/rev2/memo");
  existing.clear();
  assert.equal(findMemo(undefined, home, probe), "/h/.local/share/optmem/memo");
  files.set("/h/.local/share/agents2/tools/optmem/history.json", JSON.stringify(["../evil"]));
  existing.add("/h/.local/share/agents2/tools/evil/memo");
  assert.equal(agents2Memo(home, probe), undefined, "rev must be a plain dir name");
});

test("menu: one root group on key b, every item runs a known /memory subcommand", () => {
  const added = [];
  let handler;
  subscribeMenu({ on: (channel, h) => ((handler = h), assert.equal(channel, COMMAND_MENU_COLLECT), () => {}) });
  handler({ version: 2, add: (g) => added.push(g) });
  assert.equal(added.length, 0, "ignores other versions");
  handler({ version: 1, add: (g) => added.push(g) });
  assert.equal(added.length, 1);
  assert.equal(added[0].id, "pi-optmem");
  assert.equal(added[0].key, "b");

  const keysUnique = (items) => {
    const keys = items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `duplicate keys in ${keys}`);
    for (const item of items) {
      assert.match(item.key, /^[a-z]$/);
      if (item.items) keysUnique(item.items);
      else assert.equal(item.command.name, "memory");
    }
  };
  keysUnique(MENU_GROUP.items);
  assert.deepEqual(MENU_GROUP.items.map((i) => i.label), ["This session", "Browse", "Files", "Defaults", "Maintenance", "Generate"]);

  // Every subcommand the menu sends must be accepted by /memory.
  const pi = {
    events: { on: () => () => {} },
    registerFlag: () => {},
    registerCommand: (name, options) => (pi.command = options),
    registerTool: () => {},
    on: () => {},
  };
  const generation = Object.fromEntries(["generate", "catchup", "job", "cancel", "naps"].map((k) => [k, async () => {}]));
  registerOptMem(pi, { env: {}, loadConfig: async () => ({ config: DEFAULT_CONFIG }), extraHandlers: generation });
  const completions = pi.command.getArgumentCompletions("").map((c) => c.value);
  for (const sub of menuSubcommands()) assert.ok(completions.includes(sub), `/memory ${sub} is not handled`);
});

function commandEnv(dir, overrides = {}) {
  const notes = [];
  const env = { PI_CODING_AGENT_DIR: dir };
  let config = DEFAULT_CONFIG;
  const c = {
    ctx: {
      hasUI: true,
      cwd: "/work/proj",
      ui: {
        notify: (message, level) => notes.push({ message, level }),
        select: async (_title, options) => overrides.select?.(options),
        input: async () => overrides.input,
        confirm: async () => overrides.confirm ?? true,
        editor: async (title, text) => (notes.push({ editor: title, text }), overrides.editor),
      },
      modelRegistry: { getAvailable: () => [{ provider: "openai-codex", id: "gpt-6-luna" }, { provider: "x", id: "y" }] },
    },
    get config() {
      return config;
    },
    paths: { memoPath: "/nope/memo", memoryDir: join(dir, "memory") },
    run: overrides.run ?? (async () => ({ code: 0, stdout: "", stderr: "" })),
    env,
    memoExists: () => true,
    reloadConfig: async () => {
      config = loadLayeredConfig(env).config;
    },
  };
  return { c, notes, env };
}

test("Defaults items write the user config and reload it", async () => {
  const dir = tempDir();
  try {
    const { c, env } = commandEnv(dir, { select: (options) => options[0] });
    await HANDLERS.default("read", c);
    assert.deepEqual(readUserConfig(env), { defaultMode: "read" });
    await HANDLERS.rule("on", c);
    await HANDLERS.rule("off", c);
    assert.deepEqual(readUserConfig(env).rules, [{ cwd: "/work/proj", mode: "off" }], "one rule per folder");
    await HANDLERS.rule("clear", c);
    assert.deepEqual(readUserConfig(env).rules, []);
    await HANDLERS.model("", c);
    assert.equal(readUserConfig(env).model, DEFAULT_MODEL, "picker offers the current model first");
    assert.equal(c.config.defaultMode, "read", "config reloaded");
    // Bad value is refused and nothing is written.
    await HANDLERS.default("loud", c);
    assert.equal(readUserConfig(env).defaultMode, "read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Edit config validates before writing", async () => {
  const dir = tempDir();
  try {
    const bad = commandEnv(dir, { editor: '{"defaultMode":"loud"}' });
    await HANDLERS.config("", bad.c);
    assert.match(bad.notes.at(-1).message, /Not saved/);
    assert.throws(() => readFileSync(join(dir, "pi-optmem.json")));
    const good = commandEnv(dir, { editor: '{"defaultMode":"on"}' });
    await HANDLERS.config("", good.c);
    assert.deepEqual(readUserConfig(good.env), { defaultMode: "on" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Browse items call memo and show output read-only; stats reads the store", async () => {
  const dir = tempDir();
  try {
    const calls = [];
    const { c, notes } = commandEnv(dir, {
      input: "tea",
      run: async (args) => (calls.push(args), { code: 0, stdout: args[0] === "wake" ? "#0 2026-01-01 a\nYou are awake.\n" : "#0 2026-01-01 likes tea\n1 match.", stderr: "" }),
    });
    await HANDLERS.search("", c);
    assert.deepEqual(calls.at(-1), ["recall", "tea"]);
    assert.match(notes.at(-1).text, /likes tea/);
    await HANDLERS.view("", c);
    assert.match(notes.at(-1).text, /#0 2026-01-01 a/);
    await HANDLERS.stats("", c);
    assert.match(notes.at(-1).message, /No memory/);
    mkdirSync(join(dir, "memory", "TREE"), { recursive: true });
    const rec = (i, d, t) => Buffer.from(`#${i} ${d} ${t}`.padEnd(319) + "\n");
    writeFileSync(join(dir, "memory", "LOG.txt"), Buffer.concat([rec(0, "2025-01-02", "x"), rec(1, "2025-03-04", "y"), rec(2, "2025-05-06", "z")]));
    await HANDLERS.stats("", c);
    assert.match(notes.at(-1).message, /memories: 3\nfirst: 2025-01-02, last: 2025-05-06\npending naps: 1/);
    await HANDLERS.log("", c);
    assert.match(notes.at(-1).text, /#2 2025-05-06 z/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
