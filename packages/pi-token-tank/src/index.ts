import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

import { createCredentialSource, type CredentialSourceLike } from "./auth.js";
import { captureCursorSessionToken, fetchCursorQuotaWithToken } from "./cursor.js";
import { formatFooter, formatWidget } from "./format.js";
import { loadFooterMode, saveFooterMode, type FooterMode } from "./preferences.js";
import {
  createCursorProvider,
  providerForModel as findProviderForModel,
  providers,
  providersForRuntime,
} from "./providers.js";
import type { ProviderId, ProviderQuota, QuotaProvider, QuotaSnapshot } from "./types.js";

const STATUS_KEY = "pi-token-tank";
const WIDGET_KEY = "pi-token-tank";
const FRESHNESS_MS = 5 * 60 * 1000;

interface CacheEntry {
  data?: ProviderQuota;
  inflight?: Promise<ProviderQuota>;
}

export function createCoordinator(
  credentials: CredentialSourceLike,
  registry: readonly QuotaProvider[],
  initialSnapshot: QuotaSnapshot = {},
) {
  const caches = new Map<ProviderId, CacheEntry>(registry.map((provider) => [
    provider.id,
    { data: initialSnapshot[provider.id] },
  ]));
  const providerById = new Map(registry.map((provider) => [provider.id, provider]));

  async function refresh(providerId: ProviderId, force: boolean): Promise<ProviderQuota> {
    const provider = providerById.get(providerId);
    const cache = caches.get(providerId);
    if (!provider || !cache) throw new Error(`Unknown quota provider: ${providerId}`);
    if (!force && cache.data?.fetchedAt && Date.now() - cache.data.fetchedAt < FRESHNESS_MS) {
      return cache.data;
    }
    if (cache.inflight) return cache.inflight;

    cache.inflight = provider.fetch(credentials)
      .then((quota) => {
        const previous = cache.data;
        if (
          (quota.state === "error" || quota.state === "missing") &&
          previous &&
          (previous.state === "live" || previous.state === "stale")
        ) {
          cache.data = { ...previous, state: "stale", error: quota.error };
        } else {
          cache.data = quota;
        }
        cache.inflight = undefined;
        return cache.data;
      })
      .catch(() => {
        const previous = cache.data;
        cache.data = previous && (previous.state === "live" || previous.state === "stale")
          ? { ...previous, state: "stale", error: "Unexpected quota refresh failure." }
          : { provider: providerId, state: "error", windows: [], error: "Unexpected quota refresh failure." };
        cache.inflight = undefined;
        return cache.data;
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
      coordinator = createCoordinator(credentials, runtimeRegistry, previousSnapshot);
    }
    return coordinator;
  }

  function updateFooter(ctx: ExtensionContext) {
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
    ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
      render(width: number) {
        return formatWidget(snapshot, widgetRegistry, makeThemeLike(theme), Date.now())
          .map((line) => truncateToWidth(line, Math.max(1, width), "…"));
      },
      invalidate() {},
    }));
  }

  async function refreshAndRender(ctx: ExtensionContext, force: boolean) {
    const activeCoordinator = getCoordinator(ctx);
    const provider = findProviderForModel(ctx.model, runtimeRegistry);
    updateFooter(ctx);
    if (provider) await activeCoordinator.refresh(provider.id, force);
    if (widgetVisible && pendingProviderIds.length > 0) {
      const addedProviderIds = pendingProviderIds;
      pendingProviderIds = [];
      await Promise.all(addedProviderIds
        .filter((providerId) => providerId !== provider?.id)
        .map((providerId) => activeCoordinator.refresh(providerId, force)));
    }
    updateFooter(ctx);
    if (widgetVisible) updateWidget(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    footerMode = await loadFooterMode(preferenceFile);
    await refreshAndRender(ctx, true);
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
  });

  pi.registerCommand("token-tank", {
    description: "Toggle details or set footer mode: minimal | full",
    getArgumentCompletions: (prefix) => ["minimal", "full"]
      .filter((value) => value.startsWith(prefix.trim()))
      .map((value) => ({ value, label: value })),
    handler: async (args, ctx) => {
      const argument = args.trim();
      if (argument === "minimal" || argument === "full") {
        footerMode = argument;
        updateFooter(ctx);
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
      updateFooter(ctx);
      updateWidget(ctx);
    },
  });
}

export { providers } from "./providers.js";
export type { QuotaProvider } from "./types.js";

export default function tokenTank(pi: ExtensionAPI) {
  return createTokenTank(pi);
}
