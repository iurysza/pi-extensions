import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import net, { type Server, type Socket } from "node:net";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const watcher = join(root, "scripts/sidebar-watcher.mjs");
const controller = join(root, "scripts/ghost-state.sh");

interface ScriptedResponse {
  kind: "layout" | "malformed" | "error" | "close";
  x?: number;
  width?: number;
  focusedPaneId?: string;
  delayMs?: number;
}

interface FakeHerdr {
  server: Server;
  socketPath: string;
  requests: Array<Record<string, unknown>>;
  maxActiveConnections: () => number;
  close: () => Promise<void>;
}

function temporaryDirectory(prefix = "gitm-"): string {
  return mkdtempSync(join("/tmp", prefix));
}

function canonicalSocketPath(socketPath: string): string {
  try {
    return realpathSync.native(socketPath);
  } catch {
    return socketPath;
  }
}

function socketKey(socketPath: string): string {
  return createHash("sha256").update(canonicalSocketPath(socketPath)).digest("hex");
}

function watcherDirectory(stateHome: string, socketPath: string): string {
  return join(stateHome, "ghost-in-the-machine", "watchers", socketKey(socketPath));
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

function waitForExit(child: ChildProcess, timeoutMs = 3000): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`process ${child.pid ?? "unknown"} did not exit`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited ${code}: ${stderr}`));
    });
  });
}

async function startFakeHerdr(directory: string, scriptedResponses: ScriptedResponse[]): Promise<FakeHerdr> {
  const socketPath = join(directory, "herdr.sock");
  const requests: Array<Record<string, unknown>> = [];
  let responseIndex = 0;
  let activeConnections = 0;
  let maximumConnections = 0;
  const sockets = new Set<Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    activeConnections += 1;
    maximumConnections = Math.max(maximumConnections, activeConnections);
    socket.once("close", () => {
      sockets.delete(socket);
      activeConnections -= 1;
    });
    let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString("utf8");
      const newline = input.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(input.slice(0, newline)) as Record<string, unknown>;
      requests.push(request);
      const response = scriptedResponses[Math.min(responseIndex, scriptedResponses.length - 1)]!;
      responseIndex += 1;
      setTimeout(() => {
        if (response.kind === "close") {
          socket.end();
          return;
        }
        if (response.kind === "malformed") {
          socket.end("not-json\n");
          return;
        }
        if (response.kind === "error") {
          socket.end(`${JSON.stringify({ id: request.id, error: { message: "test failure" } })}\n`);
          return;
        }
        socket.end(`${JSON.stringify({
          id: request.id,
          result: {
            layout: {
              area: { x: response.x, width: response.width },
              focused_pane_id: response.focusedPaneId,
            },
          },
        })}\n`);
      }, response.delayMs ?? 0);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    server,
    socketPath,
    requests,
    maxActiveConnections: () => maximumConnections,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(socketPath, { force: true });
    },
  };
}

function writeFakeController(directory: string): { path: string; log: string } {
  const path = join(directory, "controller with spaces.sh");
  const log = join(directory, "controller.log");
  writeFileSync(path, `#!/usr/bin/env bash
set -euo pipefail
if [[ -n "\${CONTROLLER_FAIL_ONCE_FILE:-}" && ! -e "$CONTROLLER_FAIL_ONCE_FILE" ]]; then
  touch "$CONTROLLER_FAIL_ONCE_FILE"
  printf 'failed:%s\\n' "$2" >> "$CONTROLLER_LOG"
  exit 1
fi
printf '%s' "$2" >> "$CONTROLLER_LOG"
[[ $# -lt 3 ]] || printf ':%s' "$3" >> "$CONTROLLER_LOG"
printf '\\n' >> "$CONTROLLER_LOG"
`);
  chmodSync(path, 0o755);
  return { path, log };
}

function watcherEnvironment(
  stateHome: string,
  socketPath: string,
  fakeController: { path: string; log: string },
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    XDG_STATE_HOME: stateHome,
    HERDR_ENV: "1",
    HERDR_SOCKET_PATH: socketPath,
    HERDR_BIN_PATH: "/usr/bin/true",
    GHOST_CONTROLLER_PATH: fakeController.path,
    GHOST_SIDEBAR_WATCHER_PATH: watcher,
    GHOSTTY_RELOAD_ENABLED: "0",
    CONTROLLER_LOG: fakeController.log,
    SIDEBAR_POLL_INTERVAL: "0.01",
    SIDEBAR_REQUEST_TIMEOUT_MS: "100",
    ...overrides,
  };
}

test("watcher frames pane.layout requests, serializes polls, and deduplicates transitions", async () => {
  const directory = temporaryDirectory("gitm protocol ");
  const stateHome = join(directory, "state with spaces");
  mkdirSync(stateHome, { recursive: true });
  const fakeController = writeFakeController(directory);
  const herdr = await startFakeHerdr(directory, [
    { kind: "layout", x: 36, width: 82, focusedPaneId: "pane-1", delayMs: 30 },
    { kind: "layout", x: 36, width: 82, focusedPaneId: "pane-1" },
    { kind: "layout", x: 4, width: 114 },
    { kind: "malformed" },
    { kind: "error" },
    { kind: "close" },
    { kind: "layout", x: 4, width: 114 },
    { kind: "layout", x: 36, width: 82, focusedPaneId: "pane-1" },
  ]);
  const runtime = watcherDirectory(stateHome, herdr.socketPath);
  const logFile = join(runtime, "watcher.log");
  const pidFile = join(runtime, "watcher.pid");
  const socketFile = join(runtime, "socket-path");
  const child = spawn(process.execPath, [
    watcher,
    "--socket", herdr.socketPath,
    "--log", logFile,
    "--pid-file", pidFile,
    "--socket-file", socketFile,
    "--controller", fakeController.path,
  ], {
    env: watcherEnvironment(stateHome, herdr.socketPath, fakeController),
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    await waitFor(() => herdr.requests.length >= 8, "watcher did not complete scripted requests");
    await waitFor(
      () => existsSync(fakeController.log) && readFileSync(fakeController.log, "utf8").split("\n").filter(Boolean).length >= 3,
      "watcher did not apply the final expanded transition",
    );
    child.kill("SIGTERM");
    await waitForExit(child);

    assert.equal(herdr.maxActiveConnections(), 1);
    assert.ok(herdr.requests.every((request) => request.method === "pane.layout"));
    assert.ok(herdr.requests.every((request) => JSON.stringify(request.params) === "{}"));
    assert.equal(new Set(herdr.requests.map((request) => request.id)).size, herdr.requests.length);
    assert.equal(readFileSync(fakeController.log, "utf8"), "expanded:pane-1\ncollapsed\nexpanded:pane-1\n");
    assert.equal(readFileSync(socketFile, "utf8"), `${canonicalSocketPath(herdr.socketPath)}\n`);
    assert.equal(existsSync(pidFile), false);

    const log = readFileSync(logFile, "utf8");
    assert.match(log, /state=collapsed area_x=4/);
    assert.match(log, /state=expanded area_x=36/);
    assert.match(log, /Herdr API error/);
    assert.match(log, /connection closed before a complete response/);
    assert.match(log, /watcher=stop reason=signal/);
    assert.match(log, /avg_latency_ms=/);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("watcher retries a failed transition action without repeating transition logs", async () => {
  const directory = temporaryDirectory("gitm-retry-");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const herdr = await startFakeHerdr(directory, [{ kind: "layout", x: 4, width: 114 }]);
  const runtime = watcherDirectory(stateHome, herdr.socketPath);
  const logFile = join(runtime, "watcher.log");
  const pidFile = join(runtime, "watcher.pid");
  const child = spawn(process.execPath, [
    watcher,
    "--socket", herdr.socketPath,
    "--log", logFile,
    "--pid-file", pidFile,
    "--socket-file", join(runtime, "socket-path"),
    "--controller", fakeController.path,
  ], {
    env: watcherEnvironment(stateHome, herdr.socketPath, fakeController, {
      CONTROLLER_FAIL_ONCE_FILE: join(directory, "failed-once"),
      SIDEBAR_ACTION_RETRY_MS: "20",
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    await waitFor(
      () => existsSync(fakeController.log) && readFileSync(fakeController.log, "utf8").split("\n").filter(Boolean).length >= 2,
      "watcher did not retry the failed transition",
    );
    child.kill("SIGTERM");
    await waitForExit(child);
    assert.equal(readFileSync(fakeController.log, "utf8"), "failed:collapsed\ncollapsed\n");
    const log = readFileSync(logFile, "utf8");
    assert.equal(log.match(/state=collapsed/g)?.length, 1);
    assert.match(log, /action=ghost-collapsed result=error/);
    assert.match(log, /action=ghost-collapsed result=ok/);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("watcher exits after the configured consecutive failure limit and cleans its PID", async () => {
  const directory = temporaryDirectory("gitm-fail-");
  const stateHome = join(directory, "state");
  const socketPath = join(directory, "missing.sock");
  const fakeController = writeFakeController(directory);
  const runtime = watcherDirectory(stateHome, socketPath);
  const logFile = join(runtime, "watcher.log");
  const pidFile = join(runtime, "watcher.pid");
  const child = spawn(process.execPath, [
    watcher,
    "--socket", socketPath,
    "--log", logFile,
    "--pid-file", pidFile,
    "--socket-file", join(runtime, "socket-path"),
    "--controller", fakeController.path,
  ], {
    env: watcherEnvironment(stateHome, socketPath, fakeController, {
      SIDEBAR_FAILURE_LIMIT: "3",
      SIDEBAR_POLL_INTERVAL: "0.005",
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    const result = await waitForExit(child);
    assert.equal(result.code, 0);
    assert.equal(existsSync(pidFile), false);
    const log = readFileSync(logFile, "utf8");
    assert.match(log, /consecutive_failures=3/);
    assert.match(log, /watcher=stop reason=herdr-unavailable/);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("controller starts one watcher per socket under concurrent starts", async () => {
  const directory = temporaryDirectory("gitm-singleton-");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const herdr = await startFakeHerdr(directory, [{ kind: "layout", x: 36, width: 82 }]);
  const env = watcherEnvironment(stateHome, herdr.socketPath, fakeController);
  const runtime = watcherDirectory(stateHome, herdr.socketPath);

  try {
    await Promise.all([
      runCommand("bash", [controller, "watch-start"], env),
      runCommand("bash", [controller, "watch-start"], env),
    ]);
    await waitFor(() => existsSync(join(runtime, "watcher.pid")), "singleton PID was not written");
    const firstPid = readFileSync(join(runtime, "watcher.pid"), "utf8").trim();
    await runCommand("bash", [controller, "watch-start"], env);
    assert.equal(readFileSync(join(runtime, "watcher.pid"), "utf8").trim(), firstPid);

    const socketAlias = join(directory, "herdr-alias.sock");
    symlinkSync(herdr.socketPath, socketAlias);
    const aliasEnv = watcherEnvironment(stateHome, socketAlias, fakeController);
    await runCommand("bash", [controller, "watch-start"], aliasEnv);
    assert.equal(readFileSync(join(runtime, "watcher.pid"), "utf8").trim(), firstPid);

    const alternateScripts = join(directory, "alternate checkout", "scripts");
    const alternateWatcher = join(alternateScripts, "sidebar-watcher.mjs");
    mkdirSync(alternateScripts, { recursive: true });
    symlinkSync(watcher, alternateWatcher);
    const alternateEnv = { ...env, GHOST_SIDEBAR_WATCHER_PATH: alternateWatcher };
    await runCommand("bash", [controller, "watch-start"], alternateEnv);
    assert.equal(readFileSync(join(runtime, "watcher.pid"), "utf8").trim(), firstPid);
    assert.equal(readdirSync(join(stateHome, "ghost-in-the-machine", "watchers")).length, 1);
    assert.equal(readFileSync(join(runtime, "watcher.log"), "utf8").match(/watcher=start/g)?.length, 1);

    await runCommand("bash", [controller, "watch-stop"], alternateEnv);
    await waitFor(() => !existsSync(join(runtime, "watcher.pid")), "watch-stop did not clean the PID");
  } finally {
    await runCommand("bash", [controller, "watch-stop"], env).catch(() => undefined);
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("distinct socket paths get distinct watchers", async () => {
  const directory = temporaryDirectory("gitm-multi-");
  const stateHome = join(directory, "state");
  const firstDirectory = join(directory, "first");
  const secondDirectory = join(directory, "second");
  mkdirSync(firstDirectory);
  mkdirSync(secondDirectory);
  const fakeController = writeFakeController(directory);
  const first = await startFakeHerdr(firstDirectory, [{ kind: "layout", x: 36, width: 82 }]);
  const second = await startFakeHerdr(secondDirectory, [{ kind: "layout", x: 4, width: 114 }]);
  const firstEnv = watcherEnvironment(stateHome, first.socketPath, fakeController);
  const secondEnv = watcherEnvironment(stateHome, second.socketPath, fakeController);

  try {
    await runCommand("bash", [controller, "watch-start"], firstEnv);
    const firstRuntime = watcherDirectory(stateHome, first.socketPath);
    const firstPid = Number(readFileSync(join(firstRuntime, "watcher.pid"), "utf8").trim());
    const secondRuntime = watcherDirectory(stateHome, second.socketPath);
    mkdirSync(secondRuntime, { recursive: true });
    writeFileSync(join(secondRuntime, "watcher.pid"), `${firstPid}\n`);
    await runCommand("bash", [controller, "watch-stop"], secondEnv);
    process.kill(firstPid, 0);

    await runCommand("bash", [controller, "watch-start"], secondEnv);
    const secondPid = Number(readFileSync(join(secondRuntime, "watcher.pid"), "utf8").trim());
    assert.notEqual(secondPid, firstPid);
    const directories = readdirSync(join(stateHome, "ghost-in-the-machine", "watchers"));
    assert.equal(directories.length, 2);
    assert.ok(existsSync(join(watcherDirectory(stateHome, first.socketPath), "watcher.pid")));
    assert.ok(existsSync(join(watcherDirectory(stateHome, second.socketPath), "watcher.pid")));
  } finally {
    await runCommand("bash", [controller, "watch-stop"], firstEnv).catch(() => undefined);
    await runCommand("bash", [controller, "watch-stop"], secondEnv).catch(() => undefined);
    await first.close();
    await second.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("stale PID and lock files recover without touching an unrelated process", async () => {
  const directory = temporaryDirectory("gitm stale space ");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const herdr = await startFakeHerdr(directory, [{ kind: "layout", x: 36, width: 82 }]);
  const env = watcherEnvironment(stateHome, herdr.socketPath, fakeController);
  const runtime = watcherDirectory(stateHome, herdr.socketPath);
  const lock = join(runtime, "start.lock");
  mkdirSync(lock, { recursive: true });
  writeFileSync(join(runtime, "watcher.pid"), `${process.pid}\n`);
  writeFileSync(join(lock, "owner.pid"), "999999\n");

  try {
    await runCommand("bash", [controller, "watch-start"], env);
    const watcherPid = Number(readFileSync(join(runtime, "watcher.pid"), "utf8").trim());
    assert.notEqual(watcherPid, process.pid);
    process.kill(process.pid, 0);
    assert.equal(existsSync(lock), false);

    await runCommand("bash", [controller, "watch-stop"], env);
    mkdirSync(lock);
    const future = new Date(Date.now() + 1000);
    utimesSync(lock, future, future);
    const recoveryStarted = Date.now();
    await runCommand("bash", [controller, "watch-start"], {
      ...env,
      GHOST_WATCH_LOCK_STALE_SECONDS: "1",
    });
    assert.ok(Date.now() - recoveryStarted >= 900, "empty lock bypassed its positive grace period");
    assert.ok(Number(readFileSync(join(runtime, "watcher.pid"), "utf8").trim()) > 0);
    assert.equal(existsSync(lock), false);
  } finally {
    await runCommand("bash", [controller, "watch-stop"], env).catch(() => undefined);
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("watch-stop terminates a watcher blocked in its transition controller", async () => {
  const directory = temporaryDirectory("gitm-blocked-");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const blockedController = join(directory, "blocked-controller.sh");
  const startedMarker = join(directory, "controller-started");
  writeFileSync(blockedController, `#!/usr/bin/env bash
trap '' TERM
printf '%s\\n' "$$" > "${startedMarker}"
exec sleep 30
`);
  chmodSync(blockedController, 0o755);
  const herdr = await startFakeHerdr(directory, [{ kind: "layout", x: 4, width: 114 }]);
  const env = watcherEnvironment(stateHome, herdr.socketPath, fakeController, {
    GHOST_CONTROLLER_PATH: blockedController,
    SIDEBAR_CONTROLLER_TIMEOUT_MS: "100",
    SIDEBAR_CONTROLLER_KILL_GRACE_MS: "50",
  });
  const runtime = watcherDirectory(stateHome, herdr.socketPath);

  try {
    await runCommand("bash", [controller, "watch-start"], env);
    await waitFor(() => existsSync(startedMarker), "transition controller did not start");
    const controllerPid = Number(readFileSync(startedMarker, "utf8").trim());
    const watcherPid = Number(readFileSync(join(runtime, "watcher.pid"), "utf8").trim());
    await runCommand("bash", [controller, "watch-stop"], env);
    assert.equal(existsSync(join(runtime, "watcher.pid")), false);
    assert.throws(() => process.kill(watcherPid, 0));
    assert.throws(() => process.kill(controllerPid, 0));

    rmSync(startedMarker, { force: true });
    await runCommand("bash", [controller, "watch-start"], env);
    const restartedPid = readFileSync(join(runtime, "watcher.pid"), "utf8").trim();
    await runCommand("bash", [controller, "watch-start"], env);
    assert.equal(readFileSync(join(runtime, "watcher.pid"), "utf8").trim(), restartedPid);
  } finally {
    await runCommand("bash", [controller, "watch-stop"], env).catch(() => undefined);
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("compatibility wrapper accepts the legacy positional log path", async () => {
  const directory = temporaryDirectory("gitm-wrapper-");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const herdr = await startFakeHerdr(directory, [{ kind: "layout", x: 36, width: 82 }]);
  const logFile = join(directory, "legacy.log");
  const child = spawn("bash", [join(root, "scripts/watch-sidebar.sh"), logFile], {
    env: watcherEnvironment(stateHome, herdr.socketPath, fakeController),
    stdio: ["ignore", "ignore", "pipe"],
  });

  try {
    await waitFor(() => existsSync(logFile) && readFileSync(logFile, "utf8").includes("watcher=start"), "wrapper did not start the Node watcher");
    child.kill("SIGTERM");
    await waitForExit(child);
    assert.match(readFileSync(logFile, "utf8"), /watcher=stop reason=signal/);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    await herdr.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("direct Pi sessions and Herdr client sockets do not start watchers", async () => {
  const directory = temporaryDirectory("gitm-direct-");
  const stateHome = join(directory, "state");
  const fakeController = writeFakeController(directory);
  const socketPath = join(directory, "herdr.sock");
  const directEnv = watcherEnvironment(stateHome, socketPath, fakeController, { HERDR_ENV: "0" });

  try {
    await runCommand("bash", [controller, "watch-start"], directEnv);
    assert.equal(existsSync(join(stateHome, "ghost-in-the-machine", "watchers")), true);
    assert.equal(readdirSync(join(stateHome, "ghost-in-the-machine", "watchers")).length, 0);

    const clientEnv = watcherEnvironment(stateHome, join(directory, "herdr-client.sock"), fakeController);
    await assert.rejects(runCommand("bash", [controller, "watch-start"], clientEnv), /herdr-client\.sock is not an API socket/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
