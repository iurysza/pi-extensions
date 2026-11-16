import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  EXIT_TIMEOUT_MS,
  LOCK_STALE_MS,
  clearDeadLock,
  earlyExitMessage,
  lockState,
  piCommand,
  takeLock,
} from "../../extensions/compaction-model/exit-lock.mjs";

const RUNNER = fileURLToPath(new URL("../../extensions/compaction-model/exit-compact.mjs", import.meta.url));
const dir = () => mkdtempSync(join(tmpdir(), "exit-runner-"));
// A pid that is certainly free: a child that has already exited.
const deadPid = () => spawnSync(process.execPath, ["-e", ""]).pid;

test("a lock held by a live runner stays", () => {
  const lock = join(dir(), "s.jsonl.compacting");
  assert.equal(lockState(lock), "free");
  assert.equal(takeLock(lock), true);
  assert.equal(readFileSync(lock, "utf8"), String(process.pid));
  assert.equal(clearDeadLock(lock), "held");
  assert.equal(takeLock(lock), false);
  assert.ok(existsSync(lock));
});

test("a lock whose runner died is cleared and can be taken again", () => {
  const lock = join(dir(), "s.jsonl.compacting");
  writeFileSync(lock, String(deadPid()));
  assert.equal(lockState(lock), "dead");
  assert.equal(clearDeadLock(lock), "dead");
  assert.equal(existsSync(lock), false);
  writeFileSync(lock, String(deadPid()));
  assert.equal(takeLock(lock), true);
});

test("an old lock without a pid is dead only after the timeout", () => {
  const lock = join(dir(), "s.jsonl.compacting");
  writeFileSync(lock, "");
  assert.equal(lockState(lock), "held");
  const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
  utimesSync(lock, old, old);
  assert.equal(clearDeadLock(lock), "dead");
  assert.equal(existsSync(lock), false);
});

test("a live runner keeps its lock while it shuts down after the timeout", () => {
  const lock = join(dir(), "s.jsonl.compacting");
  assert.equal(takeLock(lock), true);
  // Just past the runner's own timeout: it is still stopping pi.
  const timedOut = new Date(Date.now() - EXIT_TIMEOUT_MS - 5000);
  utimesSync(lock, timedOut, timedOut);
  assert.equal(clearDeadLock(lock), "held");
  assert.equal(takeLock(lock), false);
  assert.ok(existsSync(lock));
});

test("pi runs under node only when its CLI is a script", () => {
  assert.deepEqual(piCommand("/x/dist/cli.js", "/n/node"), { command: "/n/node", args: ["/x/dist/cli.js"] });
  assert.deepEqual(piCommand("/x/cli.mjs", "/n/node"), { command: "/n/node", args: ["/x/cli.mjs"] });
  assert.deepEqual(piCommand("/home/me/.local/bin/pi", "/n/node"), { command: "/home/me/.local/bin/pi", args: [] });
});

test("early exit message carries the stderr tail on one line", () => {
  assert.equal(earlyExitMessage(1, null, "Error: boom\n  at x\n"), "pi exited early with code 1: Error: boom at x");
  assert.equal(earlyExitMessage(null, "SIGKILL", ""), "pi exited early with signal SIGKILL (no stderr)");
  assert.ok(earlyExitMessage(1, null, "x".repeat(5000)).length < 2100);
});

const run = (cli) => {
  const root = dir();
  const session = join(root, "s.jsonl");
  const log = join(root, "exit.log");
  writeFileSync(session, "");
  const result = spawnSync(process.execPath, [RUNNER, cli, session, root, log], { timeout: 30_000 });
  return { log: readFileSync(log, "utf8"), lock: existsSync(`${session}.compacting`), status: result.status };
};

test("the runner logs why pi died and leaves no lock", () => {
  const cli = join(dir(), "cli.js");
  writeFileSync(cli, 'console.error("Error: session is broken"); process.exit(1);');
  const { log, lock, status } = run(cli);
  assert.equal(status, 0);
  assert.match(log, /pi exited early with code 1: Error: session is broken/);
  assert.equal(lock, false);
});

test("the runner logs a pi that cannot be started", () => {
  const { log, lock } = run(join(dir(), "missing-pi"));
  assert.match(log, /could not start pi/);
  assert.equal(lock, false);
});

test("the runner records a finished compaction", () => {
  const cli = join(dir(), "cli.js");
  writeFileSync(cli, `process.stdin.once("data", () => {
    console.log(JSON.stringify({ type: "response", command: "compact", success: true, data: { tokensBefore: 123456 } }));
  });
  process.stdin.on("end", () => process.exit(0));`);
  const { log, lock } = run(cli);
  assert.match(log, /started/);
  assert.match(log, /compacted: 123456 tokens before/);
  assert.equal(lock, false);
});
