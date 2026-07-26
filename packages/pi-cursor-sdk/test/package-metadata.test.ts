import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { describe, expect, it } from "vitest";
import { FALLBACK_MODEL_ITEMS } from "../src/cursor-fallback-models.generated.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as {
	version: string;
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
	bundledDependencies?: string[];
	overrides?: Record<string, string>;
};
const packageLock = require("../package-lock.json") as {
	version: string;
	packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
};

const PI_PACKAGES = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
] as const;

function lockPackageVersion(packageName: string): string | undefined {
	return packageLock.packages[`node_modules/${packageName}`]?.version;
}

describe("package metadata cutover baselines", () => {
	it("keeps package, lockfile, and changelog release versions aligned", () => {
		const changelogVersion = readFileSync(join(process.cwd(), "CHANGELOG.md"), "utf8").match(/^## (\S+) /m)?.[1];

		expect(packageLock.version).toBe(packageJson.version);
		expect(packageLock.packages[""]?.version).toBe(packageJson.version);
		expect(changelogVersion).toBe(packageJson.version);
	});

	it("pins Cursor SDK exactly", () => {
		expect(packageJson.dependencies["@cursor/sdk"]).toBe("1.0.23");
		expect(lockPackageVersion("@cursor/sdk")).toBe("1.0.23");
	});

	it("keeps local agent ID policy aligned with the installed public string contract", () => {
		const sdkOptions = readFileSync(join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/options.d.ts"), "utf8");

		expect(sdkOptions).toMatch(/export interface AgentOptions[\s\S]*?\bagentId\?: string;/);
	});

	it("pins the Node ConnectRPC transport required by Cursor SDK's Node seam", () => {
		const sdkTransportDts = readFileSync(
			join(process.cwd(), "node_modules/@cursor/sdk/dist/esm/transport.d.ts"),
			"utf8",
		);

		expect(sdkTransportDts).toContain("Node");
		expect(sdkTransportDts).toContain("`@connectrpc/connect-node`");
		expect(packageLock.packages["node_modules/@cursor/sdk"]?.dependencies?.["@connectrpc/connect-node"]).toBe("^1.6.1");
		expect(packageJson.dependencies["@connectrpc/connect-node"]).toBeUndefined();
		expect(lockPackageVersion("@connectrpc/connect-node")).toBe("1.7.0");
	});

	it("keeps installed ConnectRPC transport siblings aligned", () => {
		expect(lockPackageVersion("@connectrpc/connect-node")).toBe("1.7.0");
		expect(lockPackageVersion("@connectrpc/connect-web")).toBe("1.7.0");
	});

	it("leaves the Cursor SDK transport dependency tree to npm resolution", () => {
		expect(packageJson.dependencies.undici).toBeUndefined();
		expect(packageJson.bundledDependencies).toBeUndefined();
		expect(packageJson.overrides).toBeUndefined();
		expect(packageLock.packages["node_modules/@connectrpc/connect-node/node_modules/undici"]?.version).toBe("5.29.0");
	});

	it("removes the obsolete sqlite override", () => {
		expect(packageJson.overrides?.sqlite3).toBeUndefined();
	});

	it("pins pi validation baselines", () => {
		for (const packageName of PI_PACKAGES) {
			expect(packageJson.devDependencies[packageName]).toBe("0.80.9");
			expect(lockPackageVersion(packageName)).toBe("0.80.9");
		}
	});

	it("tracks Pi 0.80.9 GPT-5.6 Codex metadata", () => {
		for (const modelId of ["gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra"] as const) {
			expect(OPENAI_CODEX_MODELS[modelId]).toMatchObject({
				contextWindow: 372000,
				maxTokens: 128000,
				thinkingLevelMap: { xhigh: "xhigh", max: "max", minimal: "low" },
			});
		}
	});

	it("keeps Grok UX examples aligned with the generated Cursor catalog", () => {
		const spec = readFileSync(join(process.cwd(), "docs/cursor-model-ux-spec.md"), "utf8");
		const grok = FALLBACK_MODEL_ITEMS.find((item) => item.id === "grok-4.5");

		expect(grok?.parameters?.map((parameter) => parameter.id)).toEqual(["effort", "fast"]);
		expect(FALLBACK_MODEL_ITEMS.some((item) => item.id === "grok-4.3")).toBe(false);
		expect(spec).toContain("### `grok-4.5`");
		expect(spec).not.toContain("grok-4.3");
	});

	it("keeps @earendil-works peer dependency ranges unpinned per pi package guidance", () => {
		for (const packageName of PI_PACKAGES) {
			expect(packageJson.peerDependencies[packageName]).toBe("*");
		}
	});
});
