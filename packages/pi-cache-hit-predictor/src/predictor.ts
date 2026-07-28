import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const UNKNOWN_THINKING_LEVEL = "unknown";

export interface CacheLane {
	provider: string;
	api: string;
	model: string;
	thinkingLevel: string;
}

export interface CacheLaneSnapshot extends CacheLane {
	promptTokens: number;
}

export interface CacheHistory {
	lanes: Map<string, CacheLaneSnapshot>;
}

export interface CachePrediction {
	lane: CacheLane;
	estimatedCacheTokens: number;
	currentPromptTokens: number | null;
	percent: number | null;
	hasLaneHistory: boolean;
}

export interface CacheSwitchImpact {
	sourceLane: CacheLane;
	destLane: CacheLane;
	currentPromptTokens: number | null;
	contextWindow: number | null;
	sourceTokens: number;
	destTokens: number;
	lostTokens: number;
	dropPercent: number | null;
	windowImpactPercent: number | null;
}

export function cacheLaneKey(lane: CacheLane): string {
	return JSON.stringify([
		lane.provider,
		lane.api,
		lane.model,
		lane.thinkingLevel,
	]);
}

export function promptTokens(usage: {
	input: number;
	cacheRead: number;
	cacheWrite: number;
}): number {
	return usage.input + usage.cacheRead + usage.cacheWrite;
}

export function scanCacheHistory(
	entries: readonly SessionEntry[],
	initialThinkingLevel = UNKNOWN_THINKING_LEVEL,
): CacheHistory {
	const history: CacheHistory = { lanes: new Map() };
	let thinkingLevel = initialThinkingLevel;

	for (const entry of entries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
			continue;
		}

		if (entry.type === "compaction" || entry.type === "branch_summary") {
			history.lanes.clear();
			continue;
		}

		if (entry.type !== "message" || entry.message.role !== "assistant") {
			continue;
		}

		const message = entry.message;
		if (message.stopReason === "aborted" || message.stopReason === "error") {
			continue;
		}

		const tokens = promptTokens(message.usage);
		if (tokens <= 0) continue;

		const lane: CacheLane = {
			provider: message.provider,
			api: message.api,
			model: message.model,
			thinkingLevel,
		};

		history.lanes.set(cacheLaneKey(lane), {
			...lane,
			promptTokens: tokens,
		});
	}

	return history;
}

export function recordAssistantUsage(
	history: CacheHistory,
	message: Extract<SessionEntry, { type: "message" }>["message"],
	lane: CacheLane,
): void {
	if (
		message.role !== "assistant" ||
		message.stopReason === "aborted" ||
		message.stopReason === "error"
	) {
		return;
	}

	const tokens = promptTokens(message.usage);
	if (tokens <= 0) return;

	history.lanes.set(cacheLaneKey(lane), {
		...lane,
		promptTokens: tokens,
	});
}

export function predictCacheHit(
	history: CacheHistory,
	lane: CacheLane,
	currentPromptTokens: number | null,
): CachePrediction {
	const snapshot = history.lanes.get(cacheLaneKey(lane));
	const currentTokens =
		currentPromptTokens !== null && currentPromptTokens > 0
			? currentPromptTokens
			: null;
	const estimatedCacheTokens = snapshot
		? Math.min(snapshot.promptTokens, currentTokens ?? snapshot.promptTokens)
		: 0;

	return {
		lane,
		estimatedCacheTokens,
		currentPromptTokens: currentTokens,
		percent:
			currentTokens === null
				? null
				: Math.min(100, (estimatedCacheTokens / currentTokens) * 100),
		hasLaneHistory: snapshot !== undefined,
	};
}

export function lastUsedLane(entries: readonly SessionEntry[]): CacheLane | undefined {
	let thinkingLevel = UNKNOWN_THINKING_LEVEL;
	let lastLane: CacheLane | undefined;

	for (const entry of entries) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.thinkingLevel;
			continue;
		}

		if (entry.type === "compaction" || entry.type === "branch_summary") {
			lastLane = undefined;
			continue;
		}

		if (entry.type !== "message" || entry.message.role !== "assistant") {
			continue;
		}

		const message = entry.message;
		if (message.stopReason === "aborted" || message.stopReason === "error") {
			continue;
		}

		const tokens = promptTokens(message.usage);
		if (tokens <= 0) continue;

		lastLane = {
			provider: message.provider,
			api: message.api,
			model: message.model,
			thinkingLevel,
		};
	}

	return lastLane;
}

export function predictCacheSwitchImpact(
	history: CacheHistory,
	sourceLane: CacheLane,
	destLane: CacheLane,
	currentPromptTokens: number | null,
	contextWindow: number | null,
): CacheSwitchImpact {
	const sourceSnapshot = history.lanes.get(cacheLaneKey(sourceLane))?.promptTokens ?? 0;
	const destSnapshot = history.lanes.get(cacheLaneKey(destLane))?.promptTokens ?? 0;
	const currentTokens =
		currentPromptTokens !== null && currentPromptTokens > 0
			? currentPromptTokens
			: null;
	const sourceTokens = currentTokens !== null
		? Math.min(sourceSnapshot, currentTokens)
		: sourceSnapshot;
	const destTokens = currentTokens !== null
		? Math.min(destSnapshot, currentTokens)
		: destSnapshot;
	const lostTokens = Math.max(0, sourceTokens - destTokens);
	const dropPercent = sourceTokens > 0
		? (lostTokens / sourceTokens) * 100
		: null;
	const windowImpactPercent = contextWindow && contextWindow > 0
		? (lostTokens / contextWindow) * 100
		: null;

	return {
		sourceLane,
		destLane,
		currentPromptTokens: currentTokens,
		contextWindow: contextWindow ?? null,
		sourceTokens,
		destTokens,
		lostTokens,
		dropPercent,
		windowImpactPercent,
	};
}

export const CACHE_ICON = "\u{f01bc}";

export function formatTokens(tokens: number): string {
	if (tokens < 1_000) return Math.round(tokens).toString();
	if (tokens < 1_000_000) {
		return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
	}
	return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`;
}

export function renderSwitchImpact(impact: CacheSwitchImpact): string {
	if (impact.sourceTokens === 0 && impact.destTokens === 0) {
		return `${CACHE_ICON} cold`;
	}
	if (impact.sourceTokens === 0) return `${CACHE_ICON} warm`;

	return `${CACHE_ICON} ↓${formatTokens(impact.lostTokens)}/${formatTokens(impact.sourceTokens)}`;
}
