import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { createCredentialSource, type CredentialSourceLike } from "./auth.js";
import { captureCursorSessionToken, fetchCursorQuotaWithToken } from "./cursor.js";
import { FRESHNESS_MS, formatFooter, formatWidget } from "./format.js";
import { createFooterSlotRegistration } from "./footer-slot.js";
import { loadFooterMode, saveFooterMode, type FooterMode } from "./preferences.js";
import { createFileQuotaStore, type QuotaStore, type StoredQuota } from "./quota-store.js";
import {
  createCursorProvider,
  providerForModel as findProviderForModel,
  providers,
  providersForRuntime,
} from "./providers.js";
import type { ProviderId, ProviderQuota, QuotaProvider, QuotaSnapshot } from "./types.js";

const STATUS_KEY = "pi-token-tank";
const WIDGET_KEY = "pi-token-tank";
export const COOLDOWN_BASE_MS = 5 * 60 * 1000;
export const COOLDOWN_MAX_MS = 30 * 60 * 1000;

interface CacheEntry {
  data?: ProviderQuota;
  inflight?: Promise<ProviderQuota>;
}

function hasData(quota: ProviderQuota | undefined): quota is ProviderQuota {
  return quota?.state === "live" || quota?.state === "stale";
}

function isFresh(quota: ProviderQuota | undefined, nowMs: number): boolean {
  return quota?.state === "live" && quota.fetchedAt !== undefined && nowMs - quota.fetchedAt < FRESHNESS_MS;
}

function newer(left: ProviderQuota | undefined, right: ProviderQuota | undefined): ProviderQuota | undefined {
  if (!hasData(right)) return left;
  if (!hasData(left)) return right;
  return (right.fetchedAt ?? 0) > (left.fetchedAt ?? 0) ? right : left;
}

function isRateLimited(quota: ProviderQuota): boolean {
  return quota.state === "error" && /\(429\)/.test(quota.error ?? "");
}

/** Keep showing last-good numbers, marked stale, when a refresh fails. */
function staleOr(previous: ProviderQuota | undefined, failure: ProviderQuota): ProviderQuota {
  return hasData(previous)
    ? { ...previous, state: "stale", error: failure.error, retryAt: failure.retryAt }
    : failure;
}

/** Per-process cache with the same contract as the shared file store. Used when no store is given. */
export function createMemoryQuotaStore(): QuotaStore {
  const entries = new Map<ProviderId, StoredQuota>();
  const claimed = new Set<ProviderId>();
  return {
    read: async (providerId) => ({ ...entries.get(providerId) }),
    write: async (providerId, entry) => { entries.set(providerId, entry); },
    claim: async (providerId) => {
      if (claimed.has(providerId)) return undefined;
      claimed.add(providerId);
      return async () => { claimed.delete(providerId); };
    },
  };
}

export function createCoordinator(
  credentials: CredentialSourceLike,
  registry: readonly QuotaProvider[],
  initialSnapshot: QuotaSnapshot = {},
  store: QuotaStore = createMemoryQuotaStore(),
) {
  const caches = new Map<ProviderId, CacheEntry>(registry.map((provider) => [
    provider.id,
    { data: initialSnapshot[provider.id] },
  ]));
  const providerById = new Map(registry.map((provider) => [provider.id, provider]));

  async function fetchShared(provider: QuotaProvider, cache: CacheEntry, force: boolean): Promise<ProviderQuota> {
    const stored = await store.read(provider.id);
    const known = newer(cache.data, stored.quota);
    const nowMs = Date.now();
    // A 429 cooldown binds every session, including forced refreshes.
    if (stored.cooldownUntil !== undefined && stored.cooldownUntil > nowMs) {
      return staleOr(known, {
        provider: provider.id, state: "error", windows: [],
        error: hasData(known) && known.error ? known.error : "Quota request failed (429)",
        retryAt: stored.cooldownUntil,
      });
    }
    if (!force && known && isFresh(known, nowMs)) return known;

    const release = await store.claim(provider.id);
    // Another session is fetching; its result lands in the store for the next refresh.
    if (!release) return known ?? cache.data ?? { provider: provider.id, state: "missing", windows: [] };
    try {
      const quota = await provider.fetch(credentials).catch((): ProviderQuota => ({
        provider: provider.id, state: "error", windows: [], error: "Unexpected quota refresh failure.",
      }));
      if (quota.state === "live") {
        await store.write(provider.id, { quota });
        return quota;
      }
      if (isRateLimited(quota)) {
        const backoffMs = Math.min(COOLDOWN_MAX_MS, stored.backoffMs ? stored.backoffMs * 2 : COOLDOWN_BASE_MS);
        const cooldownUntil = Date.now() + backoffMs;
        await store.write(provider.id, { quota: stored.quota, cooldownUntil, backoffMs });
        return staleOr(known, { ...quota, retryAt: cooldownUntil });
      }
      return staleOr(known, quota);
    } finally {
      await release();
    }
  }

  async function refresh(providerId: ProviderId, force: boolean): Promise<ProviderQuota> {
    const provider = providerById.get(providerId);
    const cache = caches.get(providerId);
    if (!provider || !cache) throw new Error(`Unknown quota provider: ${providerId}`);
    if (!force && isFresh(cache.data, Date.now())) return cache.data!;
    if (cache.inflight) return cache.inflight;

    cache.inflight = fetchShared(provider, cache, force)
      .catch((): ProviderQuota => staleOr(cache.data, {
        provider: providerId, state: "error", windows: [], error: "Unexpected quota refresh failure.",
      }))
      .then((quota) => {
        cache.data = quota;
        cache.inflight = undefined;
        return quota;
      });
    return cache.inflight;
  }

  async function refreshAll(force: boolean): Promise<QuotaSnapshot> {
    await Promise.all(registry.map((provider) => refresh(provider.id, force)));
    return getSnapshot();
  }

  function getSnapshot(): QuotaSnapshot {
    return Object.fromEntries(registry.map((provider) => [
      provider.id,
      caches.get(provider.id)?.data ?? { provider: provider.id, state: "missing", windows: [] },
    ]));
  }

  function clear(): void {
    for (const cache of caches.values()) {
      cache.data = undefined;
      cache.inflight = undefined;
    }
  }

  return { refresh, refreshAll, getSnapshot, clear };
}

function makeThemeLike(theme: ExtensionContext["ui"]["theme"]) {
  return {
    fg: (color: Parameters<typeof theme.fg>[0], text: string) => theme.fg(color, text),
  };
}

export function providerForModel(model: ExtensionContext["model"]): ProviderId | undefined {
  return findProviderForModel(model, providersForRuntime([], model))?.id;
}

export function createTokenTank(
  pi: ExtensionAPI,
  credentialSourceOverride?: CredentialSourceLike,
  preferenceFile?: string,
  registry: readonly QuotaProvider[] = providers,
  quotaStore: QuotaStore = createFileQuotaStore(),
) {
  const cursorSessionToken = captureCursorSessionToken();
  const detectedCursorProvider = createCursorProvider(
    () => fetchCursorQuotaWithToken(cursorSessionToken),
  );
  let coordinator: ReturnType<typeof createCoordinator> | undefined;
  let runtimeRegistry: readonly QuotaProvider[] = registry;
  let pendingProviderIds: ProviderId[] = [];
  let credentials = credentialSourceOverride;
  let widgetVisible = false;
  let footerMode: FooterMode = "minimal";
  const footerSlot = createFooterSlotRegistration(pi.events, STATUS_KEY, 100);

  function sameRegistry(left: readonly QuotaProvider[], right: readonly QuotaProvider[]): boolean {
    return left.length === right.length && left.every((provider, index) => provider.id === right[index]?.id);
  }

  function getCoordinator(ctx: ExtensionContext) {
    const registryWithOptionalDetection = ctx.modelRegistry as unknown as {
      getRegisteredProviderIds?: () => readonly string[];
    };
    const registeredProviderIds = registryWithOptionalDetection.getRegisteredProviderIds?.() ?? [];
    const nextRegistry = providersForRuntime(
      registeredProviderIds,
      ctx.model,
      registry,
      detectedCursorProvider,
    );
    if (!coordinator || !sameRegistry(runtimeRegistry, nextRegistry)) {
      const previousCoordinator = coordinator;
      const previousSnapshot = previousCoordinator?.getSnapshot();
      const previousIds = new Set(runtimeRegistry.map((provider) => provider.id));
      previousCoordinator?.clear();
      runtimeRegistry = nextRegistry;
      pendingProviderIds = previousCoordinator
        ? runtimeRegistry.filter((provider) => !previousIds.has(provider.id)).map((provider) => provider.id)
        : [];
      credentials ??= createCredentialSource(ctx.modelRegistry);
      coordinator = createCoordinator(credentials, runtimeRegistry, previousSnapshot, quotaStore);
    }
    return coordinator;
  }

  function updateStatusSlot(ctx: ExtensionContext) {
    const activeCoordinator = getCoordinator(ctx);
    const provider = findProviderForModel(ctx.model, runtimeRegistry);
    if (!provider) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }
    const quota = activeCoordinator.getSnapshot()[provider.id];
    ctx.ui.setStatus(
      STATUS_KEY,
      formatFooter(quota, footerMode, makeThemeLike(ctx.ui.theme), provider.footerWindows[footerMode]),
    );
  }

  function updateWidget(ctx: ExtensionContext) {
    if (!widgetVisible) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    const activeCoordinator = getCoordinator(ctx);
    const snapshot = activeCoordinator.getSnapshot();
    const widgetRegistry = runtimeRegistry;
    const activeProviderId = findProviderForModel(ctx.model, runtimeRegistry)?.id;
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render(width: number) {
        return formatWidget(snapshot, widgetRegistry, makeThemeLike(theme), Date.now(), activeProviderId)
          .map((line) => truncateToWidth(line, Math.max(1, width), "…"));
      },
      invalidate() {},
    }));
  }

  async function refreshAndRender(ctx: ExtensionContext, force: boolean) {
    const activeCoordinator = getCoordinator(ctx);
    const provider = findProviderForModel(ctx.model, runtimeRegistry);
    updateStatusSlot(ctx);
    if (provider) await activeCoordinator.refresh(provider.id, force);
    if (widgetVisible && pendingProviderIds.length > 0) {
      const addedProviderIds = pendingProviderIds;
      pendingProviderIds = [];
      await Promise.all(addedProviderIds
        .filter((providerId) => providerId !== provider?.id)
        .map((providerId) => activeCoordinator.refresh(providerId, force)));
    }
    updateStatusSlot(ctx);
    if (widgetVisible) updateWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    footerSlot.register();
    footerMode = await loadFooterMode(preferenceFile);
    // Not forced: a session that starts while the shared cache is fresh must not refetch.
    await refreshAndRender(ctx, false);
  });
  pi.on("turn_end", async (_event, ctx) => refreshAndRender(ctx, false));
  pi.on("model_select", async (event, ctx) => {
    await refreshAndRender({ ...ctx, model: event.model } as ExtensionContext, false);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    coordinator?.clear();
    coordinator = undefined;
    runtimeRegistry = registry;
    pendingProviderIds = [];
    footerSlot.dispose();
  });

  pi.registerCommand("token-tank", {
    description: "Toggle the quota table, or set the footer: minimal | full",
    getArgumentCompletions: (prefix) => ["minimal", "full"]
      .filter((value) => value.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const argument = args.trim();
      if (argument === "minimal" || argument === "full") {
        footerMode = argument;
        updateStatusSlot(ctx);
        await saveFooterMode(footerMode, preferenceFile);
        return;
      }
      if (argument) {
        ctx.ui.notify("Usage: /token-tank [minimal|full]", "warning");
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/token-tank requires TUI mode", "warning");
        return;
      }
      widgetVisible = !widgetVisible;
      if (widgetVisible) {
        await getCoordinator(ctx).refreshAll(true);
        pendingProviderIds = [];
      }
      updateStatusSlot(ctx);
      updateWidget(ctx);
    },
  });
}

export { providers } from "./providers.js";
export type { QuotaProvider } from "./types.js";

export default function tokenTank(pi: ExtensionAPI) {
  return createTokenTank(pi);
}
