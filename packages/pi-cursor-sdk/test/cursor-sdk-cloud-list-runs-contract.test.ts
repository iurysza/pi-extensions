import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Agent } from "@cursor/sdk";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type ListedCloudRun = Awaited<ReturnType<typeof Agent.listRuns>>["items"][number];

function listedRunId(run: ListedCloudRun): string {
	return run.id;
}

describe("installed Cursor SDK cloud listRuns contract", () => {
	it("returns Run objects with exact IDs for cancel-lane recovery", () => {
		const sdkDist = dirname(require.resolve("@cursor/sdk"));
		const declaration = readFileSync(join(sdkDist, "stubs.d.ts"), "utf8");
		expect(declaration).toMatch(/static listRuns\(agentId: string, options\?: ListRunsOptions\): Promise<ListResult<Run>>/);

		const cloudBundle = readdirSync(sdkDist, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
			.map((entry) => readFileSync(join(sdkDist, entry.name), "utf8"))
			.find((source) => source.includes("listCloudRuns"));
		expect(cloudBundle).toBeDefined();
		expect(cloudBundle).toMatch(/\.listRuns\(t,\{limit:e\.limit,cursor:e\.cursor\}\)/);
		expect(cloudBundle).toMatch(/items:\w+\.items\.map\(\(t=>new \w+\(\w+,t\)\)\)/);

		expect(listedRunId({ id: "run-00000000-0000-0000-0000-000000000001" } as ListedCloudRun)).toBe(
			"run-00000000-0000-0000-0000-000000000001",
		);
	});
});
