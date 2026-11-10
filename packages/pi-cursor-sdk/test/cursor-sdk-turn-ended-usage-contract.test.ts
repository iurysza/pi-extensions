import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TurnEndedUpdateSchema } from "@cursor/sdk";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import {
	applyCursorUsage,
	isCursorSdkUsageSafeForPiMessage,
	readCursorSdkTurnUsageFromUpdate,
} from "../src/cursor-usage-accounting.js";
import { readCursorSdkUsageModule, readInstalledPackageVersion, resolveInstalledPackageRoot } from "./helpers/installed-package.js";
import { makeModel } from "./helpers/pi-harness.js";

const sdkRoot = resolveInstalledPackageRoot("@cursor/sdk");
const installedSdkVersion = readInstalledPackageVersion("@cursor/sdk");

interface TurnEndedUsageContractFixture {
	provenance: {
		sdkPackage: string;
		sdkVersion: string;
		verified: string;
		issue: string;
		capture: string;
		notes: string[];
	};
	installedSdkPublishedTransform: {
		declaration: string;
		implementationModule: string;
		totalTokensFormula: string;
		docsUrl: string;
	};
	observedRawTurnEnded: Array<{
		label: string;
		model: string;
		usage: {
			inputTokens: number;
			outputTokens: number;
			cacheReadTokens: number;
			cacheWriteTokens: number;
		};
	}>;
	expectedPiMappingFromRawTurnEnded: Array<{
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
	}>;
	runtimeDivergenceEvidence: {
		inputTokensDeltaTurn1ToTurn2: number;
		cacheReadDeltaTurn1ToTurn2: number;
		interpretation: string;
	};
}

function makeAssistantMessage(): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "A" }],
		api: "cursor-sdk",
		provider: "cursor",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 2,
	};
}

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/cursor-sdk-turn-ended-usage-1.0.23.json", import.meta.url), "utf8"),
) as TurnEndedUsageContractFixture;

describe("installed Cursor SDK turn-ended usage contract", () => {
	it("locks the installed 1.3.1 transform to input plus output, excluding cache and reasoning", () => {
		expect(installedSdkVersion).toBe("1.3.1");
		const usageTypes = readFileSync(join(sdkRoot, "dist/esm/usage-types.d.ts"), "utf8");
		expect(usageTypes).toContain("`totalTokens` excludes `reasoningTokens`");
		expect(usageTypes).toContain("Build a `TokenUsage` from a turn-ended payload");

		const usageModule = readCursorSdkUsageModule();
		// Both toTokenUsage and sumTokenUsage preserve cache fields but exclude them from the total.
		expect(usageModule.match(/\{inputTokens:(\w+),outputTokens:(\w+),cacheReadTokens:\w+,cacheWriteTokens:\w+,totalTokens:\1\+\2,/g)).toHaveLength(2);
		expect(usageModule).toContain('const{inputTokens:r,outputTokens:e,cacheReadTokens:n,cacheWriteTokens:s,reasoningTokens:i}=t');
		expect(usageModule).toContain('r+=u.inputTokens,e+=u.outputTokens,n+=u.cacheReadTokens,s+=u.cacheWriteTokens');
		expect(usageModule).toContain('void 0!==u.reasoningTokens&&(a=!0,i+=u.reasoningTokens)');
		expect(usageModule).toContain('...void 0!==i?{reasoningTokens:i}:{}');
		expect(usageModule).toContain('...a?{reasoningTokens:i}:{}');
	});

	it("retains the historical additive-transform evidence and raw capture provenance", () => {
		expect(fixture.provenance.sdkPackage).toBe("@cursor/sdk");
		expect(fixture.provenance.sdkVersion).toBe("1.0.37");
		expect(fixture.provenance.issue).toContain("/issues/196");
		expect(fixture.provenance.notes).toContain("Raw turn-ended samples were captured on @cursor/sdk 1.0.23. The published TokenUsage transform was rechecked against 1.0.37.");
		expect(fixture.installedSdkPublishedTransform.totalTokensFormula).toBe(
			"inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens",
		);

		const [first, second] = fixture.observedRawTurnEnded;
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		expect(second!.usage.inputTokens - first!.usage.inputTokens).toBe(
			fixture.runtimeDivergenceEvidence.inputTokensDeltaTurn1ToTurn2,
		);
		expect(second!.usage.cacheReadTokens - first!.usage.cacheReadTokens).toBe(
			fixture.runtimeDivergenceEvidence.cacheReadDeltaTurn1ToTurn2,
		);
		// Partition proof: cache fields fit inside raw inputTokens; input does not collapse when cacheRead appears.
		for (const sample of fixture.observedRawTurnEnded) {
			const { inputTokens, cacheReadTokens, cacheWriteTokens } = sample.usage;
			expect(cacheReadTokens + cacheWriteTokens).toBeLessThanOrEqual(inputTokens);
		}
		expect(second!.usage.inputTokens).toBeGreaterThan(second!.usage.cacheWriteTokens);
	});

	it("maps historical raw turn-ended.usage with full-prompt partition semantics, not the old additive total", () => {
		const model = makeModel();
		const context: Context = {
			systemPrompt: "Be helpful.",
			messages: [{ role: "user", content: "Reply with exactly: A", timestamp: 1 }],
		};

		expect(fixture.observedRawTurnEnded).toHaveLength(fixture.expectedPiMappingFromRawTurnEnded.length);
		for (const [index, sample] of fixture.observedRawTurnEnded.entries()) {
			const update = { type: "turn-ended", usage: sample.usage };
			expect(TurnEndedUpdateSchema.safeParse(update).success).toBe(true);
			const turn = readCursorSdkTurnUsageFromUpdate(update);
			expect(turn).toEqual(sample.usage);
			expect(isCursorSdkUsageSafeForPiMessage(turn!, model)).toBe(true);

			const partial = makeAssistantMessage();
			applyCursorUsage(partial, model, context, 7, { runtime: "local", turn: turn! });
			expect(partial.usage).toMatchObject(fixture.expectedPiMappingFromRawTurnEnded[index]!);
			expect(
				partial.usage.input + partial.usage.cacheRead + partial.usage.cacheWrite + partial.usage.output,
			).toBe(partial.usage.totalTokens);
			// Reject the historical 1.0.37 additive total. The installed 1.3.1 total agrees with Pi.
			const publishedAdditiveTotal =
				sample.usage.inputTokens +
				sample.usage.outputTokens +
				sample.usage.cacheReadTokens +
				sample.usage.cacheWriteTokens;
			expect(partial.usage.totalTokens).not.toBe(publishedAdditiveTotal);
			expect(partial.usage.totalTokens).toBe(sample.usage.inputTokens + sample.usage.outputTokens);
		}
	});
});
