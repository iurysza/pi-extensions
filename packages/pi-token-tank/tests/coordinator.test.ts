import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCoordinator } from "../src/index.js";
import type { CredentialSourceLike } from "../src/auth.js";
import type { ProviderId, ProviderQuota, QuotaProvider } from "../src/types.js";

function mockCredentials(): CredentialSourceLike {
  return {
    getApiKey: async () => "token",
    readCredential: () => undefined,
    refreshOAuthToken: async () => null,
  };
}

function live(provider: ProviderId, percent: number): ProviderQuota {
  return {
    provider, state: "live", fetchedAt: Date.now(),
    windows: [
      { id: "five-hour", shortLabel: "5h", longLabel: "5h", resetStyle: "time", usedPercent: percent },
      { id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time", usedPercent: percent },
    ],
  };
}

function adapter(id: string, fetch: QuotaProvider["fetch"]): QuotaProvider {
  return {
    id, label: id, matchesModel: (model) => model?.provider === id, fetch,
    credentialsHint: `Configure ${id}.`,
    footerWindows: { minimal: ["five-hour"], full: ["five-hour", "weekly"] },
  };
}

function registry(codexFetch: QuotaProvider["fetch"], kimiFetch: QuotaProvider["fetch"]): QuotaProvider[] {
  return [adapter("codex", codexFetch), adapter("kimi", kimiFetch)];
}

describe("createCoordinator", () => {
  it("fetches every registered provider", async () => {
    const c = createCoordinator(mockCredentials(), registry(
      async () => live("codex", 10), async () => live("kimi", 20),
    ));
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex?.windows[0]?.usedPercent, 10);
    assert.equal(snapshot.kimi?.state, "live");
  });

  it("supports adding a provider without coordinator changes", async () => {
    const c = createCoordinator(mockCredentials(), [adapter("future", async () => live("future", 30))]);
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.future?.windows[0]?.usedPercent, 30);
  });

  it("deduplicates concurrent refreshes", async () => {
    let calls = 0;
    const c = createCoordinator(mockCredentials(), [adapter("codex", async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return live("codex", 10);
    })]);
    const [a, b] = await Promise.all([c.refresh("codex", true), c.refresh("codex", true)]);
    assert.equal(calls, 1);
    assert.equal(a.state, "live");
    assert.equal(b.state, "live");
  });

  it("uses fresh cache", async () => {
    let calls = 0;
    const c = createCoordinator(mockCredentials(), [adapter("codex", async () => {
      calls++;
      return live("codex", 10);
    })]);
    await c.refreshAll(true);
    await c.refreshAll(false);
    assert.equal(calls, 1);
  });

  it("keeps last-good data as stale", async () => {
    let succeed = true;
    const c = createCoordinator(mockCredentials(), [adapter("codex", async () => succeed
      ? live("codex", 10)
      : { provider: "codex", state: "error", windows: [], error: "network down" })]);
    await c.refreshAll(true);
    succeed = false;
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex?.state, "stale");
    assert.equal(snapshot.codex?.error, "network down");
  });

  it("isolates provider failures", async () => {
    const c = createCoordinator(mockCredentials(), registry(
      async () => { throw new Error("secret-bearing failure"); },
      async () => live("kimi", 20),
    ));
    const snapshot = await c.refreshAll(true);
    assert.equal(snapshot.codex?.error, "Unexpected quota refresh failure.");
    assert.equal(snapshot.kimi?.state, "live");
  });

  it("clears dynamic caches", async () => {
    const c = createCoordinator(mockCredentials(), [adapter("future", async () => live("future", 30))]);
    await c.refreshAll(true);
    c.clear();
    assert.equal(c.getSnapshot().future?.state, "missing");
  });
});
