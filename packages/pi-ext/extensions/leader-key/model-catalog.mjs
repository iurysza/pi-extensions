import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * @typedef {import("@earendil-works/pi-agent-core").ThinkingLevel} ThinkingLevel
 * @typedef {import("@earendil-works/pi-ai").Model<any>} Model
 */

/**
 * @typedef {Object} CatalogEntry
 * @property {string} nickname
 * @property {string} provider
 * @property {string} model
 * @property {ThinkingLevel} thinking
 */

/**
 * @typedef {Object} ModelCatalog
 * @property {number} [schemaVersion]
 * @property {string} [kind]
 * @property {string} defaultModel
 * @property {CatalogEntry[]} entries
 * @property {string} [setupHint]
 * @property {boolean} [fallback]
 * @property {{ mode?: string; showProviderGroups?: boolean; showModelNames?: boolean }} [display]
 */

const THEMED_TIER_NAMES = ["Fly", "Mid", "Heavy"];
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * @param {{ agentDir?: string; cwd?: string }} [overrides]
 * @returns {string}
 */
export function catalogPath(overrides) {
  if (overrides?.agentDir) {
    return join(overrides.agentDir, "model-catalog.json");
  }
  if (process.env.PI_CODING_AGENT_DIR) {
    return join(process.env.PI_CODING_AGENT_DIR, "model-catalog.json");
  }
  return join(homedir(), ".pi", "agent", "model-catalog.json");
}

/**
 * @param {{ agentDir?: string; cwd?: string }} [overrides]
 * @returns {ModelCatalog | null}
 */
export function loadModelCatalog(overrides) {
  const filePath = catalogPath(overrides);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * @param {CatalogEntry} entry
 * @param {Model[]} availableModels
 * @returns {Model | undefined}
 */
export function findRegistryMatch(entry, availableModels) {
  return availableModels.find(
    (model) => model.provider.toLowerCase() === entry.provider.toLowerCase() &&
      model.id.toLowerCase() === entry.model.toLowerCase(),
  );
}

/**
 * @param {ModelCatalog | null} catalog
 * @param {Model[]} availableModels
 * @returns {Array<CatalogEntry & { matched: Model | undefined }>}
 */
export function matchCatalogToRegistry(catalog, availableModels) {
  if (!catalog) return [];
  return catalog.entries.map((entry) => ({
    ...entry,
    matched: findRegistryMatch(entry, availableModels),
  }));
}

function isThemedTierCatalog(catalog) {
  return catalog?.kind === "themed-tier-catalog";
}

function invalidThemedView(message) {
  return {
    entries: [],
    tierMode: true,
    showProviderGroups: false,
    showModelNames: false,
    error: `Invalid themed tier catalog: ${message}`,
  };
}

function buildThemedTierViewModel({ catalog, availableModels, currentModel, currentThinking }) {
  if (catalog.schemaVersion !== 2) {
    return invalidThemedView(`expected schemaVersion 2, observed ${String(catalog.schemaVersion)}`);
  }
  if (
    catalog.display?.mode !== "tiers" ||
    catalog.display?.showProviderGroups !== false ||
    catalog.display?.showModelNames !== false
  ) {
    return invalidThemedView("display must use tiers mode with provider groups and model names disabled");
  }
  if (!Array.isArray(catalog.entries)) {
    return invalidThemedView("entries must be an array containing Fly, Mid, and Heavy");
  }
  const names = catalog.entries.map((entry) => entry?.nickname);
  if (names.length !== THEMED_TIER_NAMES.length || names.some((name, index) => name !== THEMED_TIER_NAMES[index])) {
    return invalidThemedView("entries must contain Fly, Mid, and Heavy in that order");
  }
  if (!THEMED_TIER_NAMES.includes(catalog.defaultModel)) {
    return invalidThemedView(`defaultModel must be one of ${THEMED_TIER_NAMES.join(", ")}`);
  }

  const seen = new Set();
  const entries = [];
  for (const entry of catalog.entries) {
    if (typeof entry.provider !== "string" || entry.provider.length === 0) {
      return invalidThemedView(`tier ${entry.nickname} requires a provider`);
    }
    if (typeof entry.model !== "string" || entry.model.length === 0) {
      return invalidThemedView(`tier ${entry.nickname} requires a model`);
    }
    if (!THINKING_LEVELS.has(entry.thinking)) {
      return invalidThemedView(`tier ${entry.nickname} has unsupported thinking level ${String(entry.thinking)}`);
    }

    const tuple = `${entry.provider}/${entry.model}:${entry.thinking}`.toLowerCase();
    if (seen.has(tuple)) {
      return invalidThemedView(`duplicate tuple ${entry.provider}/${entry.model}:${entry.thinking}`);
    }
    seen.add(tuple);

    const matched = findRegistryMatch(entry, availableModels);
    if (!matched) {
      return invalidThemedView(`unavailable tier ${entry.nickname}: ${entry.provider}/${entry.model}:${entry.thinking}`);
    }

    entries.push({
      label: entry.nickname,
      provider: entry.provider,
      model: entry.model,
      thinking: entry.thinking,
      active:
        currentModel?.provider.toLowerCase() === entry.provider.toLowerCase() &&
        currentModel?.id.toLowerCase() === entry.model.toLowerCase() &&
        currentThinking === entry.thinking,
    });
  }

  return {
    entries,
    fallbackHint: undefined,
    tierMode: true,
    showProviderGroups: false,
    showModelNames: false,
  };
}

/** Build the exact entries and hint consumed by the picker UI. */
export function buildPickerViewModel({ catalog, availableModels, currentModel, currentThinking }) {
  if (isThemedTierCatalog(catalog)) {
    return buildThemedTierViewModel({ catalog, availableModels, currentModel, currentThinking });
  }

  const setupHint = buildSetupHint(catalog);
  if (!catalog || catalog.entries.length === 0) {
    return {
      entries: currentModel ? [{
        label: currentModel.name,
        provider: currentModel.provider,
        model: currentModel.id,
        thinking: currentThinking,
        active: true,
      }] : [],
      fallbackHint: setupHint,
    };
  }

  const seen = new Set();
  const entries = [];
  for (const entry of matchCatalogToRegistry(catalog, availableModels)) {
    if (!entry.matched) continue;
    const key = `${entry.provider}/${entry.model}:${entry.thinking}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      label: `${entry.nickname} — ${entry.matched.name}`,
      provider: entry.provider,
      model: entry.model,
      thinking: entry.thinking,
      active: currentModel?.provider === entry.provider && currentModel?.id === entry.model,
    });
  }
  return {
    entries,
    fallbackHint: catalog.fallback ? setupHint : undefined,
  };
}

/**
 * @param {ModelCatalog | null} catalog
 * @returns {string | undefined}
 */
export function activeDefaultNickname(catalog) {
  return catalog?.defaultModel;
}

/**
 * @param {ModelCatalog | null} catalog
 * @returns {string}
 */
export function buildSetupHint(catalog) {
  return catalog?.setupHint ?? "Add named models to install-config.json under profiles.<profile>.models.";
}
