import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CredentialSourceLike } from "../src/auth.js";
import { fetchCopilotQuota } from "../src/copilot.js";
import copilotFreeUsage from "./fixtures/copilot-free-usage.json" with { type: "json" };
import copilotUsage from "./fixtures/copilot-usage.json" with { type: "json" };

const OAUTH_TOKEN = "github-oauth-secret";

function mockCredentials(credential: unknown = {
  type: "oauth",
  access: "copilot-session-token",
  refresh: OAUTH_TOKEN,
  expires: Date.now() + 60_000,
}): CredentialSourceLike {
  return {
    getApiKey: async () => undefined,
    readCredential: () => credential,
    refreshOAuthToken: async () => null,
  };
}

function mockFetch(response: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => response(url as string, init as RequestInit)) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe("fetchCopilotQuota", () => {
  it("fetches and parses the monthly premium-interactions quota", async () => {
    const restore = mockFetch((url, init) => {
      assert.equal(url, "https://api.github.com/copilot_internal/user");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${OAUTH_TOKEN}`);
      assert.equal(headers.Accept, "application/json");
      assert.equal(headers["Copilot-Integration-Id"], "vscode-chat");
      return response(copilotUsage);
    });
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.provider, "copilot");
      assert.equal(quota.state, "live");
      assert.equal(quota.plan, "individual_pro");
      assert.equal(quota.windows.length, 1);
      assert.deepEqual(quota.windows[0], {
        id: "monthly",
        shortLabel: "30d",
        longLabel: "Monthly",
        resetStyle: "weekday-time",
        usedPercent: 25,
        used: 75,
        limit: 300,
        resetsAt: Date.parse("2026-08-01"),
      });
    } finally {
      restore();
    }
  });

  it("prefers quota_remaining and server percentage without float artifacts", async () => {
    const body = {
      quota_reset_date: "2026-08-01",
      quota_reset_date_utc: "2026-08-01T12:30:00Z",
      quota_snapshots: {
        premium_interactions: {
          entitlement: 100,
          remaining: 50,
          quota_remaining: 12.25,
          percent_remaining: 33.34,
        },
      },
    };
    const restore = mockFetch(() => response(body));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.windows[0]?.usedPercent, 66.7);
      assert.equal(quota.windows[0]?.used, 87.75);
      assert.equal(quota.windows[0]?.limit, 100);
      assert.equal(quota.windows[0]?.resetsAt, Date.parse("2026-08-01T12:30:00Z"));
    } finally {
      restore();
    }
  });

  it("parses paired Free limits and remaining values without snapshots", async () => {
    const restore = mockFetch(() => response(copilotFreeUsage));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.plan, "free");
      assert.deepEqual(quota.windows[0], {
        id: "monthly",
        shortLabel: "30d",
        longLabel: "Monthly",
        resetStyle: "weekday-time",
        usedPercent: 76,
        used: 38,
        limit: 50,
        resetsAt: Date.parse("2026-09-01T00:00:00Z"),
      });
    } finally {
      restore();
    }
  });

  it("uses percent_remaining when exact counts are unavailable", async () => {
    const restore = mockFetch(() => response({
      quota_snapshots: { premium_interactions: { percent_remaining: "37.5" } },
    }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.windows[0]?.usedPercent, 62.5);
      assert.equal(quota.windows[0]?.used, undefined);
      assert.equal(quota.windows[0]?.limit, undefined);
    } finally {
      restore();
    }
  });

  it("clamps exact and percentage-derived quota pressure", async () => {
    const bodies = [
      { quota_snapshots: { premium_interactions: { entitlement: 100, remaining: 150 } } },
      { quota_snapshots: { premium_interactions: { entitlement: 100, remaining: -20 } } },
      { quota_snapshots: { premium_interactions: { percent_remaining: -10 } } },
      { quota_snapshots: { premium_interactions: { percent_remaining: 120 } } },
    ];
    const expected = [0, 100, 100, 0];
    let call = 0;
    const restore = mockFetch(() => response(bodies[call++]));
    try {
      for (const usedPercent of expected) {
        const quota = await fetchCopilotQuota(mockCredentials());
        assert.equal(quota.windows[0]?.usedPercent, usedPercent);
      }
    } finally {
      restore();
    }
  });

  it("falls back to a finite free-plan chat quota", async () => {
    const restore = mockFetch(() => response({
      copilot_plan: "free",
      quota_reset_date: "2026-08-01",
      quota_snapshots: {
        chat: { entitlement: 50, remaining: 10 },
        completions: { unlimited: true },
      },
    }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.state, "live");
      assert.equal(quota.windows[0]?.usedPercent, 80);
      assert.equal(quota.windows[0]?.used, 40);
      assert.equal(quota.windows[0]?.limit, 50);
    } finally {
      restore();
    }
  });

  it("skips invalid snapshots and retains finite chat/completions fallback", async () => {
    const invalidSnapshots = [
      { unlimited: true, percent_remaining: 12 },
      { has_quota: false, percent_remaining: 12 },
      { entitlement: -1, percent_remaining: 12 },
      { entitlement: 0, percent_remaining: 12 },
      { entitlement: "managed", percent_remaining: 12 },
      { entitlement: Number.POSITIVE_INFINITY, percent_remaining: 12 },
      { entitlement: 100, remaining: "managed", percent_remaining: 12 },
    ];
    let call = 0;
    const restore = mockFetch(() => response({
      quota_snapshots: {
        premium_interactions: invalidSnapshots[call++],
        chat: { entitlement: 50, remaining: 10 },
      },
    }));
    try {
      for (const _ of invalidSnapshots) {
        const quota = await fetchCopilotQuota(mockCredentials());
        assert.equal(quota.windows[0]?.usedPercent, 80);
      }
    } finally {
      restore();
    }
  });

  it("allows percent-only fallback only when entitlement is absent", async () => {
    const restore = mockFetch(() => response({
      quota_snapshots: {
        premium_interactions: { entitlement: "managed", percent_remaining: 25 },
        chat: { percent_remaining: 37.5 },
      },
    }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.windows[0]?.usedPercent, 62.5);
    } finally {
      restore();
    }
  });

  it("prefers snapshot reset seconds over top-level date variants", async () => {
    const resetSeconds = 1_788_134_400;
    const restore = mockFetch(() => response({
      quota_reset_date: "2026-08-01",
      quota_reset_date_utc: "2026-08-02T00:00:00Z",
      quota_snapshots: {
        premium_interactions: { entitlement: 100, remaining: 50, quota_reset_at: resetSeconds },
      },
    }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.windows[0]?.resetsAt, resetSeconds * 1000);
    } finally {
      restore();
    }
  });

  it("keeps the abort timer alive while consuming the response body", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let cleared = false;
    globalThis.setTimeout = (() => 123 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => { cleared = true; }) as typeof clearTimeout;
    const restore = mockFetch((_url, init) => ({
      ok: true,
      json: async () => {
        assert.equal(cleared, false);
        assert.ok(init.signal instanceof AbortSignal);
        return copilotUsage;
      },
    }) as Response);
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.state, "live");
      assert.equal(cleared, true);
    } finally {
      restore();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("fetches with an explicit GitHub.com enterprise URL", async () => {
    let fetches = 0;
    const restore = mockFetch(() => {
      fetches += 1;
      return response(copilotUsage);
    });
    try {
      const quota = await fetchCopilotQuota(mockCredentials({
        type: "oauth",
        refresh: OAUTH_TOKEN,
        enterpriseUrl: "https://github.com/",
      }));
      assert.equal(quota.state, "live");
      assert.equal(quota.windows[0]?.id, "monthly");
      assert.equal(fetches, 1);
    } finally {
      restore();
    }
  });

  it("rejects custom enterprise domains before any network call", async () => {
    let fetches = 0;
    const restore = mockFetch(() => {
      fetches += 1;
      return response(copilotUsage);
    });
    try {
      const quota = await fetchCopilotQuota(mockCredentials({
        type: "oauth",
        refresh: OAUTH_TOKEN,
        enterpriseUrl: "https://github.example.test",
      }));
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "GitHub Copilot quota supports GitHub.com only; custom enterprise domains are unsupported.");
      assert.equal(fetches, 0);
    } finally {
      restore();
    }
  });

  it("returns missing without a supported OAuth credential or network call", async () => {
    let fetched = false;
    const restore = mockFetch(() => {
      fetched = true;
      return response(copilotUsage);
    });
    try {
      const quota = await fetchCopilotQuota(mockCredentials({ type: "api_key", key: "secret-key" }));
      assert.equal(quota.state, "missing");
      assert.equal(fetched, false);
      assert.ok(!quota.error?.includes("secret-key"));
    } finally {
      restore();
    }
  });

  it("rejects malformed responses without exposing raw bodies", async () => {
    const restore = mockFetch(() => response({ quota_snapshots: "raw-secret-body" }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.ok(quota.error?.includes("missing quota data"));
      assert.ok(!quota.error?.includes("raw-secret-body"));
      assert.ok(!quota.error?.includes(OAUTH_TOKEN));
    } finally {
      restore();
    }
  });

  it("sanitizes HTTP and thrown errors without reading secrets or bodies", async () => {
    let restore = mockFetch(() => new Response("private-response-body", { status: 401 }));
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "GitHub Copilot quota request failed (401)");
      assert.ok(!quota.error.includes("private-response-body"));
      assert.ok(!quota.error.includes(OAUTH_TOKEN));
    } finally {
      restore();
    }

    restore = mockFetch(() => {
      throw new Error(`network failed ${OAUTH_TOKEN} private-response-body`);
    });
    try {
      const quota = await fetchCopilotQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "GitHub Copilot quota request failed");
      assert.ok(!quota.error.includes(OAUTH_TOKEN));
      assert.ok(!quota.error.includes("private-response-body"));
    } finally {
      restore();
    }
  });
});
