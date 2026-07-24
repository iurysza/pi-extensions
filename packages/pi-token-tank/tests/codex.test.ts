import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchCodexQuota } from "../src/codex.js";
import type { CredentialSourceLike } from "../src/auth.js";
import codexUsage from "./fixtures/codex-usage.json" with { type: "json" };

function mockCredentials(overrides?: {
  token?: string;
  accountId?: string;
  noCredential?: boolean;
}): CredentialSourceLike {
  return {
    getApiKey: async () => (overrides?.noCredential ? undefined : overrides?.token ?? "token"),
    readCredential: () =>
      overrides?.noCredential
        ? undefined
        : {
            type: "oauth",
            access: overrides?.token ?? "token",
            accountId: overrides?.accountId ?? "acc-1",
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

describe("fetchCodexQuota", () => {
  it("parses a valid usage response", async () => {
    const restore = mockFetch(() =>
      new Response(JSON.stringify(codexUsage), { status: 200 })
    );
    try {
      const quota = await fetchCodexQuota(mockCredentials());
      assert.equal(quota.provider, "codex");
      assert.equal(quota.state, "live");
      assert.equal(quota.plan, "plus");
      assert.equal(quota.windows.length, 2);
      assert.equal(quota.windows[0]?.id, "five-hour");
      assert.equal(quota.windows[0]?.usedPercent, 24);
      assert.equal(quota.windows[1]?.id, "weekly");
      assert.equal(quota.windows[1]?.usedPercent, 61);
    } finally {
      restore();
    }
  });

  it("accepts a weekly-only response when the 5-hour limit is disabled", async () => {
    const body = {
      plan_type: "prolite",
      rate_limit: {
        primary_window: {
          used_percent: 34,
          limit_window_seconds: 604800,
          reset_at: 1752687600,
        },
        secondary_window: null,
      },
    };
    const restore = mockFetch(() => new Response(JSON.stringify(body), { status: 200 }));
    try {
      const quota = await fetchCodexQuota(mockCredentials());
      assert.equal(quota.state, "live");
      assert.equal(quota.windows.length, 1);
      assert.equal(quota.windows[0]?.id, "weekly");
      assert.equal(quota.windows[0]?.usedPercent, 34);
    } finally {
      restore();
    }
  });

  it("returns missing state when credentials are absent", async () => {
    const quota = await fetchCodexQuota(mockCredentials({ noCredential: true }));
    assert.equal(quota.state, "missing");
    assert.equal(quota.windows.length, 0);
  });

  it("retries once when the access token changes after a 401", async () => {
    let calls = 0;
    const tokens: string[] = [];
    const credentials = {
      ...mockCredentials({ token: "old-token", accountId: "acc-1" }),
      getApiKey: async () => {
        calls++;
        return calls === 1 ? "old-token" : "new-token";
      },
      readCredential: () => {
        return {
          type: "oauth",
          access: calls === 1 ? "old-token" : "new-token",
          accountId: "acc-1",
        };
      },
    } as CredentialSourceLike;

    const restore = mockFetch((_url, init) => {
      const auth = (init.headers as Record<string, string>)["Authorization"];
      tokens.push(auth ?? "");
      if (auth === "Bearer old-token") {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify(codexUsage), { status: 200 });
    });

    try {
      const quota = await fetchCodexQuota(credentials);
      assert.equal(quota.state, "live");
      assert.equal(tokens.length, 2);
      assert.equal(tokens[0], "Bearer old-token");
      assert.equal(tokens[1], "Bearer new-token");
    } finally {
      restore();
    }
  });

  it("does not retry when registry resolution returns the same token", async () => {
    let calls = 0;
    const credentials = mockCredentials({ token: "same-token", accountId: "acc-1" });
    const restore = mockFetch(() => {
      calls++;
      return new Response("unauthorized", { status: 401 });
    });
    try {
      const quota = await fetchCodexQuota(credentials);
      assert.equal(quota.state, "error");
      assert.equal(calls, 1);
      assert.ok(!quota.error?.includes("same-token"));
    } finally {
      restore();
    }
  });

  it("rejects invalid schemas without raw bodies", async () => {
    const restore = mockFetch(() =>
      new Response(JSON.stringify({ unexpected: true }), { status: 200 })
    );
    try {
      const quota = await fetchCodexQuota(mockCredentials());
      assert.equal(quota.state, "error");
      assert.ok(!quota.error?.includes("unexpected"));
    } finally {
      restore();
    }
  });
});
