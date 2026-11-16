// Lock and launch helpers shared by the exit runner (plain node) and the extension.
import { closeSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";

export const EXIT_TIMEOUT_MS = 10 * 60 * 1000;
// After the timeout the runner still needs a moment to stop pi. A lock only counts as
// abandoned by age once that is long over; until then the recorded pid decides.
export const LOCK_STALE_MS = EXIT_TIMEOUT_MS + 60 * 1000;
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
  let text = "";
  try { text = readFileSync(lockFile, "utf8").trim(); } catch { return "free"; }
  // A recorded pid that is gone means the runner died, whatever the lock's age.
  if (text && !isAlive(Number(text))) return "dead";
  // Otherwise only age can tell: a lock without a pid (written by an older runner), or a pid
  // that was reused by another process long after the runner ended.
  return now - stat.mtimeMs > LOCK_STALE_MS ? "dead" : "held";
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
