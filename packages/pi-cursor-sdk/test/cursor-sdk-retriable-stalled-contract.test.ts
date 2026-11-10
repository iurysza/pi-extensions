import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isCursorSdkConnectionStalledError, sanitizeCursorProviderError } from "../src/cursor-provider-errors.js";
import { readCursorSdkEsmBundleContaining, readInstalledPackageVersion } from "./helpers/installed-package.js";

interface RetriableStalledContractFixture {
	provenance: {
		sdkPackage: string;
		sdkVersion: string;
		verified: string;
		sourceFile: string;
		issues: string[];
	};
	errorShape: {
		classKind: string;
		name: string;
		message: string;
		displayInfo: {
			title: string;
			detailTemplate: string;
			isRetryable: boolean;
		};
		alsoThrows: {
			message: string;
			when: string;
		};
	};
	sourceMarkers: string[];
	syntheticStackFrame: string;
}

function makeFixtureRetriableStalledError(
	fixture: RetriableStalledContractFixture,
	message: string,
): Error & { kind: string } {
	const error = new Error(message) as Error & { kind: string };
	error.name = fixture.errorShape.name;
	error.kind = fixture.errorShape.classKind;
	error.stack = `${fixture.errorShape.name}: ${message}\n    ${fixture.syntheticStackFrame}`;
	return error;
}

const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/cursor-sdk-retriable-stalled-1.0.23.json", import.meta.url), "utf8"),
) as RetriableStalledContractFixture;

describe("installed Cursor SDK RetriableError connection-stalled contract", () => {
	it("retains the stalled-error shape in installed @cursor/sdk 1.3.1", () => {
		expect(readInstalledPackageVersion("@cursor/sdk")).toBe("1.3.1");
		const source = readCursorSdkEsmBundleContaining('get kind(){return"RetriableError"}', "Connection stalled repeatedly");
		expect(source).toContain('class Wn extends Bn{get kind(){return"RetriableError"}}');
		expect(source).toContain('get name(){return this.kind}');
		expect(source).toContain('new Wn("Connection stalled repeatedly",{cause:t,requestId:r,displayInfo:{title:"Connection stalled",detail:`The connection stalled ${_o(n)} times. Please check your network connection and try again.`,isRetryable:!0,connectCode:o}})');
		expect(source).toContain('new Wn("Connection stalled",{cause:t,requestId:r,displayInfo:{title:"Connection stalled",detail:"The connection stalled. Please try again.",isRetryable:!0,connectCode:o}})');
		// 1.3.1 still assigns code connection_stalled. The classifier uses name and kind, not this code.
		expect(source).toContain('Object.defineProperty(e,"code",{value:"connection_stalled",enumerable:!0,configurable:!0})');
	});

	it("keeps the 1.0.37 fixture provenance and error-classification regression", () => {
		expect(fixture.provenance.sdkPackage).toBe("@cursor/sdk");
		expect(fixture.provenance.sdkVersion).toBe("1.0.37");
		const messages = [fixture.errorShape.message, fixture.errorShape.alsoThrows.message] as const;
		for (const message of messages) {
			const error = makeFixtureRetriableStalledError(fixture, message);
			expect(error.name).toBe("RetriableError");
			expect(error.kind).toBe("RetriableError");
			expect(error.message).toBe(message);
			expect(isCursorSdkConnectionStalledError(error)).toBe(true);
			const sanitized = sanitizeCursorProviderError(error, "test-key");
			expect(sanitized.toLowerCase()).toContain("network error");
			expect(sanitized).not.toMatch(/stalled(?: repeatedly)?/i);
		}
	});
});
