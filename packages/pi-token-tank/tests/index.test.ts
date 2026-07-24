import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createTokenTank, providerForModel } from "../src/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { CredentialSourceLike } from "../src/auth.js";
import type { QuotaProvider } from "../src/types.js";
import codexUsage from "./fixtures/codex-usage.json" with { type: "json" };
import copilotUsage from "./fixtures/copilot-usage.json" with { type: "json" };
import cursorUsage from "./fixtures/cursor-usage.json" with { type: "json" };
import kimiUsage from "./fixtures/kimi-usage.json" with { type: "json" };

function fakeCredentials(): CredentialSourceLike {
  return {
    getApiKey: async () => "token",
    readCredential: () => undefined,
    refreshOAuthToken: async () => null,
  };
}

function withMockFetch(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
    }
  };
}

function fakeAPI(provider = "openai-codex", registeredProviderIds: string[] = []) {
  const handlers: Record<string, ((event: unknown, ctx: unknown) => Promise<unknown>)[]> = {};
  const status: Record<string, string | undefined> = {};
  const widgets: Record<string, string[] | undefined> = {};
  const widgetKinds: Record<string, "lines" | "component" | undefined> = {};
  const widgetRenderers: Record<string, ((width: number) => string[]) | undefined> = {};
  const commands: Record<string, { handler: (args: string, ctx: ExtensionContext) => Promise<void> }> = {};

  const ctx: ExtensionContext = {
    mode: "tui",
    model: { provider, id: "test-model" } as ExtensionContext["model"],
    modelRegistry: {
      getRegisteredProviderIds: () => registeredProviderIds,
    } as unknown as ExtensionContext["modelRegistry"],
    ui: {
      setStatus: (key: string, text: string | undefined) => {
        status[key] = text;
      },
      setWidget: (key: string, content: unknown) => {
        if (typeof content === "function") {
          widgetKinds[key] = "component";
          const component = (content as (
            tui: unknown,
            theme: { fg: (color: string, text: string) => string },
          ) => { render: (width: number) => string[] })(
            {},
            { fg: (_color: string, text: string) => text },
          );
          widgetRenderers[key] = component.render;
          widgets[key] = component.render(96);
        } else {
          widgetKinds[key] = content === undefined ? undefined : "lines";
          widgetRenderers[key] = undefined;
          widgets[key] = content as string[] | undefined;
        }
      },
      theme: {
        fg: (_color: string, text: string) => text,
      },
    } as unknown as ExtensionContext["ui"],
  } as unknown as ExtensionContext;

  return {
    api: {
      on: (event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event]!.push(handler);
      },
      registerCommand: (name: string, options: { handler: (args: string, ctx: ExtensionContext) => Promise<void> }) => {
        commands[name] = options;
      },
    } as unknown as ExtensionAPI,
    handlers,
    status,
    widgets,
    widgetKinds,
    widgetRenderers,
    commands,
    ctx,
    async fire(event: string, payload: unknown) {
      for (const h of handlers[event] ?? []) {
        await h(payload, ctx);
      }
    },

  };
}

describe("createTokenTank", () => {
  it("routes supported model families and rejects unsupported providers", () => {
    assert.equal(providerForModel({ provider: "openai", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "openai-codex", id: "gpt" } as ExtensionContext["model"]), "codex");
    assert.equal(providerForModel({ provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"]), "kimi");
    assert.equal(providerForModel({ provider: "github-copilot", id: "gpt" } as ExtensionContext["model"]), "copilot");
    assert.equal(providerForModel({ provider: "cursor", id: "composer" } as ExtensionContext["model"]), "cursor");
    assert.equal(providerForModel({ provider: "anthropic", id: "claude" } as ExtensionContext["model"]), undefined);
  });

  it(
    "keeps existing providers working when registry detection is unavailable",
    withMockFetch(async () => {
      const f = fakeAPI("anthropic");
      f.ctx.modelRegistry = {} as ExtensionContext["modelRegistry"];
      createTokenTank(f.api, fakeCredentials());
      await assert.doesNotReject(f.fire("session_start", {}));
      assert.equal(f.status["pi-token-tank"], undefined);
    }),
  );

  it(
    "leaves the widget unchanged when Cursor is not registered or active",
    withMockFetch(async () => {
      const f = fakeAPI("anthropic");
      createTokenTank(f.api, fakeCredentials());
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(!widget.includes("Cursor"));
    }),
  );

  it(
    "detects a registered Cursor provider while another model is active",
    withMockFetch(async () => {
      const originalToken = process.env.CURSOR_SESSION_TOKEN;
      delete process.env.CURSOR_SESSION_TOKEN;
      try {
        const f = fakeAPI("anthropic", ["cursor"]);
        createTokenTank(f.api, fakeCredentials());
        await f.commands["token-tank"]!.handler("", f.ctx);
        const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
        assert.ok(widget.includes("Cursor"));
        assert.ok(widget.includes("Credentials missing"));
      } finally {
        if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
        else process.env.CURSOR_SESSION_TOKEN = originalToken;
      }
    }),
  );

  it("detects a registered Cursor provider and renders its dashboard quota", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "user%3A%3Aheader.payload.signature";
    globalThis.fetch = (async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      const f = fakeAPI("cursor", ["cursor"]);
      createTokenTank(f.api, fakeCredentials());
      assert.equal(process.env.CURSOR_SESSION_TOKEN, undefined);
      const sessionSymbol = Symbol.for("pi-token-tank.cursor-session-token");
      assert.equal(Object.prototype.propertyIsEnumerable.call(process, sessionSymbol), false);
      assert.equal((process as NodeJS.Process & Record<symbol, unknown>)[sessionSymbol], "user%3A%3Aheader.payload.signature");
      assert.equal(({ ...process } as Record<symbol, unknown>)[sessionSymbol], undefined);
      await f.fire("session_start", {});
      assert.ok(f.status["pi-token-tank"]?.includes("19.4%"));
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("Cursor"));
      assert.ok(widget.includes("19% used"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("refreshes Cursor when registration appears while the widget is visible", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "visible-user%3A%3Aheader.payload.signature";
    globalThis.fetch = (async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      const registeredProviderIds: string[] = [];
      const f = fakeAPI("anthropic", registeredProviderIds);
      createTokenTank(f.api, fakeCredentials());
      await f.commands["token-tank"]!.handler("", f.ctx);
      assert.ok(!f.widgets["pi-token-tank"]?.join("\n").includes("Cursor"));

      registeredProviderIds.push("cursor");
      await f.fire("turn_end", {});
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("Cursor"));
      assert.ok(widget.includes("19% used"));
      assert.ok(!widget.includes("Credentials missing. Set CURSOR_SESSION_TOKEN"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("retains the captured session token across extension instances", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "reload-user%3A%3Aheader.payload.signature";
    globalThis.fetch = (async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      const first = fakeAPI("anthropic", ["cursor"]);
      createTokenTank(first.api, fakeCredentials());
      assert.equal(process.env.CURSOR_SESSION_TOKEN, undefined);

      const reloaded = fakeAPI("cursor", ["cursor"]);
      createTokenTank(reloaded.api, fakeCredentials());
      await reloaded.fire("session_start", {});
      assert.ok(reloaded.status["pi-token-tank"]?.includes("19.4%"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("detects Cursor when extension registration appears before model selection", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "user%3A%3Aheader.payload.signature";
    globalThis.fetch = (async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      const registeredProviderIds: string[] = [];
      const f = fakeAPI("anthropic", registeredProviderIds);
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", {});
      assert.equal(f.status["pi-token-tank"], undefined);

      registeredProviderIds.push("cursor");
      f.ctx.model = { provider: "cursor", id: "composer" } as ExtensionContext["model"];
      await f.fire("model_select", { model: f.ctx.model });
      assert.ok(String(f.status["pi-token-tank"] ?? "").includes("19.4%"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("preserves existing provider snapshots when Cursor appears", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "user%3A%3Aheader.payload.signature";
    globalThis.fetch = (async (url) => String(url).includes("cursor.com")
      ? new Response(JSON.stringify(cursorUsage), { status: 200 })
      : new Response("unauthorized", { status: 401 })) as typeof fetch;
    try {
      const registeredProviderIds: string[] = [];
      const existing: QuotaProvider = {
        id: "existing",
        label: "Existing",
        matchesModel: (model) => model?.provider === "existing",
        fetch: async () => ({
          provider: "existing",
          state: "live",
          fetchedAt: Date.now(),
          windows: [{
            id: "monthly",
            shortLabel: "30d",
            longLabel: "Monthly",
            resetStyle: "weekday-time",
            usedPercent: 42,
          }],
        }),
        credentialsHint: "Configure Existing.",
        footerWindows: { minimal: ["monthly"], full: ["monthly"] },
      };
      const f = fakeAPI("existing", registeredProviderIds);
      createTokenTank(f.api, fakeCredentials(), undefined, [existing]);
      await f.fire("session_start", {});
      assert.ok(f.status["pi-token-tank"]?.includes("42%"));

      registeredProviderIds.push("cursor");
      f.ctx.model = { provider: "cursor", id: "composer" } as ExtensionContext["model"];
      await f.fire("model_select", { model: f.ctx.model });
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("Existing"));
      assert.ok(widget.includes("42% used"));
      assert.ok(widget.includes("Cursor"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("never claims Cursor quota from an active model alone", async () => {
    const originalFetch = globalThis.fetch;
    const originalToken = process.env.CURSOR_SESSION_TOKEN;
    process.env.CURSOR_SESSION_TOKEN = "pi-cursor-sdk-cursor-api-key-placeholder";
    globalThis.fetch = async () => new Response("unauthorized", { status: 401 });
    try {
      const f = fakeAPI("cursor", []);
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", {});
      assert.equal(f.status["pi-token-tank"], "—");
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("Cursor"));
      assert.ok(widget.includes("Credentials missing"));
      assert.ok(!widget.includes("0% used"));
    } finally {
      globalThis.fetch = originalFetch;
      if (originalToken === undefined) delete process.env.CURSOR_SESSION_TOKEN;
      else process.env.CURSOR_SESSION_TOKEN = originalToken;
    }
  });

  it("routes and renders an injected provider adapter", async () => {
    const future: QuotaProvider = {
      id: "future",
      label: "Future",
      matchesModel: (model) => model?.provider === "future",
      fetch: async () => ({
        provider: "future", state: "live", fetchedAt: Date.now(),
        windows: [{
          id: "monthly", shortLabel: "30d", longLabel: "Monthly",
          resetStyle: "weekday-time", usedPercent: 42,
        }],
      }),
      credentialsHint: "Configure Future.",
      footerWindows: { minimal: ["monthly"], full: ["monthly"] },
    };
    const f = fakeAPI("future");
    createTokenTank(f.api, fakeCredentials(), undefined, [future]);
    await f.fire("session_start", {});
    assert.ok(f.status["pi-token-tank"]?.includes("42%"));
  });

  it("registers without eagerly creating credential storage", () => {
    fakeAPI();
    const registered: string[] = [];
    const pi = {
      on: () => {},
      registerCommand: (name: string) => {
        registered.push(name);
      },
    } as unknown as ExtensionAPI;
    createTokenTank(pi);
    assert.ok(registered.includes("token-tank"));
    assert.ok(!registered.includes("usage"));
  });

  it(
    "sets footer on session_start",
    withMockFetch(async () => {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      assert.ok(f.status["pi-token-tank"], "status should be set");
      f.ctx.model = { provider: "anthropic", id: "claude" } as ExtensionContext["model"];
      await f.fire("model_select", { type: "model_select", model: f.ctx.model, source: "set" });
      assert.equal(f.status["pi-token-tank"], undefined);
    }),
  );

  it("toggles the /token-tank widget", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => {
      const value = String(url);
      const body = value.includes("chatgpt.com")
        ? codexUsage
        : value.includes("api.github.com")
          ? copilotUsage
          : kimiUsage;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    try {
      const f = fakeAPI();
      const credentials = {
        ...fakeCredentials(),
        readCredential: (provider: string) => provider === "openai-codex"
          ? { type: "oauth", access: "token", accountId: "acc-1" }
          : provider === "github-copilot"
            ? { type: "oauth", access: "copilot-session-token", refresh: "github-oauth-token" }
            : { type: "api_key", key: "token" },
      } as CredentialSourceLike;
      createTokenTank(f.api, credentials);
      await f.commands["token-tank"]!.handler("", f.ctx);
      const widget = f.widgets["pi-token-tank"]?.join("\n") ?? "";
      assert.ok(widget.includes("GitHub Copilot"));
      assert.ok(widget.includes("Monthly"));
      assert.ok(widget.includes("25% used"));
      assert.equal(f.widgetKinds["pi-token-tank"], "component");
      assert.ok((f.widgets["pi-token-tank"]?.length ?? Infinity) <= 5);
      assert.ok(f.widgets["pi-token-tank"]?.some((line) => line.includes("/token-tank hides")));
      assert.ok(f.widgetRenderers["pi-token-tank"]?.(32).every((line) => visibleWidth(line) <= 32));
      await f.commands["token-tank"]!.handler("", f.ctx);
      assert.equal(f.widgets["pi-token-tank"], undefined);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("switches provider footer immediately", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (url) => new Response(JSON.stringify(String(url).includes("chatgpt.com") ? codexUsage : kimiUsage))) as typeof fetch;
    try {
      const f = fakeAPI("openai-codex");
      const credentials = {
        ...fakeCredentials(),
        readCredential: (provider: string) => provider === "openai-codex"
          ? { type: "oauth", access: "token", accountId: "acc-1" }
          : { type: "api_key", key: "token" },
      } as CredentialSourceLike;
      createTokenTank(f.api, credentials);
      await f.fire("session_start", {});
      const codexFooter = f.status["pi-token-tank"];
      f.ctx.model = { provider: "kimi-coding", id: "kimi" } as ExtensionContext["model"];
      await f.fire("model_select", { model: f.ctx.model });
      assert.notEqual(f.status["pi-token-tank"], codexFooter);
      assert.ok(f.status["pi-token-tank"]?.includes("18"));
    } finally { globalThis.fetch = original; }
  });

  it("changes and atomically persists footer mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-mode-"));
    const path = join(dir, "preference.json");
    try {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials(), path);
      await f.commands["token-tank"]!.handler("full", f.ctx);
      assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { footerMode: "full" });
      assert.ok(f.status["pi-token-tank"]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it(
    "cleans up on session_shutdown",
    withMockFetch(async () => {
      const f = fakeAPI();
      createTokenTank(f.api, fakeCredentials());
      await f.fire("session_start", { type: "session_start", reason: "startup" });
      await f.fire("session_shutdown", { type: "session_shutdown", reason: "quit" });
      assert.equal(f.status["pi-token-tank"], undefined);
      assert.equal(f.widgets["pi-token-tank"], undefined);
    }),
  );
});
