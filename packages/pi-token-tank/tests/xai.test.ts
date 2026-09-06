import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getXaiAuth, type CredentialSourceLike } from "../src/auth.js";
import { fetchXaiQuota } from "../src/xai.js";
import xaiUsage from "./fixtures/xai-usage.json" with { type: "json" };

const ACCESS_TOKEN = "xai-oauth-access";

function mockCredentials(overrides?: {
  token?: string;
  type?: "oauth" | "api_key";
  noCredential?: boolean;
}): CredentialSourceLike {
  return {
    getApiKey: async () => (overrides?.noCredential ? undefined : overrides?.token ?? ACCESS_TOKEN),
    readCredential: () =>
      overrides?.noCredential
        ? undefined
        : overrides?.type === "api_key"
          ? { type: "api_key", key: overrides?.token ?? "secret-api-key" }
          : {
              type: "oauth",
              access: overrides?.token ?? ACCESS_TOKEN,
              refresh: "refresh-token",
              expires: Date.now() + 3600_000,
            },
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

describe("getXaiAuth", () => {
  it("uses the registry OAuth access token", async () => {
    const auth = await getXaiAuth(mockCredentials());
    assert.deepEqual(auth, { token: ACCESS_TOKEN });
  });

  it("rejects missing and API-key credentials without reading secrets", async () => {
    for (const overrides of [
      { noCredential: true },
      { type: "api_key" as const, token: "secret-api-key" },
    ]) {
      const auth = await getXaiAuth(mockCredentials(overrides));
      assert.ok("error" in auth);
      assert.equal(auth.error, "xAI credentials missing. Run /login xai.");
      assert.ok(!auth.error.includes("secret-api-key"));
    }
  });
});

describe("fetchXaiQuota", () => {
  it("fetches and parses the SuperGrok weekly pool", async () => {
    const restore = mockFetch((url, init) => {
      assert.equal(url, "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      const headers = init.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${ACCESS_TOKEN}`);
      assert.equal(headers.Accept, "application/json");
      assert.equal(headers["X-XAI-Token-Auth"], "xai-grok-cli");
      return new Response(JSON.stringify(xaiUsage), { status: 200 });
    });
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.provider, "xai");
      assert.equal(quota.state, "live");
      assert.equal(quota.plan, "SuperGrok");
      assert.equal(quota.windows.length, 1);
      assert.deepEqual(quota.windows[0], {
        id: "weekly",
        shortLabel: "7d",
        longLabel: "Weekly",
        resetStyle: "weekday-time",
        usedPercent: 42.5,
        resetsAt: Date.parse("2026-08-15T01:53:09.930537+00:00"),
      });
    } finally {
      restore();
    }
  });

  it("maps a monthly credits period without inventing weekly labels", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      config: {
        credit_usage_percent: "18",
        current_period: {
          type: "USAGE_PERIOD_TYPE_MONTHLY",
          end: "2026-09-01T00:00:00Z",
        },
      },
    }), { status: 200 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.windows[0]?.id, "monthly");
      assert.equal(quota.windows[0]?.usedPercent, 18);
      assert.equal(quota.windows[0]?.resetsAt, Date.parse("2026-09-01T00:00:00Z"));
    } finally {
      restore();
    }
  });

  it("falls back to legacy monthly cent counters", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      config: {
        monthlyLimit: { val: 2000 },
        used: { val: "500" },
        billingPeriodEnd: "2026-05-01T00:00:00Z",
      },
    }), { status: 200 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.windows[0]?.id, "monthly");
      assert.equal(quota.windows[0]?.usedPercent, 25);
      assert.equal(quota.windows[0]?.used, 500);
      assert.equal(quota.windows[0]?.limit, 2000);
      assert.equal(quota.windows[0]?.resetsAt, Date.parse("2026-05-01T00:00:00Z"));
    } finally {
      restore();
    }
  });

  it("clamps usage pressure and treats proto3 empty cents as zero", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      config: {
        creditUsagePercent: 140,
        currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY" },
        used: {},
      },
    }), { status: 200 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.windows[0]?.usedPercent, 100);
    } finally {
      restore();
    }
  });

  it("returns missing without a network call when credentials are absent", async () => {
    let fetched = false;
    const restore = mockFetch(() => {
      fetched = true;
      return new Response(JSON.stringify(xaiUsage), { status: 200 });
    });
    try {
      const quota = await fetchXaiQuota(mockCredentials({ noCredential: true }));
      assert.equal(quota.state, "missing");
      assert.equal(fetched, false);
    } finally {
      restore();
    }
  });

  it("does not send an API key to the SuperGrok billing endpoint", async () => {
    let fetched = false;
    const restore = mockFetch(() => {
      fetched = true;
      return new Response(JSON.stringify(xaiUsage), { status: 200 });
    });
    try {
      const quota = await fetchXaiQuota(mockCredentials({ type: "api_key", token: "secret-api-key" }));
      assert.equal(quota.state, "missing");
      assert.equal(fetched, false);
      assert.ok(!quota.error?.includes("secret-api-key"));
    } finally {
      restore();
    }
  });

  it("forces one OAuth refresh on 401", async () => {
    let refreshes = 0;
    const credentials: CredentialSourceLike = {
      ...mockCredentials({ token: "old-token" }),
      refreshOAuthToken: async (providerId, currentKey) => {
        assert.equal(providerId, "xai");
        assert.equal(currentKey, "old-token");
        refreshes++;
        return "new-access";
      },
    };
    const restore = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer old-token") return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify(xaiUsage), { status: 200 });
    });
    try {
      const quota = await fetchXaiQuota(credentials);
      assert.equal(quota.state, "live");
      assert.equal(refreshes, 1);
    } finally {
      restore();
    }
  });

  it("returns a sanitized error when OAuth refresh fails", async () => {
    const restore = mockFetch(() => new Response("private-response-body", { status: 401 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials({ token: "old-token" }));
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "xAI quota request failed (401)");
      assert.ok(!quota.error.includes("private-response-body"));
      assert.ok(!quota.error.includes("old-token"));
      assert.ok(!quota.error.includes("refresh-token"));
    } finally {
      restore();
    }
  });

  it("rejects invalid schemas without exposing raw bodies", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({ unexpected: "raw-secret-body" }), { status: 200 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "Invalid xAI usage response: expected object");
      assert.ok(!quota.error.includes("raw-secret-body"));
    } finally {
      restore();
    }
  });

  it("does not invent a percent when billing fields are incoherent", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      config: { prepaidBalance: { val: 100 } },
    }), { status: 200 }));
    try {
      const quota = await fetchXaiQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.equal(quota.error, "Invalid xAI usage response: missing quota data");
    } finally {
      restore();
    }
  });
});
