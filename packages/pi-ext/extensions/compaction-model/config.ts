import {
  getAgentDir,
  SettingsManager,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const COMPACTION_REASONS = ["manual", "threshold", "overflow"] as const;
export type CompactionReason = (typeof COMPACTION_REASONS)[number];

export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface CompactionModelConfig {
  model: string;
  thinkingLevel?: ThinkingLevel;
  reasons: CompactionReason[];
}

type UnknownRecord = Record<string, unknown>;
type Warn = (message: string) => void;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function section(settings: unknown): unknown {
  return isRecord(settings) ? settings.compactionModel : undefined;
}

export function resolveConfig(
  globalSettings: unknown,
  projectSettings: unknown,
  warn: Warn = (message) => console.warn(`[pi-compaction-model] ${message}`),
): CompactionModelConfig | null {
  const globalSection = section(globalSettings);
  const projectSection = section(projectSettings);

  if (projectSection === false) return null;
  if (globalSection === false && projectSection === undefined) return null;

  const raw: UnknownRecord = {
    ...(isRecord(globalSection) ? globalSection : {}),
    ...(isRecord(projectSection) ? projectSection : {}),
  };

  if (raw.enabled === false) return null;

  if (typeof raw.model !== "string" || !raw.model.trim()) {
    if (globalSection !== undefined || projectSection !== undefined) {
      warn("compactionModel.model must be a non-empty provider/model string; using Pi's active model.");
    }
    return null;
  }

  let thinkingLevel: ThinkingLevel | undefined;
  if (raw.thinkingLevel !== undefined && raw.thinkingLevel !== null) {
    if (
      typeof raw.thinkingLevel === "string" &&
      (THINKING_LEVELS as readonly string[]).includes(raw.thinkingLevel)
    ) {
      thinkingLevel = raw.thinkingLevel as ThinkingLevel;
    } else {
      warn(`Invalid thinkingLevel '${String(raw.thinkingLevel)}'; using the provider default.`);
    }
  }

  let reasons: CompactionReason[] = [...COMPACTION_REASONS];
  if (raw.reasons !== undefined) {
    if (
      Array.isArray(raw.reasons) &&
      raw.reasons.every(
        (reason) =>
          typeof reason === "string" &&
          (COMPACTION_REASONS as readonly string[]).includes(reason),
      )
    ) {
      reasons = [...new Set(raw.reasons)] as CompactionReason[];
    } else {
      warn("reasons must contain only manual, threshold, or overflow; handling all reasons.");
    }
  }

  return {
    model: raw.model.trim(),
    thinkingLevel,
    reasons,
  };
}

export function loadConfig(ctx: ExtensionContext): CompactionModelConfig | null {
  const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
    projectTrusted: ctx.isProjectTrusted(),
  });

  return resolveConfig(
    settings.getGlobalSettings(),
    ctx.isProjectTrusted() ? settings.getProjectSettings() : undefined,
  );
}

export function parseModelReference(reference: string): { provider: string; modelId: string } | null {
  const separator = reference.indexOf("/");
  if (separator <= 0 || separator === reference.length - 1) return null;

  const provider = reference.slice(0, separator).trim();
  const modelId = reference.slice(separator + 1).trim();
  return provider && modelId ? { provider, modelId } : null;
}
