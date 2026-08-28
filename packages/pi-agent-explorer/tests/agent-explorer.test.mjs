import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createExplorerSnapshot } from "../extensions/agent-explorer.ts";

test("writes flat tool files and cross-links their extensions", async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-agent-explorer-"));
	try {
		const sourceDir = join(temp, "source", "demo-extension");
		const sourcePath = join(sourceDir, "index.ts");
		const snapshotRoot = join(temp, "snapshot");
		await mkdir(sourceDir, { recursive: true });
		await writeFile(sourcePath, "export default function demo() {}\n");
		await writeFile(join(sourceDir, "README.md"), "# Demo extension\n");

		const sourceInfo = { source: "local", scope: "user", path: sourcePath };
		const tools = [
			{
				name: "alpha_tool",
				description: "Alpha tool",
				parameters: { type: "object", properties: { value: { type: "string" } } },
				sourceInfo,
			},
			{
				name: "beta_tool",
				description: "Beta tool",
				parameters: { type: "object", properties: {} },
				sourceInfo,
			},
		];
		const pi = {
			getAllTools: () => tools,
			getActiveTools: () => ["alpha_tool"],
			getCommands: () => [{ name: "demo", source: "extension", sourceInfo }],
		};
		const ctx = {
			cwd: temp,
			model: undefined,
			getContextUsage: () => undefined,
			getSystemPromptOptions: () => ({ skills: [], contextFiles: [] }),
			sessionManager: {
				getSessionDir: () => join(temp, "sessions"),
				getSessionFile: () => undefined,
			},
		};

		await createExplorerSnapshot(pi, ctx, snapshotRoot);

		const alpha = await readFile(join(snapshotRoot, "Tools", "alpha_tool.md"), "utf8");
		assert.match(alpha, /- Active: yes/);
		assert.match(alpha, /- Extension: \[demo-extension\]\(\.\.\/Extensions\/demo-extension\/README\.md\)/);

		const extensionTools = await readFile(
			join(snapshotRoot, "Extensions", "demo-extension", "TOOLS.md"),
			"utf8",
		);
		assert.match(extensionTools, /\[alpha_tool\]\(\.\.\/\.\.\/Tools\/alpha_tool\.md\)/);
		assert.match(extensionTools, /\[beta_tool\]\(\.\.\/\.\.\/Tools\/beta_tool\.md\)/);

		const extensionReadme = await readFile(
			join(snapshotRoot, "Extensions", "demo-extension", "README.md"),
			"utf8",
		);
		assert.match(extensionReadme, /- Tools: \[2\]\(TOOLS\.md\)/);
		assert.match(extensionReadme, /# Demo extension/);

		await assert.rejects(stat(join(snapshotRoot, "Extensions", "demo-extension", "Tools")), {
			code: "ENOENT",
		});
		assert.match(
			await readFile(join(snapshotRoot, "README.md"), "utf8"),
			/Tool metadata lives in the top-level Tools folder/,
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});
