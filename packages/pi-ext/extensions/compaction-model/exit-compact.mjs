#!/usr/bin/env node
// Compacts a closed Pi session in the background. Spawned detached by the
// compaction-model extension on quit, so it outlives the Pi that started it.
// Usage: node exit-compact.mjs <pi-cli> <session-file> <cwd> <log-file>
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync, closeSync, unlinkSync, existsSync, statSync } from "node:fs";
import { dirname } from "node:path";

const [piCli, sessionFile, cwd, logFile] = process.argv.slice(2);
const TIMEOUT_MS = 10 * 60 * 1000;
const lockFile = `${sessionFile}.compacting`;

const log = (message) => {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${sessionFile} ${message}\n`);
  } catch {}
};

function takeLock() {
  try {
    // A lock older than the timeout belongs to a dead runner.
    if (existsSync(lockFile) && Date.now() - statSync(lockFile).mtimeMs > TIMEOUT_MS) unlinkSync(lockFile);
    closeSync(openSync(lockFile, "wx"));
    return true;
  } catch {
    return false;
  }
}

if (!takeLock()) {
  log("skipped: another exit compaction is running");
  process.exit(0);
}

const release = () => { try { unlinkSync(lockFile); } catch {} };
const child = spawn(process.execPath, [piCli, "--mode", "rpc", "--session", sessionFile], {
  cwd,
  env: { ...process.env, PI_COMPACT_ON_EXIT_CHILD: "1" },
  stdio: ["pipe", "pipe", "ignore"],
});

let buffer = "";
let done = false;
const finish = (message) => {
  if (done) return;
  done = true;
  log(message);
  child.stdin.end();
  setTimeout(() => { child.kill("SIGTERM"); release(); process.exit(0); }, 15_000).unref();
};

child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "response" && event.command === "compact") {
      finish(event.success ? `compacted: ${event.data?.tokensBefore ?? "?"} tokens before` : `failed: ${event.error}`);
    }
  }
});
child.on("exit", (code) => { if (!done) log(`pi exited early with code ${code}`); release(); process.exit(0); });
setTimeout(() => finish("timed out"), TIMEOUT_MS).unref();

child.stdin.write(`${JSON.stringify({ type: "compact" })}\n`);
log("started");
