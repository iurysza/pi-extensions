import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

const originalHome = process.env.HOME;
const home = await mkdtemp(join(tmpdir(), "session-store-test-"));
process.env.HOME = home;

const { default: sessionStore, CATCH_UP_DELAY_MS } = await import("../../extensions/session-store/index.ts");

/** Fire the deferred catch-up scan and let its async callback settle. */
async function runDeferredScan() {
  mock.timers.tick(CATCH_UP_DELAY_MS);
  await new Promise((resolve) => setImmediate(resolve));
}

test.after(async () => {
  mock.timers.reset();
  process.env.HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

test("cancels delayed status cleanup before the session context becomes stale", async () => {
  const sessionDir = join(home, ".pi", "agent", "sessions", "project");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl"),
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id: "test-session",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/project",
      }),
      JSON.stringify({
        type: "message",
        id: "message-1",
        parentId: null,
        timestamp: "2026-01-01T00:00:01.000Z",
        message: { role: "user", content: "test", timestamp: 1 },
      }),
      "",
    ].join("\n"),
  );

  mock.timers.enable({ apis: ["setTimeout"] });

  const handlers = new Map();
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand() {},
    registerTool() {},
  };
  const statusChanges = [];
  let active = true;
  const ctx = {
    hasUI: true,
    get ui() {
      if (!active) throw new Error("stale context accessed");
      return {
        setStatus: (id, value) => statusChanges.push([id, value]),
      };
    },
  };

  sessionStore(pi);
  await handlers.get("session_start")({}, ctx);
  // The scan must not block session_start: nothing is indexed until the timer fires.
  assert.equal(statusChanges.length, 0);
  await runDeferredScan();
  assert.match(statusChanges[0][1], /^🔍 Indexed 1 sessions/);

  await handlers.get("session_shutdown")({}, ctx);
  assert.deepEqual(statusChanges.at(-1), ["session-store", undefined]);
  const changesAfterShutdown = statusChanges.length;
  active = false;

  assert.doesNotThrow(() => mock.timers.runAll());
  assert.equal(statusChanges.length, changesAfterShutdown);
});

test("headless runs skip the catch-up scan", async () => {
  const handlers = new Map();
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand() {},
    registerTool() {},
  };
  const sessionDir = join(home, ".pi", "agent", "sessions", "headless");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "headless", timestamp: "2026-01-02T00:00:00.000Z", cwd: "/headless" })}\n`,
  );
  const ctx = {
    hasUI: false,
    get ui() {
      throw new Error("headless context has no UI");
    },
  };

  sessionStore(pi);
  await handlers.get("session_start")({}, ctx);
  await runDeferredScan();

  // The interactive start indexes the headless session, so the headless start did not.
  const statuses = [];
  const uiCtx = { hasUI: true, ui: { setStatus: (_id, value) => statuses.push(value) } };
  await handlers.get("session_start")({}, uiCtx);
  await runDeferredScan();
  assert.match(statuses[0], /^🔍 Indexed 1 sessions/);
  await handlers.get("session_shutdown")({}, uiCtx);
});

test("shutdown before the deferred scan cancels it", async () => {
  const handlers = new Map();
  const pi = {
    on: (event, handler) => handlers.set(event, handler),
    registerCommand() {},
    registerTool() {},
  };
  const sessionDir = join(home, ".pi", "agent", "sessions", "quick-quit");
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "quick-quit", timestamp: "2026-01-03T00:00:00.000Z", cwd: "/quick-quit" })}\n`,
  );
  const statuses = [];
  const ctx = { hasUI: true, ui: { setStatus: (_id, value) => statuses.push(value) } };

  sessionStore(pi);
  await handlers.get("session_start")({}, ctx);
  await handlers.get("session_shutdown")({}, ctx);
  await runDeferredScan();
  // Only the shutdown clear happened: the scan never ran against the closed DB.
  assert.deepEqual(statuses, [undefined]);

  // The next start still indexes the session.
  await handlers.get("session_start")({}, ctx);
  await runDeferredScan();
  assert.match(statuses.at(-1), /^🔍 Indexed 1 sessions/);
  await handlers.get("session_shutdown")({}, ctx);
});
