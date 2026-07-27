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

export interface RenderTheme {
	fg(color: "success" | "error" | "dim" | "muted" | "warning", text: string): string;
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

const BLOCK = "█";
const DIM = "░";
const DEFAULT_BAR_WIDTH = 8;

function allocateSegments(values: readonly number[], width: number): number[] {
	const total = values.reduce((sum, value) => sum + value, 0);
	if (total === 0) return values.map(() => 0);

	const raw = values.map((value) => (value / total) * width);
	const floors = raw.map(Math.floor);
	const remainders = raw
		.map((value, index) => ({ remainder: value - floors[index], index }))
		.sort((a, b) => b.remainder - a.remainder);
	let sum = floors.reduce((a, b) => a + b, 0);

	for (const { index } of remainders) {
		if (sum >= width) break;
		floors[index]++;
		sum++;
	}

	return floors;
}

export function renderSwitchImpact(
	impact: CacheSwitchImpact,
	theme?: RenderTheme,
	options?: { barWidth?: number },
): string {
	const lane = `${impact.destLane.model} · ${impact.destLane.thinkingLevel}`;

	if (impact.sourceTokens === 0 && impact.destTokens === 0) {
		return `cache ${lane} · cold`;
	}

	const barWidth = options?.barWidth ?? DEFAULT_BAR_WIDTH;
	const totalTokens = Math.max(
		impact.contextWindow ?? 0,
		impact.currentPromptTokens ?? 0,
		impact.destTokens + impact.lostTokens,
	);
	const carried = impact.destTokens;
	const lost = impact.lostTokens;
	const rest = Math.max(0, totalTokens - carried - lost);
	const [carriedWidth, lostWidth, restWidth] = allocateSegments(
		[carried, lost, rest],
		barWidth,
	);

	const color = (name: "success" | "error" | "dim", text: string) =>
		theme ? theme.fg(name, text) : text;
	const segments: string[] = [];
	if (carriedWidth > 0) segments.push(color("success", BLOCK.repeat(carriedWidth)));
	if (lostWidth > 0) segments.push(color("error", BLOCK.repeat(lostWidth)));
	if (restWidth > 0) segments.push(color("dim", DIM.repeat(restWidth)));
	const bar = segments.join("");

	let label: string;
	if (impact.lostTokens > 0 && impact.dropPercent !== null) {
		label = `↓${Math.round(impact.dropPercent)}%`;
	} else if (impact.sourceTokens > 0) {
		label = "↓0%";
	} else if (impact.destTokens > 0) {
		label = "warm";
	} else {
		label = "cold";
	}

	return `cache ${lane} ${label} [${bar}]`;
}
