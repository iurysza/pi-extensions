import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DEFAULT_CONFIG, MODE_ENTRY, WAKE_MESSAGE, guardBash } from "../src/core.js";
import { memoRunner, registerOptMem } from "../src/index.js";

function harness({ flags = {}, branch = [], mode = "tui", config = DEFAULT_CONFIG, memoExists = true, runner, env = {} } = {}) {
  const handlers = new Map();
  const commands = new Map();
  const tools = new Map();
  const entries = [];
  const notes = [];
  const status = new Map();
  let active = ["read", "bash", "edit", "write"];
  const menuHandlers = [];
  const pi = {
    events: { on: (channel, handler) => (menuHandlers.push({ channel, handler }), () => {}) },
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
    sessionManager: { getBranch: () => h.branch },
    ui: {
      notify: (message, level) => notes.push({ message, level }),
      setStatus: (key, value) => status.set(key, value),
    },
  };
  const calls = [];
  const h = { branch };
  registerOptMem(pi, {
    env,
    loadConfig: async () => ({ config }),
    memoExists: typeof memoExists === "function" ? memoExists : () => memoExists,
    runner:
      runner ??
      (() => async (args) => {
        calls.push(args);
        return { code: 0, stdout: args[0] === "wake" ? "#0 2026-10-05 likes tea\nYou are awake.\n" : `ran ${args.join(" ")}`, stderr: "" };
      }),
  });
  return Object.assign(h, {
    pi,
    ctx,
    menuHandlers,
    tools,
    entries,
    notes,
    status,
    calls,
    active: () => active,
    emit: (event, payload = {}) => handlers.get(event)?.({ type: event, ...payload }, ctx),
    command: (args) => commands.get("memory").handler(args, ctx),
  });
}

const start = (h, reason = "startup") => h.emit("session_start", { reason });
const USER = { role: "user", content: "hi" };
/** The wake view the next request would carry, or undefined. */
async function wakeIn(h, messages = [USER]) {
  const result = await h.emit("context", { messages });
  const out = result?.messages ?? messages;
  return out.find((m) => m.role === "custom" && m.customType === WAKE_MESSAGE)?.content;
}
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
  assert.equal(result.message, undefined, "wake view is never persisted");
  assert.match(await wakeIn(h), /likes tea/);
  await prompt(h);
  assert.equal(h.calls.filter((c) => c[0] === "wake").length, 1, "a good wake is reused");
});

test("resumed session keeps its persisted mode", async () => {
  const h = harness({ branch: [{ type: "custom", customType: MODE_ENTRY, data: { mode: "read" } }] });
  await start(h, "resume");
  assert.equal(h.status.get("optmem"), "mem:read");
  assert.deepEqual(h.entries, []);
  const result = await prompt(h);
  assert.match(result.systemPrompt, /read-only/);
  assert.match(await wakeIn(h), /mode="read"/);
});

test("subagent sessions are forced off even with --memory", async () => {
  const h = harness({ flags: { memory: true }, mode: "print" });
  await start(h);
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), []);
  assert.equal(await prompt(h), undefined);
  assert.equal(await wakeIn(h), undefined);
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
  await prompt(h);
  assert.match(await wakeIn(h), /likes tea/);

  await h.command("off");
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), []);
  assert.equal(await wakeIn(h), undefined);
  assert.equal(await prompt(h), undefined);
  await assert.rejects(h.tools.get("memo_note").execute("id", { line: "x" }), /memory is off/);

  await h.command("read");
  await prompt(h);
  assert.match(await wakeIn(h), /mode="read"/);
});

// Finding 2: persisted wake messages leaked into compaction and branch summaries.
test("legacy persisted wake messages are filtered from requests, compaction and branch summaries", async () => {
  const canary = { role: "custom", customType: WAKE_MESSAGE, content: "CANARY", display: false, timestamp: 1 };
  const h = harness({ branch: [{ type: "custom", customType: MODE_ENTRY, data: { mode: "off" } }] });
  await start(h, "resume");
  const result = await h.emit("context", { messages: [canary, USER] });
  assert.deepEqual(result.messages, [USER]);

  const preparation = { messagesToSummarize: [canary, USER], turnPrefixMessages: [canary] };
  await h.emit("session_before_compact", { preparation, branchEntries: [] });
  assert.deepEqual(preparation.messagesToSummarize, [USER]);
  assert.deepEqual(preparation.turnPrefixMessages, []);

  const entry = { type: "custom_message", customType: WAKE_MESSAGE, content: "CANARY" };
  const kept = { type: "message", message: USER };
  const tree = { entriesToSummarize: [entry, kept] };
  await h.emit("session_before_tree", { preparation: tree });
  assert.deepEqual(tree.entriesToSummarize, [kept]);
});

test("the wake view is request-local and replaces stale copies when on", async () => {
  const h = harness({ flags: { memory: true } });
  await start(h);
  await prompt(h);
  const stale = { role: "custom", customType: WAKE_MESSAGE, content: "STALE" };
  const result = await h.emit("context", { messages: [stale, USER] });
  assert.equal(result.messages.length, 2);
  assert.match(result.messages[0].content, /likes tea/);
  assert.doesNotMatch(JSON.stringify(result.messages), /STALE/);
});

// Re-review: automatic compaction continues the run without before_agent_start.
for (const reason of ["threshold", "overflow"]) {
  test(`${reason} compaction: the next request reloads the wake view without a new prompt`, async () => {
    const h = harness({ flags: { memory: true } });
    await start(h);
    await prompt(h);
    assert.match(await wakeIn(h), /likes tea/);

    const canary = { role: "custom", customType: WAKE_MESSAGE, content: "CANARY" };
    const preparation = { messagesToSummarize: [canary, USER], turnPrefixMessages: [canary] };
    await h.emit("session_before_compact", { preparation, branchEntries: [], reason, willRetry: reason === "overflow" });
    assert.doesNotMatch(JSON.stringify(preparation), /CANARY|likes tea/, "summary input has no wake");
    await h.emit("session_compact", { compactionEntry: {}, fromExtension: false, reason });

    // Straight to the continuation request: no before_agent_start.
    assert.match(await wakeIn(h), /likes tea/);
    assert.equal(h.calls.filter((c) => c[0] === "wake").length, 2);
    await wakeIn(h);
    assert.equal(h.calls.filter((c) => c[0] === "wake").length, 2, "reloaded once, then reused");
  });
}

test("context does not retry a failed wake on every tool turn", async () => {
  const h = harness({ flags: { memory: true }, memoExists: false });
  await start(h);
  await prompt(h);
  await wakeIn(h);
  await wakeIn(h);
  assert.match(await wakeIn(h), /status="missing"/);
  assert.deepEqual(h.calls, []);
});

test("context stays empty when memory is off", async () => {
  const h = harness();
  await start(h);
  await h.emit("session_compact", {});
  assert.equal(await wakeIn(h), undefined);
  assert.deepEqual(h.calls, []);
});

// Finding 3: /reload re-applied CLI flags over a later /memory switch.
test("reload keeps a /memory switch made after --memory", async () => {
  const h = harness({ flags: { memory: true } });
  await start(h);
  await h.command("off");
  h.branch = h.entries.map((e) => ({ type: "custom", ...e }));
  await start(h, "reload");
  assert.equal(h.status.get("optmem"), "mem:off");
  assert.deepEqual(h.active().filter((n) => n.startsWith("memo_")), []);
  assert.deepEqual(h.entries.at(-1).data, { mode: "off" });
});

test("reload keeps a /memory switch made after --no-memory", async () => {
  const h = harness({ flags: { "no-memory": true } });
  await start(h);
  await h.command("on");
  h.branch = h.entries.map((e) => ({ type: "custom", ...e }));
  for (const reason of ["reload", "new", "resume", "fork"]) {
    await start(h, reason);
    assert.equal(h.status.get("optmem"), "mem:on", reason);
  }
});

test("initial CLI resume still honours an explicit flag", async () => {
  const h = harness({ flags: { "no-memory": true }, branch: [{ type: "custom", customType: MODE_ENTRY, data: { mode: "on" } }] });
  await start(h, "startup");
  assert.equal(h.status.get("optmem"), "mem:off");
});

// Finding 4: tree navigation kept the previous branch's mode and wake state.
test("tree navigation follows the destination branch's mode", async () => {
  const onBranch = [{ type: "custom", customType: MODE_ENTRY, data: { mode: "on" } }];
  const offBranch = [{ type: "custom", customType: MODE_ENTRY, data: { mode: "off" } }];
  const readBranch = [{ type: "custom", customType: MODE_ENTRY, data: { mode: "read" } }];
  const h = harness({ flags: { memory: true }, branch: onBranch });
  await start(h);
  await prompt(h);
  assert.match(await wakeIn(h), /mode="on"/);

  h.branch = offBranch;
  await h.emit("session_tree", { newLeafId: "b", oldLeafId: "a" });
  assert.equal(h.status.get("optmem"), "mem:off");
  assert.equal(await prompt(h), undefined);
  assert.equal(await wakeIn(h), undefined);
  assert.equal((await h.emit("tool_call", { toolName: "bash", input: { command: "memo note x" } })).block, true);

  h.branch = readBranch;
  await h.emit("session_tree", { newLeafId: "c", oldLeafId: "b" });
  assert.equal(h.status.get("optmem"), "mem:read");
  await prompt(h);
  assert.match(await wakeIn(h), /mode="read"/, "a fresh wake loads for the new branch");
  assert.equal(h.calls.filter((c) => c[0] === "wake").length, 2);
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
  await prompt(h);
  assert.match(await wakeIn(h), /status="missing"/);
  await assert.rejects(h.tools.get("memo_recall").execute("id", { regex: "x" }), /install-memo\.sh/);
});

// Finding 5: a failed wake was cached as loaded and never retried.
test("missing then installed: the next prompt retries the wake", async () => {
  let installed = false;
  const h = harness({ flags: { memory: true }, memoExists: () => installed });
  await start(h);
  await prompt(h);
  assert.match(await wakeIn(h), /status="missing"/);
  assert.deepEqual(h.calls, []);
  installed = true;
  await prompt(h);
  assert.deepEqual(h.calls, [["wake"]]);
  assert.match(await wakeIn(h), /likes tea/);
});

test("blocked then compressed: wake retries on the next prompt and after /memory on", async () => {
  let blocked = true;
  const calls = [];
  const h = harness({
    flags: { memory: true },
    runner: () => async (args) => {
      calls.push(args);
      if (args[0] === "wake" && blocked) return { code: 1, stdout: 'Cannot wake: the memory context needs #0-127\nRun: /x/memo nap 0-1 "<your line>"', stderr: "" };
      return { code: 0, stdout: "#0 2026-10-05 likes tea\nYou are awake.\n", stderr: "" };
    },
  });
  await start(h);
  await prompt(h);
  assert.match(await wakeIn(h), /needs-compression/);
  blocked = false;
  await prompt(h);
  assert.match(await wakeIn(h), /likes tea/);
  await prompt(h);
  assert.equal(calls.filter((c) => c[0] === "wake").length, 2, "a good wake is cached");
  await h.command("on");
  await prompt(h);
  assert.equal(calls.filter((c) => c[0] === "wake").length, 3, "/memory on forces a reload");
});

test("blocked wake on resume retries instead of trusting history", async () => {
  const h = harness({
    branch: [
      { type: "custom", customType: MODE_ENTRY, data: { mode: "on" } },
      { type: "custom_message", customType: WAKE_MESSAGE, content: '<optmem-wake status="needs-compression">' },
    ],
  });
  await start(h, "resume");
  await prompt(h);
  assert.deepEqual(h.calls, [["wake"]]);
  assert.match(await wakeIn(h), /likes tea/);
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

    await prompt(real);
    const woke = await wakeIn(real);
    assert.match(woke, /#0 \d{4}-\d{2}-\d{2} Iury prefers tea/);
    assert.match(woke, /#1 \d{4}-\d{2}-\d{2} pi-optmem built/);

    const zoom = await real.tools.get("memo_zoom").execute("4", { range: "0-1" });
    assert.match(zoom.content[0].text, /#0 .*tea/);

    const recall = await real.tools.get("memo_recall").execute("5", { regex: "TEA" });
    assert.match(recall.content[0].text, /1 match\./);

    await assert.rejects(real.tools.get("memo_nap").execute("6", { range: "1-2", line: "x" }), /not a block/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const real = memoSource ? test : test.skip;

function realStore(dirName) {
  const dir = mkdtempSync(join(tmpdir(), "pi-optmem-"));
  const prefix = join(dir, dirName);
  execFileSync("mkdir", ["-p", prefix]);
  const memo = join(prefix, "memo");
  copyFileSync(memoSource, memo);
  chmodSync(memo, 0o755);
  const memoryDir = join(dir, "memory");
  const env = { ...process.env, MEMORY_DIR: memoryDir };
  execFileSync(memo, ["init"], { env });
  return { dir, memo, memoryDir, env, log: () => readFileSync(join(memoryDir, "LOG.txt"), "utf8") };
}

// Finding 1, against a real store: only commands the guard allows are executed.
real("integration: conditional memo writes are blocked in off and read", async () => {
  const store = realStore("bin");
  try {
    for (const mode of ["off", "read"]) {
      const h = harness({
        branch: [{ type: "custom", customType: MODE_ENTRY, data: { mode } }],
        config: { ...DEFAULT_CONFIG, memoPath: store.memo, memoryDir: store.memoryDir },
      });
      await start(h, "resume");
      for (const command of [
        `if true; then python3 ${store.memo} note "example"; fi`,
        `while true; do ${store.memo} note "loop"; break; done`,
      ]) {
        const input = { command };
        const decision = await h.emit("tool_call", { toolName: "bash", input });
        if (!decision?.block) execFileSync("bash", ["-c", input.command], { env: store.env });
        assert.equal(decision?.block, true, `${mode}: ${command}`);
      }
    }
    assert.equal(store.log(), "", "no memory was written");
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});

// Finding 6, against real memo: a spaced install path still pages through every part.
real("integration: multi-part wake under a spaced prefix", async () => {
  const store = realStore("Opt Mem");
  try {
    execFileSync(store.memo, ["config", "PART_LINES=1"], { env: store.env });
    execFileSync(store.memo, ["note", "first note about tea"], { env: store.env });
    execFileSync(store.memo, ["note", "second note about coffee"], { env: store.env });
    const h = harness({
      flags: { memory: true },
      config: { ...DEFAULT_CONFIG, memoPath: store.memo, memoryDir: store.memoryDir },
      runner: (path, mdir) => memoRunner(path, mdir, process.env),
    });
    await start(h);
    await prompt(h);
    const view = await wakeIn(h);
    assert.match(view, /first note about tea/);
    assert.match(view, /second note about coffee/);
    assert.doesNotMatch(view, /Not awake yet/);
    assert.match(view, /memo_nap/, "the pending compression request survives");
    assert.equal(guardBash(`"${store.memo}" wake 2 1`, "read", store.memo).allow, true);
  } finally {
    rmSync(store.dir, { recursive: true, force: true });
  }
});
