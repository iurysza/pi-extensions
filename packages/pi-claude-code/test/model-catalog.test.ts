import { describe, expect, it } from "vitest";
import {
	catalogFromPicker,
	catalogModel,
	pinnedCatalog,
	toProviderModelConfig,
	turnModelSettings,
	upstreamModelId,
} from "../src/claude-code-model-catalog.js";
import { testModel } from "./helpers.js";

const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

describe("pinned catalog", () => {
	it("lists only 200K base routes so nothing bills usage credits offline", () => {
		const models = pinnedCatalog();
		expect(models.map((model) => model.id)).toEqual([
			"claude-sonnet-5",
			"claude-opus-5-5",
			"claude-opus-5",
			"claude-opus-4-8",
			"claude-fable-5-1",
			"claude-haiku-4-5",
		]);
		for (const model of models) {
			expect(model.route).not.toContain("[1m]");
			expect(model.contextWindow).toBe(200_000);
		}
		expect(models.find((model) => model.id === "claude-haiku-4-5")?.route).toBe("claude-haiku-4-5-20251001");
	});

	it("resolves -1m ids to [1m] routes with a 1M window", () => {
		expect(catalogModel("claude-opus-5-5-1m")).toMatchObject({ route: "claude-opus-5-5[1m]", upstreamId: "claude-opus-5-5", contextWindow: 1_000_000 });
		expect(catalogModel("claude-sonnet-5[1m]").id).toBe("claude-sonnet-5-1m");
		expect(catalogModel("claude-new-7")).toMatchObject({ route: "claude-new-7", upstreamId: "claude-new-7" });
		expect(upstreamModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5-20251001");
	});

	it("gives Fable no off level and Haiku no reasoning", () => {
		const fable = toProviderModelConfig(catalogModel("claude-fable-5-1"));
		expect(fable.thinkingLevelMap?.off).toBeNull();
		expect(fable.thinkingLevelMap?.minimal).toBe("low");
		const haiku = toProviderModelConfig(catalogModel("claude-haiku-4-5"));
		expect(haiku.reasoning).toBe(false);
		expect(haiku.thinkingLevelMap).toBeUndefined();
		const sonnet = toProviderModelConfig(catalogModel("claude-sonnet-5"));
		expect(sonnet.thinkingLevelMap).toMatchObject({ off: "disabled", max: "max" });
	});
});

describe("catalogFromPicker", () => {
	const rows = [
		{ value: "default", resolvedModel: "claude-sonnet-5", description: "Sonnet 5" },
		{ value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", supportsEffort: true, supportedEffortLevels: EFFORTS, supportsAdaptiveThinking: true },
		{ value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus (1M context)", description: "Opus 5.5 with 1M context · Draws from usage credits · $4/$20 per Mtok", supportsEffort: true, supportedEffortLevels: ["low", "high"], supportsAdaptiveThinking: true },
		{ value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku", description: "Haiku 4.5" },
		{ value: "claude-new-7", resolvedModel: "claude-new-7", displayName: "New 7", supportsEffort: true, supportedEffortLevels: EFFORTS, supportsAdaptiveThinking: true },
		{ value: "best" },
	];

	it("maps rows to pi models, skipping alias rows", () => {
		const models = catalogFromPicker(rows);
		expect(models.map((model) => model.id)).toEqual(["claude-sonnet-5", "claude-opus-5-5-1m", "claude-haiku-4-5", "claude-new-7"]);
		expect(models[1]).toMatchObject({ name: "Claude Opus 5.5 (1M context) · usage credits", route: "claude-opus-5-5[1m]", contextWindow: 1_000_000 });
		expect(models[3]?.name).toBe("New 7");
	});

	it("takes capabilities from the row", () => {
		const [, opus, haiku] = catalogFromPicker(rows);
		const opusConfig = toProviderModelConfig(opus!);
		expect(opusConfig.thinkingLevelMap).toMatchObject({ low: "low", medium: null, high: "high", xhigh: null });
		expect(toProviderModelConfig(haiku!).reasoning).toBe(false);
	});
});

describe("turnModelSettings", () => {
	it("maps levels to adaptive thinking and effort", () => {
		expect(turnModelSettings(testModel("claude-sonnet-5"), "minimal", undefined)).toEqual({
			route: "claude-sonnet-5",
			upstreamId: "claude-sonnet-5",
			thinking: { type: "adaptive" },
			effort: "low",
		});
		expect(turnModelSettings(testModel("claude-sonnet-5-1m"), "max", 100_000)).toMatchObject({ route: "claude-sonnet-5[1m]", effort: "max", maxTokens: 32_000 });
	});

	it("disables thinking when off, except where the model refuses it", () => {
		expect(turnModelSettings(testModel("claude-sonnet-5"), undefined, undefined).thinking).toEqual({ type: "disabled" });
		expect(turnModelSettings(testModel("claude-fable-5-1"), undefined, undefined).thinking).toBeUndefined();
		expect(turnModelSettings(testModel("claude-haiku-4-5"), "high", undefined)).toEqual({ route: "claude-haiku-4-5-20251001", upstreamId: "claude-haiku-4-5-20251001" });
	});
});
