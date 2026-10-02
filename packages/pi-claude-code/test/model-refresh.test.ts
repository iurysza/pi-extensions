import type { ModelsStoreEntry, RefreshModelsContext } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { modelFromConfig, pinnedCatalog, toProviderModelConfig } from "../src/claude-code-model-catalog.js";
import { MODEL_CACHE_TTL_MS, refreshClaudeCodeModels } from "../src/claude-code-model-refresh.js";
import { readPicker } from "../src/claude-code-setup.js";
import { startFakeUpstream, type FakeUpstream } from "./fixtures/fake-upstream.js";
import { testRuntime, type FakeScenario } from "./helpers.js";

const NOW = 1_800_000_000_000;

function store(initial?: ModelsStoreEntry) {
	let entry = initial;
	const writes: ModelsStoreEntry[] = [];
	return {
		writes,
		api: {
			read: async () => entry,
			write: async (next: ModelsStoreEntry) => {
				entry = next;
				writes.push(next);
			},
			delete: async () => {
				entry = undefined;
			},
		},
	};
}

function context(storeApi: ReturnType<typeof store>["api"], options: Partial<RefreshModelsContext> = {}): RefreshModelsContext {
	return { store: storeApi, allowNetwork: true, ...options };
}

let upstream: FakeUpstream | undefined;
afterEach(async () => {
	await upstream?.close();
	upstream = undefined;
});

async function runtime(scenario: FakeScenario = {}) {
	upstream = await startFakeUpstream();
	return testRuntime({ upstream: upstream.url, scenario });
}

const pinnedIds = pinnedCatalog().map((model) => model.id);
const cachedEntry = (checkedAt: number): ModelsStoreEntry => ({
	models: [modelFromConfig(toProviderModelConfig(pinnedCatalog()[0]!))],
	checkedAt,
});

describe("refreshClaudeCodeModels", () => {
	it("returns the pinned list offline without spawning", async () => {
		const rt = await runtime();
		const models = await refreshClaudeCodeModels(context(store().api, { allowNetwork: false }), rt, undefined, () => NOW);
		expect(models.map((model) => model.id)).toEqual(pinnedIds);
		expect(rt.records()).toEqual([]);
	});

	it("keeps a fresh cache unless forced", async () => {
		const rt = await runtime();
		const cached = store(cachedEntry(NOW - 1000));
		const models = await refreshClaudeCodeModels(context(cached.api), rt, undefined, () => NOW);
		expect(models.map((model) => model.id)).toEqual(["claude-sonnet-5"]);
		expect(rt.records()).toEqual([]);
		const forced = await refreshClaudeCodeModels(context(cached.api), rt, () => true, () => NOW);
		expect(forced.map((model) => model.id)).toContain("claude-opus-5-5-1m");
	});

	it("maps the Picker into models with billing notes and stores them", async () => {
		const rt = await runtime();
		const saved = store(cachedEntry(NOW - MODEL_CACHE_TTL_MS - 1));
		const models = await refreshClaudeCodeModels(context(saved.api), rt, undefined, () => NOW);
		expect(models.map((model) => [model.id, model.name, model.contextWindow, model.reasoning])).toEqual([
			["claude-sonnet-5", "Claude Sonnet 5", 200_000, true],
			["claude-sonnet-5-1m", "Claude Sonnet 5 (1M context)", 1_000_000, true],
			["claude-opus-5-5-1m", "Claude Opus 5.5 (1M context) · usage credits", 1_000_000, true],
			["claude-haiku-4-5", "Claude Haiku 4.5", 200_000, false],
		]);
		expect(saved.writes).toHaveLength(1);
		expect(saved.writes[0]).toMatchObject({ checkedAt: NOW });
		expect(saved.writes[0]!.models[0]).toMatchObject({ provider: "claude-code", api: "claude-code-cli" });
		expect(upstream!.messages()).toHaveLength(0);
	});

	it("writes nothing when logged out", async () => {
		const rt = await runtime({ loggedOut: true });
		const saved = store();
		const models = await refreshClaudeCodeModels(context(saved.api), rt, undefined, () => NOW);
		expect(models.map((model) => model.id)).toEqual(pinnedIds);
		expect(saved.writes).toEqual([]);
	});
});

describe("readPicker", () => {
	it("refuses a handshake that tries to reach Anthropic", async () => {
		const rt = await runtime({ handshakeRequest: true });
		expect(await readPicker(rt)).toBeUndefined();
		expect(rt.records().find((entry) => entry.kind === "handshake-request")).toEqual({ kind: "handshake-request", status: 400 });
		expect(upstream!.messages()).toHaveLength(0);
	});
});
