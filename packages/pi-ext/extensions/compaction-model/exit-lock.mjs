// Lock and launch helpers shared by the exit runner (plain node) and the extension.
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

export const EXIT_TIMEOUT_MS = 10 * 60 * 1000;
const STDERR_TAIL_CHARS = 2000;

/** True when a process with this pid exists. EPERM means it exists but belongs to someone else. */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/** "free" when no lock exists, "held" when its runner is alive, "dead" when it can be removed. */
export function lockState(lockFile, now = Date.now()) {
  let stat;
  try { stat = statSync(lockFile); } catch { return "free"; }
  if (now - stat.mtimeMs > EXIT_TIMEOUT_MS) return "dead";
  let text = "";
  try { text = readFileSync(lockFile, "utf8").trim(); } catch { return "free"; }
  // Locks written before pids were recorded are empty; only their age can tell.
  if (!text) return "held";
  return isAlive(Number(text)) ? "held" : "dead";
}

/** Removes a lock whose runner is gone. Returns the state found before removal. */
export function clearDeadLock(lockFile, now = Date.now()) {
  const state = lockState(lockFile, now);
  if (state === "dead") { try { unlinkSync(lockFile); } catch {} }
  return state;
}

export function takeLock(lockFile, pid = process.pid) {
  clearDeadLock(lockFile);
  try {
    const fd = openSync(lockFile, "wx");
    try { writeSync(fd, String(pid)); } finally { closeSync(fd); }
    return true;
  } catch {
    return false;
  }
}

/** Pi's CLI is a script for node, unless a wrapper put an executable in argv[1]. */
export function piCommand(piCli, nodePath = process.execPath) {
  return /\.[cm]?js$/.test(piCli) ? { command: nodePath, args: [piCli] } : { command: piCli, args: [] };
}

/** Last part of the child's stderr on one line, for the log. */
export function stderrTail(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > STDERR_TAIL_CHARS ? `…${flat.slice(-STDERR_TAIL_CHARS)}` : flat;
}

export function earlyExitMessage(code, signal, stderr) {
  const how = signal ? `signal ${signal}` : `code ${code}`;
  const tail = stderrTail(stderr);
  return tail ? `pi exited early with ${how}: ${tail}` : `pi exited early with ${how} (no stderr)`;
}
