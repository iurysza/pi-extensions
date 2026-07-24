import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchCursorQuota, parseCursorUsage } from "../src/cursor.js";
import cursorEnterpriseUsage from "./fixtures/cursor-enterprise-usage.json" with { type: "json" };
import cursorUsage from "./fixtures/cursor-usage.json" with { type: "json" };

const SESSION_TOKEN = "auth0%7Cuser_123%3A%3Aheader.payload.signature";
const PLACEHOLDER = "pi-cursor-sdk-cursor-api-key-placeholder";

function mockFetch(response: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url, init) => response(String(url), init ?? {})) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

async function withSessionToken(value: string | undefined, run: () => Promise<void>): Promise<void> {
  const original = process.env.CURSOR_SESSION_TOKEN;
  if (value === undefined) delete process.env.CURSOR_SESSION_TOKEN;
  else process.env.CURSOR_SESSION_TOKEN = value;
  try {
    await run();
  } finally {
    if (original === undefined) delete process.env.CURSOR_SESSION_TOKEN;
    else process.env.CURSOR_SESSION_TOKEN = original;
  }
}

describe("parseCursorUsage", () => {
  it("parses dashboard plan and lane percentages", () => {
    const quota = parseCursorUsage(cursorUsage, 1_750_000_000_000);
    assert.equal(quota.provider, "cursor");
    assert.equal(quota.state, "live");
    assert.equal(quota.plan, "pro");
    assert.equal(quota.fetchedAt, 1_750_000_000_000);
    assert.deepEqual(quota.windows, [
      {
        id: "billing-cycle",
        shortLabel: "cycle",
        longLabel: "Total",
        resetStyle: "weekday-time",
        usedPercent: 19.4,
        used: 388,
        limit: 2000,
        resetsAt: Date.parse("2026-08-01T00:00:00.000Z"),
      },
      {
        id: "auto",
        shortLabel: "auto",
        longLabel: "Auto",
        resetStyle: "weekday-time",
        usedPercent: 12.5,
        used: undefined,
        limit: undefined,
        resetsAt: Date.parse("2026-08-01T00:00:00.000Z"),
      },
      {
        id: "api",
        shortLabel: "api",
        longLabel: "API",
        resetStyle: "weekday-time",
        usedPercent: 26.3,
        used: undefined,
        limit: undefined,
        resetsAt: Date.parse("2026-08-01T00:00:00.000Z"),
      },
    ]);
  });

  it("prefers an Enterprise personal cap over the shared pool", () => {
    const quota = parseCursorUsage(cursorEnterpriseUsage);
    assert.equal(quota.plan, "enterprise");
    assert.equal(quota.windows[0]?.usedPercent, 73.8);
    assert.equal(quota.windows[0]?.used, 7384);
    assert.equal(quota.windows[0]?.limit, 10000);
  });

  it("falls back to a finite Enterprise pooled quota", () => {
    const quota = parseCursorUsage({
      membershipType: "enterprise",
      teamUsage: { pooled: { used: 12_725_135, limit: 28_122_000 } },
    });
    assert.equal(quota.windows[0]?.usedPercent, 45.2);
  });

  it("drops unsafe membership labels", () => {
    const quota = parseCursorUsage({
      membershipType: "enterprise\u001b[2J",
      individualUsage: { overall: { used: 50, limit: 100 } },
    });
    assert.equal(quota.plan, undefined);
  });

  it("rejects unlimited, negative, malformed, and non-quota responses without raw values", () => {
    for (const body of [
      undefined,
      [],
      { isUnlimited: true, individualUsage: { plan: { totalPercentUsed: 0 } } },
      { individualUsage: { plan: { totalPercentUsed: -1 } } },
      { individualUsage: { overall: { used: -1, limit: 100 } } },
      { individualUsage: { plan: { note: "raw-secret-body" } } },
    ]) {
      assert.throws(
        () => parseCursorUsage(body),
        (error: unknown) => error instanceof Error
          && error.message.startsWith("Invalid Cursor usage response:")
          && !error.message.includes("raw-secret-body"),
      );
    }
  });
});

describe("fetchCursorQuota", () => {
  it("uses only the configured dashboard cookie on the read-only endpoint", async () => {
    const restore = mockFetch((url, init) => {
      assert.equal(url, "https://cursor.com/api/usage-summary");
      assert.equal(init.method, "GET");
      assert.equal(init.redirect, "error");
      assert.ok(init.signal instanceof AbortSignal);
      assert.deepEqual(init.headers, {
        Accept: "application/json",
        Cookie: `WorkosCursorSessionToken=${SESSION_TOKEN}`,
      });
      return new Response(JSON.stringify(cursorUsage), { status: 200 });
    });
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(process.env.CURSOR_SESSION_TOKEN, undefined);
        assert.equal(quota.state, "live");
        assert.equal(quota.windows[0]?.usedPercent, 19.4);
      });
    } finally {
      restore();
    }
  });

  it("does not fetch when the session token is absent or is the SDK placeholder", async () => {
    let fetched = false;
    const restore = mockFetch(() => {
      fetched = true;
      return new Response(JSON.stringify(cursorUsage));
    });
    try {
      for (const value of [undefined, "", PLACEHOLDER]) {
        await withSessionToken(value, async () => {
          const quota = await fetchCursorQuota();
          assert.equal(quota.state, "missing");
        });
      }
      assert.equal(fetched, false);
    } finally {
      restore();
    }
  });

  it("rejects cookie-header injection before any request", async () => {
    let fetched = false;
    const restore = mockFetch(() => {
      fetched = true;
      return new Response(JSON.stringify(cursorUsage));
    });
    try {
      await withSessionToken(`${SESSION_TOKEN}; injected=value`, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.state, "error");
        assert.equal(quota.error, "Cursor dashboard session token is invalid");
      });
      assert.equal(fetched, false);
    } finally {
      restore();
    }
  });

  it("treats rejected sessions as missing and cancels response bodies", async () => {
    let cancelled = false;
    const restore = mockFetch(() => new Response(new ReadableStream({
      cancel: () => { cancelled = true; },
    }), { status: 401 }));
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.state, "missing");
        assert.equal(cancelled, true);
        assert.ok(!quota.error?.includes(SESSION_TOKEN));
      });
    } finally {
      restore();
    }
  });

  it("sanitizes HTTP, schema, and thrown errors", async () => {
    let restore = mockFetch(() => new Response("private-response-body", { status: 500 }));
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.error, "Cursor quota request failed (500)");
      });
    } finally {
      restore();
    }

    restore = mockFetch(() => new Response(JSON.stringify({ secret: "private-response-body" }), { status: 200 }));
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.error, "Invalid Cursor usage response: missing quota data");
        assert.ok(!quota.error?.includes("private-response-body"));
      });
    } finally {
      restore();
    }

    restore = mockFetch(() => {
      throw new Error(`${SESSION_TOKEN} private-response-body`);
    });
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.error, "Cursor quota request failed");
      });
    } finally {
      restore();
    }
  });

  it("keeps the timeout active while consuming the response body", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let cleared = false;
    globalThis.setTimeout = (() => 123 as unknown as NodeJS.Timeout) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (() => { cleared = true; }) as typeof clearTimeout;
    const restore = mockFetch((_url, init) => new Response(new ReadableStream({
      pull(controller) {
        assert.equal(cleared, false);
        assert.ok(init.signal instanceof AbortSignal);
        controller.enqueue(new TextEncoder().encode(JSON.stringify(cursorUsage)));
        controller.close();
      },
    }), { status: 200 }));
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.state, "live");
        assert.equal(cleared, true);
      });
    } finally {
      restore();
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  it("rejects oversized decompressed response bodies", async () => {
    const restore = mockFetch(() => new Response(JSON.stringify({
      padding: "x".repeat(1_000_001),
    }), { status: 200 }));
    try {
      await withSessionToken(SESSION_TOKEN, async () => {
        const quota = await fetchCursorQuota();
        assert.equal(quota.state, "error");
        assert.equal(quota.error, "Cursor quota request failed");
      });
    } finally {
      restore();
    }
  });
});
