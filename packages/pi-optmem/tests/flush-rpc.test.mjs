import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { DEFAULT_CONFIG, resolvePaths } from "../src/core.js";
import { flushLogPath } from "../src/flush-job.js";
import { logLength, pendingBlocks, readMemories } from "../src/memstore.js";
import { runMemo } from "../src/generate/pipeline.js";

const enabled = process.env.PI_OPTMEM_REAL_FLUSH_TEST === "1";

test("RPC compact: real Haiku worker writes temporary memory after Pi exits", { skip: enabled ? false : "opt-in: PI_OPTMEM_REAL_FLUSH_TEST=1 and PI_OPTMEM_TEST_PROVIDER=<provider repo>", timeout: 180_000 }, async () => {
  const provider = process.env.PI_OPTMEM_TEST_PROVIDER;
  assert.ok(provider, "set PI_OPTMEM_TEST_PROVIDER to the Claude subscription provider package");
  const root = mkdtempSync(join(tmpdir(), "optmem-flush-rpc-"));
  const agent = join(root, "agent");
  const memoryDir = join(root, "memory");
  const session = join(root, "session.jsonl");
  const marker = join(root, "parent-exited");
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  // Build tests run in dist/tests, where the corresponding built fixture lives.
  const fixture = join(dirname(fileURLToPath(import.meta.url)), "fixtures/flush-rpc.js");
  const sourceRoot = existsSync(join(packageRoot, "scripts")) ? packageRoot : resolve(packageRoot, "..");
  const pi = process.env.PI_OPTMEM_PI || "pi";
  let parent;
  let evidence;
  try {
    mkdirSync(agent);
    writeFileSync(join(agent, "settings.json"), JSON.stringify({
      defaultProvider: "claude-code", defaultModel: "claude-haiku-5-5", compaction: { enabled: false },
      packages: [{ source: provider, extensions: ["src/index.ts"] }, { source: sourceRoot, extensions: ["src/index.ts"] }],
      extensions: [fixture],
    }));
    const paths = resolvePaths(DEFAULT_CONFIG);
    assert.equal((await runMemo(paths.memoPath, memoryDir, ["init"])).code, 0);
    assert.equal((await runMemo(paths.memoPath, memoryDir, ["note", "Iury runs marathons."])).code, 0);
    writeFileSync(join(agent, "pi-optmem.defaults.json"), JSON.stringify({ defaultMode: "on", flushBeforeCompact: true, model: "claude-code/claude-haiku-5-5", memoPath: paths.memoPath, memoryDir }));
    const entries = [{ type: "session", version: 3, id: "rpc-flush-test", timestamp: new Date().toISOString(), cwd: root }];
    let previous = null;
    const add = (message) => {
      const id = `m${entries.length}`;
      entries.push({ type: "message", id, parentId: previous, timestamp: new Date().toISOString(), message });
      previous = id;
    };
    const filler = "Routine temporary debugging transcript, no lasting decision or useful fact. ".repeat(1600);
    add({ role: "user", content: `Iury prefers black tea to coffee. We decided to keep the project migration unfinished until the tests pass; details live in ${root}/migration.md.\n${filler}`, timestamp: Date.now() });
    add({ role: "assistant", content: [{ type: "text", text: "Understood. I will preserve the preference and migration pointer." }], api: "claude-code", provider: "claude-code", model: "claude-haiku-5-5", stopReason: "stop", timestamp: Date.now(), usage: { input: 30000, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30020, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    add({ role: "user", content: `Now inspect these transient diagnostics, which add no durable facts.\n${filler}`, timestamp: Date.now() });
    writeFileSync(session, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const env = { ...process.env, PI_CODING_AGENT_DIR: agent, MEMORY_DIR: memoryDir, PI_OPTMEM_PI: pi, PI_OPTMEM_TEST_EXIT_MARKER: marker, PI_OPTMEM_TEST_TRACE: join(root, "model-output.jsonl") };
    // The test runner itself can be a subagent, but this fake session is top-level.
    delete env.PI_OPTMEM_SUBAGENT;
    delete env.PI_OPTMEM_FLUSH_CHILD;
    delete env.PI_OPTMEM_CONFIG;
    delete env.PI_OPTMEM_DEFAULTS;
    parent = spawn(pi, ["--mode", "rpc", "--session", session, "--no-skills", "--no-context-files"], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let stderr = "";
    parent.stderr.on("data", (chunk) => stderr += chunk);
    const compacted = new Promise((res, rej) => {
      parent.stdout.on("data", (chunk) => {
        output += chunk;
        let end;
        while ((end = output.indexOf("\n")) >= 0) {
          const line = output.slice(0, end);
          output = output.slice(end + 1);
          let item;
          try { item = JSON.parse(line); } catch { continue; }
          if (item.type === "extension_error") rej(new Error(JSON.stringify(item)));
          if (item.type === "response" && item.command === "compact") item.success ? res(item.data) : rej(new Error(item.error));
        }
      });
      parent.on("error", rej);
      parent.on("exit", (code) => rej(new Error(`RPC exited early: ${code}; ${stderr}`)));
    });
    parent.stdin.write('{"type":"compact"}\n');
    const compact = await compacted;
    assert.ok(compact.tokensBefore > 20_000);
    assert.equal(logLength(memoryDir), 1, "only the seeded fact exists before exit");
    const exited = once(parent, "exit");
    parent.stdin.end();
    await exited;
    const exitTime = new Date().toISOString();
    writeFileSync(marker, "exited");
    const deadline = Date.now() + 120_000;
    let logs = [];
    while (Date.now() < deadline) {
      if (existsSync(flushLogPath(memoryDir))) logs = readFileSync(flushLogPath(memoryDir), "utf8").trim().split("\n").map(JSON.parse);
      if (logs.some((entry) => entry.status === "done" || entry.status === "failed")) break;
      await setTimeout(100);
    }
    const done = logs.find((entry) => entry.status === "done");
    const trace = existsSync(join(root, "model-output.jsonl")) ? readFileSync(join(root, "model-output.jsonl"), "utf8") : "";
    assert.ok(done, `worker did not finish: ${JSON.stringify(logs)}; synthetic responses: ${trace}`);
    assert.ok(done.time > exitTime);
    assert.ok(done.written > 0 && done.written <= 5);
    assert.ok(done.naps > 0, "the real model settled the new pair");
    assert.equal(pendingBlocks(memoryDir).length, 0);
    const memories = readMemories(memoryDir, 0, logLength(memoryDir));
    assert.ok(memories.some((memory) => /tea|migration/i.test(memory.text)));
    assert.ok(memories.every((memory) => Buffer.byteLength(memory.text) <= 280));
    const storedSession = readFileSync(session, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(storedSession.filter((entry) => entry.type === "compaction").length, 1);
    evidence = { tokensBefore: compact.tokensBefore, parentExitedAt: exitTime, completedAt: done.time, model: done.model, written: done.written, naps: done.naps, memories: memories.map((memory) => memory.text) };
    console.log(`Detached flush evidence: ${JSON.stringify(evidence)}`);
  } finally {
    parent?.kill("SIGTERM");
    // Keep explicit evidence only when requested; never use the live store.
    if (process.env.PI_OPTMEM_TEST_EVIDENCE && evidence) writeFileSync(process.env.PI_OPTMEM_TEST_EVIDENCE, JSON.stringify(evidence, null, 2) + "\n");
    rmSync(root, { recursive: true, force: true });
  }
});
