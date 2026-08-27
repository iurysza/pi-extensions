import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";

const originalHome = process.env.HOME;
const home = await mkdtemp(join(tmpdir(), "session-store-test-"));
process.env.HOME = home;

const { default: sessionStore } = await import("../../extensions/session-store/index.ts");

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
  assert.match(statusChanges[0][1], /^🔍 Indexed 1 sessions/);

  await handlers.get("session_shutdown")({}, ctx);
  assert.deepEqual(statusChanges.at(-1), ["session-store", undefined]);
  const changesAfterShutdown = statusChanges.length;
  active = false;

  assert.doesNotThrow(() => mock.timers.runAll());
  assert.equal(statusChanges.length, changesAfterShutdown);
});
