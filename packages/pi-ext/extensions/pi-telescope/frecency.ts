/**
 * Frecency Tracking
 *
 * Tracks frequency + recency of telescope selections.
 * Items selected more often and more recently get higher scores.
 * Data is persisted to ~/.pi/telescope-frecency.json.
 *
 * Score formula: count * 0.5^(age / halfLife)
 *   - half-life of 7 days means scores halve weekly
 *   - a file selected 10 times today scores ~10
 *   - a file selected 10 times a week ago scores ~5
 *   - a file selected once a month ago scores ~0.06
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const FRECENCY_PATH = join(process.env.HOME ?? "~", ".pi/telescope-frecency.json");
const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES_PER_PROVIDER = 500;

interface FrecencyEntry {
	count: number;
	lastUsed: number;
}

interface FrecencyData {
	[provider: string]: Record<string, FrecencyEntry>;
}

let cache: FrecencyData | null = null;

function load(): FrecencyData {
	if (cache) return cache;
	try {
		cache = JSON.parse(readFileSync(FRECENCY_PATH, "utf-8"));
		return cache!;
	} catch {
		cache = {};
		return cache;
	}
}

function save(): void {
	if (!cache) return;
	try {
		mkdirSync(dirname(FRECENCY_PATH), { recursive: true });
		writeFileSync(FRECENCY_PATH, JSON.stringify(cache));
	} catch {
		// Silently fail — frecency is a nice-to-have
	}
}

function computeScore(entry: FrecencyEntry): number {
	const age = Date.now() - entry.lastUsed;
	const recency = Math.pow(0.5, age / HALF_LIFE_MS);
	return entry.count * recency;
}

/** Record a selection for frecency tracking. */
export function recordSelection(provider: string, key: string): void {
	const data = load();
	if (!data[provider]) data[provider] = {};
	const entry = data[provider][key] ?? { count: 0, lastUsed: 0 };
	entry.count++;
	entry.lastUsed = Date.now();
	data[provider][key] = entry;

	// Prune: keep top N per provider to avoid unbounded growth
	const entries = Object.entries(data[provider]);
	if (entries.length > MAX_ENTRIES_PER_PROVIDER) {
		entries.sort((a, b) => computeScore(b[1]) - computeScore(a[1]));
		data[provider] = Object.fromEntries(entries.slice(0, MAX_ENTRIES_PER_PROVIDER));
	}

	save();
}

/** Get all frecency scores for a provider as a Map. */
export function getFrecencyMap(provider: string): Map<string, number> {
	const data = load();
	const providerData = data[provider];
	if (!providerData) return new Map();

	const map = new Map<string, number>();
	for (const [key, entry] of Object.entries(providerData)) {
		const score = computeScore(entry);
		if (score > 0.01) map.set(key, score);
	}
	return map;
}
