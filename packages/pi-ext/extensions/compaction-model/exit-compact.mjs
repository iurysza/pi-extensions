#!/usr/bin/env node
// Compacts a closed Pi session in the background. Spawned detached by the
// compaction-model extension on quit, so it outlives the Pi that started it.
// Usage: node exit-compact.mjs <pi-cli> <session-file> <cwd> <log-file>
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { EXIT_TIMEOUT_MS, earlyExitMessage, piCommand, takeLock } from "./exit-lock.mjs";

const [piCli, sessionFile, cwd, logFile] = process.argv.slice(2);
const TIMEOUT_MS = EXIT_TIMEOUT_MS;
const lockFile = `${sessionFile}.compacting`;

const log = (message) => {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${sessionFile} ${message}\n`);
  } catch {}
};

if (!takeLock(lockFile)) {
  log("skipped: another exit compaction is running");
  process.exit(0);
}

const release = () => { try { unlinkSync(lockFile); } catch {} };
const { command, args } = piCommand(piCli);
const child = spawn(command, [...args, "--mode", "rpc", "--session", sessionFile], {
  cwd,
  env: { ...process.env, PI_COMPACT_ON_EXIT_CHILD: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

// Kept so an early exit can say why; only the tail is logged.
let stderr = "";
child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8000); });
child.on("error", (error) => { if (!done) log(`could not start pi (${command}): ${error.message}`); release(); process.exit(0); });
// The child may be gone before the command is written.
child.stdin.on("error", () => {});

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
child.on("close", (code, signal) => { if (!done) log(earlyExitMessage(code, signal, stderr)); release(); process.exit(0); });
setTimeout(() => finish("timed out"), TIMEOUT_MS).unref();

child.stdin.write(`${JSON.stringify({ type: "compact" })}\n`);
log("started");
