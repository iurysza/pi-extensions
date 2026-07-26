import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { redact } from "../../extensions/handoff/redact.ts";

const packageRoot = resolve(import.meta.dirname, "../..");
const handoffEntry = resolve(packageRoot, "extensions/handoff/index.ts");

describe("handoff dependency contract", () => {
	it("pins and loads the internal modules shipped by its dependencies", async () => {
		const manifest = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
		assert.equal(manifest.dependencies["@sting8k/pi-vcc"], "0.3.18");
		assert.equal(manifest.dependencies["@tintinweb/pi-tasks"], "0.4.3");

		const agentDir = await mkdtemp(join(tmpdir(), "pi-ext-handoff-loader-"));
		try {
			const loaded = await discoverAndLoadExtensions([handoffEntry], packageRoot, agentDir);
			assert.deepEqual(loaded.errors, []);
			assert.equal(loaded.extensions.length, 1);
			assert.equal(loaded.extensions[0]?.resolvedPath, handoffEntry);
			assert.ok(loaded.extensions[0]?.commands.has("handoff"));
		} finally {
			await rm(agentDir, { recursive: true, force: true });
		}
	});

	it("retains the removed upstream secret redaction behavior locally", () => {
		const input = "password=hunter2 api_key: abc123 secret=hidden token=abcdefgh -i deploy.pem";
		assert.equal(
			redact(input),
			"password [REDACTED] api_key [REDACTED] secret [REDACTED] token [REDACTED] -i [REDACTED]",
		);
		assert.equal(redact("ordinary handoff text"), "ordinary handoff text");
	});
});
