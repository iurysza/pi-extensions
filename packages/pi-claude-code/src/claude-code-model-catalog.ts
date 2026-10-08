import type { Api, Model, ThinkingLevel, ThinkingLevelMap } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export const CLAUDE_CODE_PROVIDER_ID = "claude-code";
export const CLAUDE_CODE_API = "claude-code-cli";
export const CLAUDE_CODE_BASE_URL = "process://claude-code";

const ONE_MILLION = 1_000_000;
const TWO_HUNDRED_K = 200_000;
const OUTPUT_TOKEN_BUDGET = 32_000;
const ROUTE_LONG_CONTEXT_SUFFIX = "[1m]";
/** zsh globs `[…]`, so pi ids use `-1m` where the CLI route uses `[1m]`. */
const ID_LONG_CONTEXT_SUFFIX = "-1m";

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
const ALL_EFFORTS: readonly ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

export interface ModelCapabilities {
	readonly effortLevels: readonly ClaudeEffort[];
	readonly adaptiveThinking: boolean;
	/** False for families that answer HTTP 400 to `thinking: {type: "disabled"}`. */
	readonly thinkingDisable: boolean;
}

export interface CatalogModel {
	readonly id: string;
	readonly name: string;
	readonly route: string;
	readonly upstreamId: string;
	readonly contextWindow: number;
	readonly maxTokens: number;
	readonly capabilities: ModelCapabilities;
}

/** One row of the CLI's `initialize` handshake model list. */
export interface PickerRow {
	readonly value?: unknown;
	readonly resolvedModel?: unknown;
	readonly displayName?: unknown;
	readonly description?: unknown;
	readonly supportsEffort?: unknown;
	readonly supportedEffortLevels?: unknown;
	readonly supportsAdaptiveThinking?: unknown;
}

interface PinnedModel {
	readonly id: string;
	readonly name: string;
	readonly upstreamId: string;
	readonly capabilities: ModelCapabilities;
}

const THINKING: ModelCapabilities = { effortLevels: ALL_EFFORTS, adaptiveThinking: true, thinkingDisable: true };
const MANDATORY_THINKING: ModelCapabilities = { ...THINKING, thinkingDisable: false };
const NO_THINKING: ModelCapabilities = { effortLevels: [], adaptiveThinking: false, thinkingDisable: true };

const PINNED_MODELS: readonly PinnedModel[] = [
	{ id: "claude-sonnet-5", name: "Claude Sonnet 5", upstreamId: "claude-sonnet-5", capabilities: THINKING },
	{ id: "claude-opus-5-5", name: "Claude Opus 5.5", upstreamId: "claude-opus-5-5", capabilities: THINKING },
	{ id: "claude-opus-5", name: "Claude Opus 5", upstreamId: "claude-opus-5", capabilities: THINKING },
	{ id: "claude-opus-4-8", name: "Claude Opus 4.8", upstreamId: "claude-opus-4-8", capabilities: THINKING },
	{ id: "claude-fable-5-1", name: "Claude Fable 5.1", upstreamId: "claude-fable-5-1", capabilities: MANDATORY_THINKING },
	{ id: "claude-haiku-4-5", name: "Claude Haiku 4.5", upstreamId: "claude-haiku-4-5-20251001", capabilities: NO_THINKING },
];

const ALIASES: Readonly<Record<string, string>> = {
	sonnet: "claude-sonnet-5",
	opus: "claude-opus-5-5",
	haiku: "claude-haiku-4-5",
	fable: "claude-fable-5-1",
};

const MANDATORY_THINKING_PREFIXES = ["claude-fable"];

interface ParsedId {
	readonly base: string;
	readonly longContext: boolean;
}

function parseId(id: string): ParsedId {
	for (const suffix of [ROUTE_LONG_CONTEXT_SUFFIX, ID_LONG_CONTEXT_SUFFIX]) {
		if (id.endsWith(suffix)) return { base: id.slice(0, -suffix.length), longContext: true };
	}
	return { base: id, longContext: false };
}

function pinnedModel(base: string): PinnedModel | undefined {
	const canonical = ALIASES[base] ?? base;
	return PINNED_MODELS.find((model) => model.id === canonical || model.upstreamId === canonical);
}

function acceptsThinkingDisable(upstreamId: string): boolean {
	return !MANDATORY_THINKING_PREFIXES.some((prefix) => upstreamId.startsWith(prefix));
}

function catalogEntry(parsed: ParsedId, name: string | undefined, capabilities: ModelCapabilities | undefined): CatalogModel {
	const pinned = pinnedModel(parsed.base);
	const baseId = pinned?.id ?? parsed.base;
	const upstreamId = pinned?.upstreamId ?? parsed.base;
	return {
		id: parsed.longContext ? `${baseId}${ID_LONG_CONTEXT_SUFFIX}` : baseId,
		name: name ?? `${pinned?.name ?? baseId}${parsed.longContext ? " (1M context)" : ""}`,
		route: parsed.longContext ? `${upstreamId}${ROUTE_LONG_CONTEXT_SUFFIX}` : upstreamId,
		upstreamId,
		contextWindow: parsed.longContext ? ONE_MILLION : TWO_HUNDRED_K,
		maxTokens: OUTPUT_TOKEN_BUDGET,
		capabilities: capabilities ?? pinned?.capabilities ?? { ...THINKING, thinkingDisable: acceptsThinkingDisable(upstreamId) },
	};
}

/** Offline models: base routes only, because a 1M route may bill usage credits on some plans. */
export function pinnedCatalog(): CatalogModel[] {
	return PINNED_MODELS.map((model) => catalogEntry({ base: model.id, longContext: false }, undefined, undefined));
}

/** Resolves any pi model id, pinned or not, to its CLI route and upstream model id. */
export function catalogModel(modelId: string): CatalogModel {
	return catalogEntry(parseId(modelId), undefined, undefined);
}

function pickerCapabilities(row: PickerRow, upstreamId: string): ModelCapabilities {
	const levels = row.supportsEffort === true && Array.isArray(row.supportedEffortLevels)
		? ALL_EFFORTS.filter((effort) => (row.supportedEffortLevels as unknown[]).includes(effort))
		: [];
	return {
		effortLevels: levels,
		adaptiveThinking: row.supportsAdaptiveThinking === true,
		thinkingDisable: acceptsThinkingDisable(upstreamId),
	};
}

function pickerName(row: PickerRow, fallback: CatalogModel): string {
	const description = typeof row.description === "string" ? row.description : "";
	const pinned = pinnedModel(parseId(fallback.upstreamId).base);
	const displayName = typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim() : undefined;
	const base = pinned ? fallback.name : displayName ?? (description.split("·")[0]?.trim() || fallback.id);
	return /usage credits/i.test(description) ? `${base} · usage credits` : base;
}

/**
 * Maps the account's Picker to catalog models. Alias rows (`default`) carry no `resolvedModel`
 * of their own identity and are skipped; a `[1m]` route becomes its own `-1m` model.
 */
export function catalogFromPicker(rows: readonly PickerRow[]): CatalogModel[] {
	const models = new Map<string, CatalogModel>();
	for (const row of rows) {
		if (typeof row.resolvedModel !== "string" || !row.resolvedModel) continue;
		if (row.value === "default") continue;
		const parsed = parseId(row.resolvedModel);
		const draft = catalogEntry(parsed, undefined, undefined);
		if (models.has(draft.id)) continue;
		models.set(draft.id, { ...draft, name: pickerName(row, draft), capabilities: pickerCapabilities(row, draft.upstreamId) });
	}
	return [...models.values()];
}

function thinkingLevelMap(capabilities: ModelCapabilities): ThinkingLevelMap {
	const map: ThinkingLevelMap = { off: capabilities.thinkingDisable ? "disabled" : null };
	const levels: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
	for (const level of levels) {
		const effort: ClaudeEffort = level === "minimal" ? "low" : level;
		map[level] = capabilities.effortLevels.includes(effort) ? effort : null;
	}
	return map;
}

function reasons(capabilities: ModelCapabilities): boolean {
	return capabilities.adaptiveThinking || capabilities.effortLevels.length > 0;
}

export function toProviderModelConfig(model: CatalogModel): ProviderModelConfig {
	return {
		id: model.id,
		name: model.name,
		reasoning: reasons(model.capabilities),
		...(reasons(model.capabilities) ? { thinkingLevelMap: thinkingLevelMap(model.capabilities) } : {}),
		input: ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
}

export function modelFromConfig(config: ProviderModelConfig): Model<Api> {
	return { ...config, api: CLAUDE_CODE_API, provider: CLAUDE_CODE_PROVIDER_ID, baseUrl: CLAUDE_CODE_BASE_URL } as Model<Api>;
}

export function configFromModel(model: Model<Api>): ProviderModelConfig {
	const { api: _api, provider: _provider, baseUrl: _baseUrl, ...config } = model;
	return config as ProviderModelConfig;
}

export interface TurnModelSettings {
	readonly route: string;
	readonly upstreamId: string;
	readonly thinking?: { type: "adaptive" } | { type: "disabled" };
	readonly effort?: ClaudeEffort;
	readonly maxTokens?: number;
}

function isEffort(value: unknown): value is ClaudeEffort {
	return typeof value === "string" && (ALL_EFFORTS as readonly string[]).includes(value);
}

/** Thinking and effort come from the pi model's own level map, so Picker-derived capabilities survive the cache. */
export function turnModelSettings(model: Pick<Model<Api>, "id" | "reasoning" | "thinkingLevelMap" | "maxTokens">, level: ThinkingLevel | undefined, maxTokens: number | undefined): TurnModelSettings {
	const catalog = catalogModel(model.id);
	const budget = maxTokens === undefined ? undefined : Math.min(maxTokens, model.maxTokens || maxTokens);
	const base = { route: catalog.route, upstreamId: catalog.upstreamId, ...(budget ? { maxTokens: budget } : {}) };
	if (!model.reasoning) return base;
	if (!level) {
		return model.thinkingLevelMap?.off === "disabled" ? { ...base, thinking: { type: "disabled" } } : base;
	}
	const effort = model.thinkingLevelMap?.[level];
	return { ...base, thinking: { type: "adaptive" }, ...(isEffort(effort) ? { effort } : {}) };
}

/** The upstream model id behind a pi model id, as Claude Code expects it on a replayed assistant frame. */
export function upstreamModelId(modelId: string): string {
	return catalogModel(modelId).upstreamId;
}
