import type { RefreshModelsContext } from "@earendil-works/pi-ai/compat";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
	catalogFromPicker,
	configFromModel,
	modelFromConfig,
	pinnedCatalog,
	toProviderModelConfig,
} from "./claude-code-model-catalog.js";
import { defaultRuntime, type ClaudeCodeRuntime } from "./claude-code-runtime.js";
import { readAuthStatus, readPicker } from "./claude-code-setup.js";

export const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Picker models when logged in and stale; otherwise the cached or pinned list. Failures write nothing. */
export async function refreshClaudeCodeModels(
	context: RefreshModelsContext,
	runtime: ClaudeCodeRuntime = defaultRuntime(),
	consumeForce: () => boolean = () => false,
	now: () => number = Date.now,
): Promise<ProviderModelConfig[]> {
	const cached = await context.store.read().catch(() => undefined);
	const fallback = cached?.models.length ? cached.models.map(configFromModel) : pinnedCatalog().map(toProviderModelConfig);
	if (!context.allowNetwork) return fallback;
	const force = consumeForce() || context.force === true;
	const fresh = cached?.checkedAt !== undefined && now() - cached.checkedAt < MODEL_CACHE_TTL_MS;
	if (fresh && !force) return fallback;

	const auth = await readAuthStatus(runtime, context.signal);
	if (!auth?.loggedIn) return fallback;
	const rows = await readPicker(runtime, context.signal);
	if (!rows?.length) return fallback;
	const configs = catalogFromPicker(rows).map(toProviderModelConfig);
	if (!configs.length) return fallback;
	await context.store.write({ models: configs.map(modelFromConfig), checkedAt: now() });
	return configs;
}
