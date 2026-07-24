import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import {
  discoverAndLoadExtensions,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import cursorUsage from "./fixtures/cursor-usage.json" with { type: "json" };

describe("official Pi extension loader", () => {
  it("loads Token Tank and retains Cursor auth across loader evaluations", async () => {
    const projectDir = resolve(process.cwd());
    const agentDir = await mkdtemp(join(tmpdir(), "pi-token-tank-loader-"));
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "loader-user%3A%3Aheader.payload.signature";
    globalThis.fetch = async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 });
    try {
      const first = await discoverAndLoadExtensions([projectDir], projectDir, agentDir);
      assert.deepEqual(first.errors, []);
      assert.equal(first.extensions.length, 1);
      assert.equal(process.env.CURSOR_SESSION_TOKEN, undefined);

      const second = await discoverAndLoadExtensions([projectDir], projectDir, agentDir);
      assert.deepEqual(second.errors, []);
      assert.equal(second.extensions.length, 1);
      const extension = second.extensions[0]!;
      assert.equal(extension.resolvedPath, resolve(projectDir, "src/index.ts"));
      assert.ok(extension.commands.has("token-tank"));
      assert.ok(extension.handlers.has("session_start"));
      assert.ok(extension.handlers.has("model_select"));
      assert.ok(extension.handlers.has("session_shutdown"));

      const statuses: Record<string, string | undefined> = {};
      const ctx = {
        mode: "tui",
        model: { provider: "cursor", id: "composer" },
        modelRegistry: { getRegisteredProviderIds: () => ["cursor"] },
        ui: {
          setStatus: (key: string, value: string | undefined) => { statuses[key] = value; },
          setWidget: () => {},
          theme: { fg: (_color: string, text: string) => text },
        },
      } as unknown as ExtensionContext;
      const sessionStart = extension.handlers.get("session_start")?.[0] as unknown as
        ((event: unknown, context: ExtensionContext) => Promise<void>) | undefined;
      assert.ok(sessionStart);
      await sessionStart({ type: "session_start", reason: "startup" }, ctx);
      assert.ok(statuses["pi-token-tank"]?.includes("19.4%"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
