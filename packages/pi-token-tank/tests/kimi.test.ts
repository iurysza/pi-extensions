import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchKimiQuota } from "../src/kimi.js";
import type { CredentialSourceLike } from "../src/auth.js";
import kimiUsage from "./fixtures/kimi-usage.json" with { type: "json" };
import kimiNumeric from "./fixtures/kimi-usage-numeric-strings.json" with { type: "json" };

function mockCredentials(overrides?: {
  token?: string;
  type?: "oauth" | "api_key";
  noCredential?: boolean;
}): CredentialSourceLike {
  return {
    getApiKey: async () => (overrides?.noCredential ? undefined : overrides?.token ?? "token"),
    readCredential: () =>
      overrides?.noCredential
        ? undefined
        : overrides?.type === "api_key"
          ? { type: "api_key", key: overrides?.token ?? "token" }
          : {
              type: "oauth",
              access: overrides?.token ?? "token",
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

describe("fetchKimiQuota", () => {
  it("parses a valid usage response", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiUsage), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockCredentials());
      assert.equal(quota.provider, "kimi");
      assert.equal(quota.state, "live");
      assert.equal(quota.plan, "Allegro");
      assert.equal(quota.windows.length, 2);
      assert.equal(quota.windows[0]?.id, "five-hour");
      assert.equal(quota.windows[0]?.usedPercent, 18);
      assert.equal(quota.windows[1]?.id, "weekly");
      assert.equal(quota.windows[1]?.usedPercent, 43);
    } finally {
      restore();
    }
  });

  it("handles numeric strings and derived usage", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiNumeric), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockCredentials());
      assert.equal(quota.plan, "Vivace");
      assert.equal(quota.windows[1]?.usedPercent, 43); // (200-114)/200
      assert.equal(quota.windows[0]?.usedPercent, 22.5);
    } finally {
      restore();
    }
  });

  it("returns missing state when credentials are absent", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify(kimiUsage), { status: 200 }));
    const originalKey = process.env.KIMI_API_KEY;
    delete process.env.KIMI_API_KEY;
    try {
      const quota = await fetchKimiQuota(mockCredentials({ noCredential: true }));
      assert.equal(quota.state, "missing");
    } finally {
      restore();
      if (originalKey === undefined) delete process.env.KIMI_API_KEY;
      else process.env.KIMI_API_KEY = originalKey;
    }
  });

  it("forces one OAuth refresh on 401", async () => {
    let refreshes = 0;
    const credentials: CredentialSourceLike = {
      ...mockCredentials({ token: "old-token", type: "oauth" }),
      refreshOAuthToken: async () => {
        refreshes++;
        return "new-access";
      },
    };

    const restore = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      if (auth === "Bearer old-token") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify(kimiUsage), { status: 200 });
    });

    try {
      const quota = await fetchKimiQuota(credentials);
      assert.equal(quota.state, "live");
      assert.equal(refreshes, 1);
    } finally {
      restore();
    }
  });

  it("returns a sanitized error when OAuth refresh fails", async () => {
    const credentials: CredentialSourceLike = {
      ...mockCredentials({ token: "old-token", type: "oauth" }),
      refreshOAuthToken: async () => null,
    };

    const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
    try {
      const quota = await fetchKimiQuota(credentials);
      assert.equal(quota.state, "error");
      assert.ok(!quota.error?.includes("refresh-token"));
    } finally {
      restore();
    }
  });

  it("does not attempt OAuth refresh for API keys", async () => {
    let refreshed = false;
    const credentials: CredentialSourceLike = {
      ...mockCredentials({ token: "api-key", type: "api_key" }),
      refreshOAuthToken: async () => {
        refreshed = true;
        return "new-access";
      },
    };

    const restore = mockFetch(() => new Response("unauthorized", { status: 401 }));
    try {
      const quota = await fetchKimiQuota(credentials);
      assert.equal(quota.state, "error");
      assert.equal(refreshed, false);
    } finally {
      restore();
    }
  });

  it("rejects invalid schemas", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({ usage: {} }), { status: 200 }));
    try {
      const quota = await fetchKimiQuota(mockCredentials());
      assert.equal(quota.state, "error");
    } finally {
      restore();
    }
  });
});
