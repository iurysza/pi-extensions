import { fetchCodexQuota } from "./codex.js";
import { fetchCopilotQuota } from "./copilot.js";
import { fetchCursorQuota } from "./cursor.js";
import { fetchKimiQuota } from "./kimi.js";
import type { QuotaProvider } from "./types.js";

export const providers: readonly QuotaProvider[] = [
  {
    id: "codex",
    label: "Codex",
    matchesModel: (model) => {
      const provider = model?.provider.toLowerCase();
      return provider === "openai" || provider === "openai-codex";
    },
    fetch: fetchCodexQuota,
    credentialsHint: "Run /login openai-codex.",
    footerWindows: { minimal: ["five-hour"], full: ["five-hour", "weekly"] },
  },
  {
    id: "kimi",
    label: "Kimi",
    matchesModel: (model) => model?.provider.toLowerCase() === "kimi-coding",
    fetch: fetchKimiQuota,
    credentialsHint: "Run /login kimi-coding or set KIMI_API_KEY.",
    footerWindows: { minimal: ["five-hour"], full: ["five-hour", "weekly"] },
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    matchesModel: (model) => model?.provider.toLowerCase() === "github-copilot",
    fetch: fetchCopilotQuota,
    credentialsHint: "Run /login github-copilot.",
    footerWindows: { minimal: ["monthly"], full: ["monthly"] },
  },
];

export function createCursorProvider(fetch: QuotaProvider["fetch"] = fetchCursorQuota): QuotaProvider {
  return {
    id: "cursor",
    label: "Cursor",
    matchesModel: (model) => model?.provider.toLowerCase() === "cursor",
    fetch,
    credentialsHint: "Set CURSOR_SESSION_TOKEN to your cursor.com WorkosCursorSessionToken cookie value.",
    footerWindows: { minimal: ["billing-cycle"], full: ["billing-cycle", "auto", "api"] },
  };
}

export const cursorProvider = createCursorProvider();

export function providersForRuntime(
  registeredProviderIds: readonly string[],
  model: Parameters<QuotaProvider["matchesModel"]>[0],
  registry: readonly QuotaProvider[] = providers,
  detectedCursorProvider: QuotaProvider = cursorProvider,
): readonly QuotaProvider[] {
  const cursorDetected = registeredProviderIds.includes("cursor") || model?.provider.toLowerCase() === "cursor";
  if (!cursorDetected || registry.some((provider) => provider.id === "cursor")) return registry;
  return [...registry, detectedCursorProvider];
}

export function providerForModel(
  model: Parameters<QuotaProvider["matchesModel"]>[0],
  registry: readonly QuotaProvider[] = providers,
): QuotaProvider | undefined {
  return registry.find((provider) => provider.matchesModel(model));
}
