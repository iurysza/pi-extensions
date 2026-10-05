import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, MODE_ENTRY, WAKE_MESSAGE } from "../src/core.js";
import { memoRunner, registerOptMem } from "../src/index.js";

function harness({ flags = {}, branch = [], mode = "tui", config = DEFAULT_CONFIG, memoExists = true, runner, env = {} } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const notes = [];
  const status = new Map();
  let active = ["read", "bash", "edit", "write"];
  const pi = {
    registerFlag: () => {},
    getFlag: (name) => flags[name],
    registerCommand: (name, options) => commands.set(name, options),
    registerTool: (tool) => tools.set(tool.name, tool),
    on: (event, handler) => handlers.set(event, handler),
    appendEntry: (customType, data) => entries.push({ customType, data }),
    getActiveTools: () => active,
    setActiveTools: (names) => {
      active = names;
    },
  };
  const ctx = {
    mode,
    hasUI: mode === "tui" || mode === "rpc",
    cwd: "/tmp/project",
    sessionManager: { getBranch: () => branch },
    ui: {
      notify: (message, level) => notes.push({ message, level }),
      setStatus: (key, value) => status.set(key, value),
    },
  };
  const calls = [];
  registerOptMem(pi, {
    env,
    loadConfig: async () => ({ config }),
    memoExists: () => memoExists,
    runner:
      runner ??
      (() => async (args) => {
        calls.push(args);
        return { code: 0, stdout: args[0] === "wake" ? "#0 2026-10-05 likes tea\nYou are awake.\n" : `ran ${args.join(" ")}`, stderr: "" };
      }),
  });
  return {
    pi,
    ctx,
    tools,
    entries,
    notes,
    status,
    calls,
    active: () => active,
    emit: (event, payload = {}) => handlers.get(event)?.({ type: event, ...payload }, ctx),
    command: (args) => commands.get("memory").handler(args, ctx),
  };
}

const start = (h) => h.emit("session_start", { reason: "startup" });
const prompt = (h) => h.emit("before_agent_start", { prompt: "hi", systemPrompt: "BASE", systemPromptOptions: {} });

test("default off: no tools, no prompt, no wake, mem:off status", async () => {
  const h = harness();
  await start(h);
  assert.equal(h.status.get("optmem"), "mem:off");
  assert.deepEqual(h.active(), ["read", "bash", "edit", "write"]);
  assert.equal(await prompt(h), undefined);
  assert.deepEqual(h.calls, []);
});

test("--memory turns it on and persists the mode", async () => {
  const h = harness({ flags: { memory: true } });
  await start(h);
  assert.equal(h.status.get("optmem"), "mem:on");
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), ["memo_note", "memo_zoom", "memo_recall", "memo_nap"]);
  assert.deepEqual(h.entries, [{ customType: MODE_ENTRY, data: { mode: "on" } }]);
  const result = await prompt(h);
  assert.match(result.systemPrompt, /^BASE\n\n## Memory \(OptMem\)/);
  assert.equal(result.message.customType, WAKE_MESSAGE);
  assert.match(result.message.content, /likes tea/);
  // Wake loads once per session, not every turn.
  const again = await prompt(h);
  assert.equal(again.message, undefined);
  assert.match(again.systemPrompt, /## Memory/);
});

test("resumed session keeps its persisted mode", async () => {
  const h = harness({ branch: [{ type: "custom", customType: MODE_ENTRY, data: { mode: "read" } }] });
  await start(h);
  assert.equal(h.status.get("optmem"), "mem:read");
  assert.deepEqual(h.entries, []);
  const result = await prompt(h);
  assert.match(result.systemPrompt, /read-only/);
});

test("resume does not reload a wake view already on the branch", async () => {
  const h = harness({
    branch: [
      { type: "custom", customType: MODE_ENTRY, data: { mode: "on" } },
      { type: "custom_message", customType: WAKE_MESSAGE },
    ],
  });
  await start(h);
  assert.equal((await prompt(h)).message, undefined);
});

test("subagent sessions are forced off even with --memory", async () => {
  const h = harness({ flags: { memory: true }, mode: "print" });
  await start(h);
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), []);
  assert.equal(await prompt(h), undefined);
  assert.deepEqual(h.entries, []);
});

test("subagentMode read caps a child at read", async () => {
  const h = harness({ flags: { memory: true }, mode: "print", config: { ...DEFAULT_CONFIG, subagentMode: "read" } });
  await start(h);
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), ["memo_zoom", "memo_recall"]);
});

test("/memory switches mid-session; off drops wake from context", async () => {
  const h = harness();
  await start(h);
  await h.command("on");
  assert.equal(h.status.get("optmem"), "mem:on");
  assert.deepEqual(h.entries.at(-1), { customType: MODE_ENTRY, data: { mode: "on" } });
  const loaded = await prompt(h);
  assert.match(loaded.message.content, /likes tea/);

  const wake = { role: "custom", customType: WAKE_MESSAGE, content: "x" };
  const user = { role: "user", content: "hi" };
  assert.equal(await h.emit("context", { messages: [wake, user] }), undefined);
  const older = { ...wake, content: "old" };
  assert.deepEqual((await h.emit("context", { messages: [older, user, wake] })).messages, [user, wake]);

  await h.command("off");
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), []);
  assert.deepEqual((await h.emit("context", { messages: [wake, user] })).messages, [user]);
  assert.equal(await prompt(h), undefined);
  await assert.rejects(h.tools.get("memo_note").execute("id", { line: "x" }), /memory is off/);

  await h.command("read");
  assert.match((await prompt(h)).message.content, /mode="read"/);
});

test("/memory without args shows mode and paths", async () => {
  const h = harness({ env: { MEMORY_DIR: "/tmp/mem" } });
  await start(h);
  await h.command("");
  assert.match(h.notes.at(-1).message, /mode: off \(default\)/);
  assert.match(h.notes.at(-1).message, /memory: \/tmp\/mem/);
  await h.command("loud");
  assert.match(h.notes.at(-1).message, /Usage/);
});

test("subagent cannot /memory on", async () => {
  const h = harness({ mode: "rpc", env: { PI_OPTMEM_SUBAGENT: "1" } });
  await start(h);
  await h.command("on");
  assert.match(h.notes.at(-1).message, /cannot go above/);
  assert.equal(h.status.get("optmem"), "mem:off");
});

test("bash guard and MEMORY_DIR injection", async () => {
  const h = harness({ flags: { "memory-read": true }, env: { MEMORY_DIR: "/tmp/mem" } });
  await start(h);
  const blocked = await h.emit("tool_call", { toolName: "bash", input: { command: "memo note hi" } });
  assert.equal(blocked.block, true);
  const input = { command: "memo wake" };
  assert.equal(await h.emit("tool_call", { toolName: "bash", input }), undefined);
  assert.equal(input.command, "export MEMORY_DIR='/tmp/mem'; memo wake");
  const plain = { command: "ls" };
  await h.emit("tool_call", { toolName: "bash", input: plain });
  assert.equal(plain.command, "ls");
  const write = await h.emit("tool_call", { toolName: "write", input: { path: "/tmp/mem/LOG.txt" } });
  assert.equal(write.block, true);
});

test("missing memo: hint instead of crash", async () => {
  const h = harness({ flags: { memory: true }, memoExists: false });
  await start(h);
  assert.match(h.notes.at(-1).message, /install-memo\.sh/);
  assert.equal(h.status.get("optmem"), "mem:on (no memo)");
  const result = await prompt(h);
  assert.match(result.message.content, /status="missing"/);
  await assert.rejects(h.tools.get("memo_recall").execute("id", { regex: "x" }), /install-memo\.sh/);
});

test("non-UI modes do not touch ctx.ui", async () => {
  const h = harness({ flags: { memory: true }, mode: "json", memoExists: false });
  h.ctx.ui = new Proxy({}, { get: () => assert.fail("ui used without UI") });
  await start(h);
});

// ---------------------------------------------------------------- integration

function findMemo() {
  const candidates = [process.env.PI_OPTMEM_TEST_MEMO, join(homedir(), ".local/share/optmem/memo"), "/tmp/memo.py"];
  return candidates.find((path) => path && existsSync(path));
}

const memoSource = findMemo();

test("integration: note -> nap prompt -> nap -> wake -> zoom", { skip: memoSource ? false : "no memo found; set PI_OPTMEM_TEST_MEMO" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-optmem-"));
  try {
    const memo = join(dir, "memo");
    copyFileSync(memoSource, memo);
    chmodSync(memo, 0o755);
    const memoryDir = join(dir, "memory");
    execFileSync(memo, ["init"], { env: { ...process.env, MEMORY_DIR: memoryDir } });

    // The real runner; the extension must override any inherited MEMORY_DIR.
    const real = harness({
      flags: { memory: true },
      config: { ...DEFAULT_CONFIG, memoPath: memo },
      env: { MEMORY_DIR: memoryDir },
      runner: (path, mdir) => memoRunner(path, mdir, { ...process.env, MEMORY_DIR: "/should/be/overridden" }),
    });
    await start(real);
    const note = real.tools.get("memo_note");
    const first = await note.execute("1", { line: "Iury prefers tea over coffee" });
    assert.match(first.content[0].text, /Saved as #0\./);
    const second = await note.execute("2", { line: "pi-optmem built on 2026-10-05" });
    assert.match(second.content[0].text, /Compress memories #0-1/);
    assert.match(second.content[0].text, /Call memo_nap with range "0-1"/);

    const nap = await real.tools.get("memo_nap").execute("3", { range: "0-1", line: "Tea fan; pi-optmem built" });
    assert.match(nap.content[0].text, /0-1 saved\./);

    const woke = await prompt(real);
    assert.match(woke.message.content, /#0 \d{4}-\d{2}-\d{2} Iury prefers tea/);
    assert.match(woke.message.content, /#1 \d{4}-\d{2}-\d{2} pi-optmem built/);

    const zoom = await real.tools.get("memo_zoom").execute("4", { range: "0-1" });
    assert.match(zoom.content[0].text, /#0 .*tea/);

    const recall = await real.tools.get("memo_recall").execute("5", { regex: "TEA" });
    assert.match(recall.content[0].text, /1 match\./);

    await assert.rejects(real.tools.get("memo_nap").execute("6", { range: "1-2", line: "x" }), /not a block/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
