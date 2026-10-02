import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { COOLDOWN_BASE_MS, COOLDOWN_MAX_MS, createCoordinator } from "../src/index.js";
import { createFileQuotaStore, type QuotaStore } from "../src/quota-store.js";
import type { CredentialSourceLike } from "../src/auth.js";
import type { ProviderQuota, QuotaProvider } from "../src/types.js";

const credentials: CredentialSourceLike = {
  getApiKey: async () => "token",
  readCredential: () => undefined,
  refreshOAuthToken: async () => null,
};

function live(percent: number, fetchedAt = Date.now()): ProviderQuota {
  return {
    provider: "claude-code", state: "live", fetchedAt,
    windows: [{ id: "weekly", shortLabel: "7d", longLabel: "Weekly", resetStyle: "weekday-time", usedPercent: percent }],
  };
}

const rateLimited: ProviderQuota = {
  provider: "claude-code", state: "error", windows: [], error: "Claude Code quota request failed (429)",
};

function provider(fetch: QuotaProvider["fetch"]): QuotaProvider {
  return {
    id: "claude-code", label: "Claude Code", matchesModel: () => true, fetch,
    credentialsHint: "", footerWindows: { minimal: ["weekly"], full: ["weekly"] },
  };
}

let dir: string;
let store: QuotaStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "token-tank-store-"));
  store = createFileQuotaStore(() => dir);
});
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("shared quota store", () => {
  it("lets a second session reuse the first session's fresh result without fetching", async () => {
    let calls = 0;
    const fetch = async () => { calls++; return live(40); };
    await createCoordinator(credentials, [provider(fetch)], {}, store).refresh("claude-code", false);
    const second = await createCoordinator(credentials, [provider(fetch)], {}, store).refresh("claude-code", false);
    assert.equal(calls, 1);
    assert.equal(second.state, "live");
    assert.equal(second.windows[0]?.usedPercent, 40);
  });

  it("refetches once the shared result is older than five minutes", async () => {
    await store.write("claude-code", { quota: live(10, Date.now() - 6 * 60_000) });
    let calls = 0;
    const result = await createCoordinator(credentials, [provider(async () => { calls++; return live(20); })], {}, store)
      .refresh("claude-code", false);
    assert.equal(calls, 1);
    assert.equal(result.windows[0]?.usedPercent, 20);
  });

  it("stores no credentials, only quota numbers", async () => {
    await createCoordinator(credentials, [provider(async () => live(40))], {}, store).refresh("claude-code", true);
    const raw = await readFile(join(dir, "claude-code.json"), "utf8");
    assert.ok(!raw.includes("token"));
    assert.match(raw, /"usedPercent":40/);
  });
});

describe("429 cooldown", () => {
  it("shows last-good data as stale and stops every session from retrying during the cooldown", async () => {
    await store.write("claude-code", { quota: live(30, Date.now() - 6 * 60_000) });
    let calls = 0;
    const fetch = async () => { calls++; return rateLimited; };

    const first = await createCoordinator(credentials, [provider(fetch)], {}, store).refresh("claude-code", false);
    assert.equal(calls, 1);
    assert.equal(first.state, "stale");
    assert.equal(first.windows[0]?.usedPercent, 30);

    // A forced refresh from another session still respects the shared cooldown.
    const other = await createCoordinator(credentials, [provider(fetch)], {}, store).refresh("claude-code", true);
    assert.equal(calls, 1);
    assert.equal(other.windows[0]?.usedPercent, 30);

    const stored = await store.read("claude-code");
    assert.equal(stored.backoffMs, COOLDOWN_BASE_MS);
    assert.ok((stored.cooldownUntil ?? 0) > Date.now() + COOLDOWN_BASE_MS - 5_000);
  });

  it("doubles the cooldown on consecutive 429s up to the cap", async () => {
    const coordinator = () => createCoordinator(credentials, [provider(async () => rateLimited)], {}, store);
    const expected = [COOLDOWN_BASE_MS, COOLDOWN_BASE_MS * 2, COOLDOWN_BASE_MS * 4, COOLDOWN_MAX_MS, COOLDOWN_MAX_MS];
    for (const backoffMs of expected) {
      await coordinator().refresh("claude-code", true);
      const stored = await store.read("claude-code");
      assert.equal(stored.backoffMs, backoffMs);
      // Expire the cooldown so the next refresh is allowed to try again.
      await store.write("claude-code", { ...stored, cooldownUntil: Date.now() - 1 });
    }
  });

  it("clears the backoff after a successful fetch", async () => {
    await store.write("claude-code", { cooldownUntil: Date.now() - 1, backoffMs: COOLDOWN_MAX_MS });
    await createCoordinator(credentials, [provider(async () => live(5))], {}, store).refresh("claude-code", false);
    const stored = await store.read("claude-code");
    assert.equal(stored.backoffMs, undefined);
    assert.equal(stored.cooldownUntil, undefined);
  });

  it("does not start a cooldown for errors other than 429", async () => {
    const failure = { ...rateLimited, error: "Claude Code quota request failed (500)" };
    await createCoordinator(credentials, [provider(async () => failure)], {}, store).refresh("claude-code", true);
    assert.equal((await store.read("claude-code")).cooldownUntil, undefined);
  });
});

describe("fetch claim", () => {
  it("lets only one session fetch at a time", async () => {
    const release = await store.claim("claude-code");
    assert.ok(release);
    assert.equal(await store.claim("claude-code"), undefined);
    await release();
    assert.ok(await store.claim("claude-code"));
  });

  it("skips the fetch while another session holds the claim", async () => {
    const release = await store.claim("claude-code");
    let calls = 0;
    await createCoordinator(credentials, [provider(async () => { calls++; return live(1); })], {}, store)
      .refresh("claude-code", true);
    assert.equal(calls, 0);
    await release?.();
  });

  it("recovers a claim left behind by a crashed session", async () => {
    const lock = join(dir, "claude-code.lock");
    await writeFile(lock, "");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    assert.ok(await store.claim("claude-code"));
  });
});
