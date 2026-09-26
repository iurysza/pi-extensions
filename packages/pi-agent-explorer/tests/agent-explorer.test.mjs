import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createExplorerSnapshot } from "../extensions/agent-explorer.ts";
import {
	discoverExtensionSources,
	findLiteralPiEventHooks,
	scanExtensionEventHooks,
} from "../extensions/extension-events.ts";

test("writes flat tool files and cross-links their extensions", async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-agent-explorer-"));
	try {
		const sourceDir = join(temp, "source", "demo-extension");
		const sourcePath = join(sourceDir, "index.ts");
		const observerDir = join(temp, "source", "observer-extension");
		const observerPath = join(observerDir, "index.ts");
		const snapshotRoot = join(temp, "snapshot");
		await Promise.all([
			mkdir(sourceDir, { recursive: true }),
			mkdir(observerDir, { recursive: true }),
		]);
		await writeFile(
			sourcePath,
			'import { registerEvents } from "./events.ts";\nexport default function demo(pi) { registerEvents(pi); pi.on("tool_call", () => {}); }\n',
		);
		await writeFile(
			join(sourceDir, "events.ts"),
			'export function registerEvents(pi) {\n  pi.on("session_start", () => {});\n  // pi.on("tool_result", () => {});\n  const example = \'pi.on("message_end", () => {})\';\n}\n',
		);
		await writeFile(join(sourceDir, "README.md"), "# Demo extension\n");
		await writeFile(
			observerPath,
			'export default function observer(pi) { pi.on("agent_end", () => {}); }\n',
		);

		const sourceInfo = { source: "local", scope: "user", path: sourcePath };
		const observerSourceInfo = { source: "local", scope: "user", path: observerPath };
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

		await createExplorerSnapshot(pi, ctx, snapshotRoot, {
			extensionSources: [sourceInfo, observerSourceInfo],
		});

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
		assert.match(extensionReadme, /- Events: \[2\]\(EVENTS\.md\)/);
		assert.match(extensionReadme, /# Demo extension/);

		const extensionEvents = await readFile(
			join(snapshotRoot, "Extensions", "demo-extension", "EVENTS.md"),
			"utf8",
		);
		assert.match(extensionEvents, /\[session_start\]\(\.\.\/\.\.\/Events\/session_start\.md\)/);
		assert.match(extensionEvents, /events\.ts\):2/);
		assert.match(extensionEvents, /\[tool_call\]\(\.\.\/\.\.\/Events\/tool_call\.md\)/);

		const observerReadme = await readFile(
			join(snapshotRoot, "Extensions", "observer-extension", "README.md"),
			"utf8",
		);
		assert.match(observerReadme, /- Tools: \[0\]\(TOOLS\.md\)/);
		assert.match(observerReadme, /- Events: \[1\]\(EVENTS\.md\)/);
		assert.match(observerReadme, /- Commands: \(none\)/);

		const sessionStart = await readFile(join(snapshotRoot, "Events", "session_start.md"), "utf8");
		assert.match(sessionStart, /\[demo-extension\]\(\.\.\/Extensions\/demo-extension\/README\.md\)/);
		assert.match(sessionStart, /events\.ts\):2/);
		const agentEnd = await readFile(join(snapshotRoot, "Events", "agent_end.md"), "utf8");
		assert.match(agentEnd, /\[observer-extension\]/);
		await assert.rejects(stat(join(snapshotRoot, "Events", "tool_result.md")), { code: "ENOENT" });
		await assert.rejects(stat(join(snapshotRoot, "Events", "message_end.md")), { code: "ENOENT" });

		await assert.rejects(stat(join(snapshotRoot, "Extensions", "demo-extension", "Tools")), {
			code: "ENOENT",
		});
		const snapshotReadme = await readFile(join(snapshotRoot, "README.md"), "utf8");
		assert.match(snapshotReadme, /Tool metadata lives in the top-level Tools folder/);
		assert.match(snapshotReadme, /- Event subscriptions: 3/);
		assert.match(snapshotReadme, /- Events observed: 3/);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("finds hooks after regexes and nested template literals", () => {
	const source = [
		'const matcher = /["\']/;',
		'const text = `outer ${items.map((item) => `inner ${item}`)}`;',
		'pi.on("session_start", () => {});',
	].join("\n");

	assert.deepEqual(findLiteralPiEventHooks(source, "/extension.ts"), [
		{ event: "session_start", path: "/extension.ts", line: 3 },
	]);
});

test("discovers and scans symlinked profile extensions", async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-agent-explorer-symlink-"));
	try {
		const sourceDir = join(temp, "source");
		const agentExtensionsDir = join(temp, "agent", "extensions");
		const sourcePath = join(sourceDir, "profile-extension.ts");
		await Promise.all([
			mkdir(sourceDir, { recursive: true }),
			mkdir(agentExtensionsDir, { recursive: true }),
		]);
		await writeFile(
			sourcePath,
			'import { register } from "./register.ts";\nexport default function extension(pi) { register(pi); }\n',
		);
		await writeFile(join(sourceDir, "register.ts"), 'export function register(pi) { pi.on("input", () => {}); }\n');
		const linkedPath = join(agentExtensionsDir, "profile-extension.ts");
		await symlink(sourcePath, linkedPath);

		const discovered = await discoverExtensionSources([], {
			agentDir: join(temp, "agent"),
			cwd: temp,
			projectTrusted: false,
			argv: [],
		});
		assert.deepEqual(discovered.map(({ path }) => path), [linkedPath]);
		assert.deepEqual(await scanExtensionEventHooks(discovered[0].path), [
			{ event: "input", path: await realpath(join(sourceDir, "register.ts")), line: 1 },
		]);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("uses resolved package extension settings instead of every manifest sibling", async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-agent-explorer-settings-"));
	try {
		const agentDir = join(temp, "agent");
		const packageDir = join(agentDir, "git", "github.com", "example", "extensions");
		const seedPath = join(packageDir, "index.ts");
		const observerPath = join(packageDir, "observer.ts");
		await mkdir(packageDir, { recursive: true });
		await writeFile(seedPath, 'export default function seed(pi) { pi.on("session_start", () => {}); }\n');
		await writeFile(observerPath, "export default function observer() {}\n");
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({ pi: { extensions: ["./index.ts", "./observer.ts"] } }),
		);
		await writeFile(
			join(agentDir, "settings.json"),
			JSON.stringify({
				packages: [{
					source: "git:github.com/example/extensions@abc123",
					extensions: ["index.ts"],
				}],
			}),
		);

		const discovered = await discoverExtensionSources(
			[],
			{
				agentDir,
				cwd: temp,
				projectTrusted: false,
				argv: [],
			},
		);

		assert.deepEqual(discovered.map(({ path }) => path), [seedPath]);
		assert.deepEqual(await scanExtensionEventHooks(discovered[0].path), [
			{ event: "session_start", path: await realpath(seedPath), line: 1 },
		]);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});

test("discovers sibling extension entrypoints from Pi package manifests", async () => {
	const temp = await mkdtemp(join(tmpdir(), "pi-agent-explorer-discovery-"));
	try {
		const packageDir = join(temp, "package");
		const seedPath = join(packageDir, "seed.ts");
		const observerPath = join(packageDir, "observer.ts");
		await mkdir(packageDir, { recursive: true });
		await writeFile(seedPath, "export default function seed() {}\n");
		await writeFile(observerPath, "export default function observer() {}\n");
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({ pi: { extensions: ["./seed.ts", "./observer.ts"] } }),
		);

		const discovered = await discoverExtensionSources(
			[{ source: "git", scope: "user", path: seedPath }],
			{
				agentDir: join(temp, "agent"),
				cwd: temp,
				projectTrusted: false,
				argv: [],
			},
		);

		assert.deepEqual(
			discovered.map(({ path }) => path).sort(),
			[observerPath, seedPath].sort(),
		);
	} finally {
		await rm(temp, { recursive: true, force: true });
	}
});
