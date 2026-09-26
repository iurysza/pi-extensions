import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchClaudeCodeQuota, parseClaudeCodeUsage, readClaudeCodeToken } from "../src/claude-code.js";

const body = {
  five_hour: { utilization: 24.5, resets_at: "2026-09-26T15:00:00Z" },
  seven_day: { utilization: 92, resets_at: "2026-09-30T12:00:00Z" },
  seven_day_opus: { utilization: 10 },
};

describe("Claude Code quota", () => {
  it("normalizes five-hour and weekly windows without inventing optional limits", () => {
    const windows = parseClaudeCodeUsage(body);
    assert.deepEqual(windows.map(({ id, usedPercent }) => [id, usedPercent]), [
      ["five-hour", 24.5], ["weekly", 92],
    ]);
    assert.equal(windows[0]?.resetsAt, Date.parse(body.five_hour.resets_at));
    assert.deepEqual(parseClaudeCodeUsage({ five_hour: { utilization: 120 } }).map((w) => w.usedPercent), [100]);
    assert.throws(() => parseClaudeCodeUsage({ seven_day: { utilization: "30" } }), /windows unavailable/);
  });

  it("reads only a valid unexpired CLI token from a custom config directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "claude-quota-"));
    const prior = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      const credentialPath = join(dir, ".credentials.json");
      await writeFile(credentialPath, JSON.stringify({ claudeAiOauth: { accessToken: "test-only-token", expiresAt: Date.now() + 60_000 } }));
      assert.equal(await readClaudeCodeToken(), "test-only-token");
      await writeFile(credentialPath, JSON.stringify({ claudeAiOauth: { accessToken: "expired", expiresAt: Date.now() - 1 } }));
      assert.equal(await readClaudeCodeToken(), undefined);
      await writeFile(credentialPath, "not-json");
      assert.equal(await readClaudeCodeToken(), undefined);
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = prior;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fetches read-only usage and never exposes the token in results", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
      assert.equal(init?.method, "GET");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret-test-token");
      assert.equal(new Headers(init?.headers).get("anthropic-beta"), "oauth-2025-04-20");
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const result = await fetchClaudeCodeQuota(undefined, async () => "secret-test-token");
      assert.equal(result.state, "live");
      assert.equal(result.windows.length, 2);
      assert.ok(!JSON.stringify(result).includes("secret-test-token"));
    } finally { globalThis.fetch = original; }
  });

  it("distinguishes missing login from rejected requests without leaking response bodies", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("secret-test-token", { status: 401 });
    try {
      assert.equal((await fetchClaudeCodeQuota(undefined, async () => undefined)).state, "missing");
      const result = await fetchClaudeCodeQuota(undefined, async () => "secret-test-token");
      assert.equal(result.state, "error");
      assert.equal(result.error, "Claude Code quota request failed (401)");
      assert.ok(!JSON.stringify(result).includes("secret-test-token"));
    } finally { globalThis.fetch = original; }
  });
});
