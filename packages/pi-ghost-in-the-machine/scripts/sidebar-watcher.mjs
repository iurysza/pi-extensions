#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_RESPONSE_BYTES = 1024 * 1024;

function numericOption(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

export function canonicalSocketPath(input) {
  const absolute = isAbsolute(input) ? input : resolve(input);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

export function socketKey(socketPath) {
  return createHash("sha256").update(socketPath).digest("hex");
}

export function watcherRuntime(socketPath, env = process.env) {
  const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  const directory = join(stateHome, "ghost-in-the-machine", "watchers", socketKey(socketPath));
  return {
    directory,
    logFile: join(directory, "watcher.log"),
    pidFile: join(directory, "watcher.pid"),
    socketFile: join(directory, "socket-path"),
  };
}

function resolveSocketPath(env = process.env) {
  const configHome = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const socketPath = canonicalSocketPath(env.HERDR_SOCKET_PATH || join(configHome, "herdr", "herdr.sock"));
  if (socketPath.endsWith("/herdr-client.sock")) {
    throw new Error("herdr-client.sock is not an API socket");
  }
  return socketPath;
}

function parseArgs(argv, env = process.env) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${argument}`);
    options[argument.slice(2)] = value;
    index += 1;
  }

  const socketPath = canonicalSocketPath(options.socket || resolveSocketPath(env));
  if (socketPath.endsWith("/herdr-client.sock")) {
    throw new Error("herdr-client.sock is not an API socket");
  }
  const runtime = watcherRuntime(socketPath, env);
  return {
    socketPath,
    logFile: options.log || runtime.logFile,
    pidFile: options["pid-file"] || runtime.pidFile,
    socketFile: options["socket-file"] || runtime.socketFile,
    controller: options.controller || env.GHOST_CONTROLLER_PATH || join(ROOT, "scripts", "ghost-state.sh"),
    intervalMs: numericOption(env.SIDEBAR_POLL_INTERVAL, 0.05, 0.001) * 1000,
    timeoutMs: numericOption(env.SIDEBAR_REQUEST_TIMEOUT_MS, 1000),
    controllerTimeoutMs: numericOption(env.SIDEBAR_CONTROLLER_TIMEOUT_MS, 5000),
    controllerKillGraceMs: numericOption(env.SIDEBAR_CONTROLLER_KILL_GRACE_MS, 500),
    failureLimit: numericOption(env.SIDEBAR_FAILURE_LIMIT, 100),
  };
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function removeOwnedPid(pidFile) {
  try {
    if (readFileSync(pidFile, "utf8").trim() === String(process.pid)) rmSync(pidFile, { force: true });
  } catch {
    // The controller may have already removed it.
  }
}

function requestLayout(socketPath, requestId, timeoutMs, onSocket) {
  return new Promise((resolveRequest, rejectRequest) => {
    const socket = net.createConnection({ path: socketPath });
    onSocket(socket);
    let response = "";
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      onSocket(undefined);
      socket.destroy();
      if (error) rejectRequest(error);
      else resolveRequest(value);
    };

    socket.setTimeout(timeoutMs, () => finish(new Error(`request timed out after ${timeoutMs}ms`)));
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ id: requestId, method: "pane.layout", params: {} })}\n`);
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > MAX_RESPONSE_BYTES) {
        finish(new Error("response exceeded size limit"));
        return;
      }
      const newline = response.indexOf("\n");
      if (newline === -1) return;
      try {
        const parsed = JSON.parse(response.slice(0, newline));
        if (parsed.id !== requestId) throw new Error(`response id mismatch: ${parsed.id}`);
        if (parsed.error) throw new Error(`Herdr API error: ${JSON.stringify(parsed.error)}`);
        const x = parsed?.result?.layout?.area?.x;
        const width = parsed?.result?.layout?.area?.width;
        const focusedPaneId = parsed?.result?.layout?.focused_pane_id;
        if (!Number.isFinite(x)) throw new Error("response missing result.layout.area.x");
        finish(undefined, {
          x,
          width: Number.isFinite(width) ? width : undefined,
          focusedPaneId: typeof focusedPaneId === "string" ? focusedPaneId : undefined,
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (!settled) finish(new Error("connection closed before a complete response"));
    });
  });
}

function runController(controller, state, focusedPaneId, socketPath, timeoutMs, killGraceMs, onChild) {
  return new Promise((resolveAction) => {
    const args = [controller, "sidebar", state];
    if (state === "expanded" && focusedPaneId) args.push(focusedPaneId);
    const child = spawn("bash", args, {
      env: { ...process.env, HERDR_SOCKET_PATH: socketPath },
      stdio: ["ignore", "ignore", "pipe"],
    });
    onChild(child);
    let stderr = "";
    let killTimer;
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      onChild(undefined);
      resolveAction({ ok: false, detail: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      onChild(undefined);
      const detail = stderr.trim() || (signal ? `signal=${signal}` : `code=${code}`);
      resolveAction({ ok: code === 0, detail });
    });
  });
}

function formatError(error) {
  return (error instanceof Error ? error.message : String(error)).replaceAll("\n", " ");
}

async function run(options) {
  mkdirSync(dirname(options.logFile), { recursive: true });
  const log = (message) => {
    appendFileSync(options.logFile, `${new Date().toISOString()} ${message}\n`);
  };

  atomicWrite(options.socketFile, `${options.socketPath}\n`);
  atomicWrite(options.pidFile, `${process.pid}\n`);

  let stopping = false;
  let activeSocket;
  let activeControllerChild;
  let wakeTimer;
  let wakeSleep;
  let polls = 0;
  let successfulPolls = 0;
  let consecutiveFailures = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  let observedState;
  let appliedState;
  let nextActionAt = 0;
  let requestNumber = 0;
  let metricsStartedAt = performance.now();
  const actionRetryMs = numericOption(process.env.SIDEBAR_ACTION_RETRY_MS, 1000);

  const stop = () => {
    stopping = true;
    activeSocket?.destroy(new Error("watcher stopping"));
    activeControllerChild?.kill("SIGTERM");
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeSleep?.();
  };
  const resetMetrics = () => {
    polls = 0;
    successfulPolls = 0;
    totalLatencyMs = 0;
    maxLatencyMs = 0;
    metricsStartedAt = performance.now();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.on("SIGUSR1", resetMetrics);

  const sleep = (milliseconds) => new Promise((resolveSleep) => {
    if (stopping || milliseconds <= 0) {
      resolveSleep();
      return;
    }
    wakeSleep = resolveSleep;
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      wakeSleep = undefined;
      resolveSleep();
    }, milliseconds);
  });

  log(`watcher=start pid=${process.pid} socket=${JSON.stringify(options.socketPath)} controller=${JSON.stringify(options.controller)} interval_ms=${options.intervalMs} timeout_ms=${options.timeoutMs}`);

  let stopReason = "signal";
  try {
    while (!stopping) {
      const pollStarted = performance.now();
      requestNumber += 1;
      polls += 1;
      try {
        const layout = await requestLayout(
          options.socketPath,
          `ghost-sidebar:${process.pid}:${requestNumber}`,
          options.timeoutMs,
          (socket) => { activeSocket = socket; },
        );
        const latencyMs = performance.now() - pollStarted;
        successfulPolls += 1;
        consecutiveFailures = 0;
        totalLatencyMs += latencyMs;
        maxLatencyMs = Math.max(maxLatencyMs, latencyMs);
        const state = layout.x <= 4 ? "collapsed" : "expanded";
        if (state !== observedState) {
          observedState = state;
          nextActionAt = 0;
          log(`state=${state} area_x=${layout.x} area_width=${layout.width ?? "unknown"} focused_pane_id=${JSON.stringify(layout.focusedPaneId ?? "unknown")} latency_ms=${latencyMs.toFixed(3)} socket=${JSON.stringify(options.socketPath)}`);
        }
        if (state !== appliedState && Date.now() >= nextActionAt) {
          const action = await runController(
            options.controller,
            state,
            layout.focusedPaneId,
            options.socketPath,
            options.controllerTimeoutMs,
            options.controllerKillGraceMs,
            (child) => { activeControllerChild = child; },
          );
          log(`action=ghost-${state} result=${action.ok ? "ok" : "error"} detail=${JSON.stringify(action.detail)}`);
          if (action.ok) appliedState = state;
          else nextActionAt = Date.now() + actionRetryMs;
        }
      } catch (error) {
        if (stopping) break;
        consecutiveFailures += 1;
        const latencyMs = performance.now() - pollStarted;
        log(`error=${JSON.stringify(formatError(error))} consecutive_failures=${consecutiveFailures} latency_ms=${latencyMs.toFixed(3)} socket=${JSON.stringify(options.socketPath)}`);
        if (consecutiveFailures >= options.failureLimit) {
          stopReason = "herdr-unavailable";
          break;
        }
      }

      const elapsedMs = performance.now() - pollStarted;
      await sleep(Math.max(0, options.intervalMs - elapsedMs));
    }
  } finally {
    activeSocket?.destroy();
    removeOwnedPid(options.pidFile);
    const averageLatencyMs = successfulPolls === 0 ? 0 : totalLatencyMs / successfulPolls;
    const elapsedSeconds = (performance.now() - metricsStartedAt) / 1000;
    const pollsPerSecond = elapsedSeconds === 0 ? 0 : polls / elapsedSeconds;
    log(`watcher=stop reason=${stopReason} polls=${polls} successful_polls=${successfulPolls} avg_latency_ms=${averageLatencyMs.toFixed(3)} max_latency_ms=${maxLatencyMs.toFixed(3)} polls_per_second=${pollsPerSecond.toFixed(3)}`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  await run(options);
} catch (error) {
  console.error(`sidebar watcher: ${formatError(error)}`);
  process.exitCode = 1;
}
