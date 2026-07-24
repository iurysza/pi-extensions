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
 * @property {string} defaultModel
 * @property {CatalogEntry[]} entries
 * @property {string} setupHint
 * @property {boolean} [fallback]
 */

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

/** Build the exact entries and hint consumed by the picker UI. */
export function buildPickerViewModel({ catalog, availableModels, currentModel, currentThinking }) {
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
