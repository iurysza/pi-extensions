import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const tempDirs: string[] = [];

afterEach(() => {
	vi.useRealTimers();
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("platform target runtime", () => {
	it("disables workspace sync on a transient SSH retry", async () => {
		vi.useFakeTimers();
		const suiteDir = mkdtempSync(join(tmpdir(), "platform-target-retry-"));
		tempDirs.push(suiteDir);
		const run = vi.fn()
			.mockResolvedValueOnce({ code: 255, signal: null, stdout: "", stderr: "ssh: connect to host example Operation timed out" })
			.mockResolvedValueOnce({ code: 0, signal: null, stdout: "ok", stderr: "" });

		const modulePath = "../scripts/platform-smoke/target-runtime.mjs";
		const { runOnLeaseWithTransientRetry } = await import(modulePath);
		const resultPromise = runOnLeaseWithTransientRetry(
			suiteDir,
			"macos",
			"lease-1",
			"echo ok",
			{ sync: true, freshSync: true },
			run,
		);
		await vi.runAllTimersAsync();

		await expect(resultPromise).resolves.toMatchObject({ code: 0, stdout: "ok" });
		expect(run).toHaveBeenCalledTimes(2);
		expect(run.mock.calls[1]?.[3]).toEqual({ sync: false, freshSync: true });
	});
});
