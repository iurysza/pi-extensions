import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { chmod, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

import {
	discoverExtensionSources,
	scanExtensionEventHooks,
	type EventHook,
	type ResourceSource,
} from "./extension-events.ts";

type ExplorerExtension = {
	sourceInfo: ResourceSource;
	tools: string[];
	commands: string[];
	events: EventHook[];
};

type NamedExplorerExtension = ExplorerExtension & {
	name: string;
	directoryName: string;
};

function safeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function stamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function pathLink(path: string, alias = basename(path) || path): string {
	return `[${alias}](${path})`;
}

function sourceKey(sourceInfo: ResourceSource): string {
	if (sourceInfo.source === "builtin" || sourceInfo.source === "sdk") return sourceInfo.source;
	if (sourceInfo.path.startsWith("<")) return `${sourceInfo.source}:${sourceInfo.path}`;
	return resolve(sourceInfo.path);
}

function extensionName(sourceInfo: ResourceSource): string {
	if (sourceInfo.source === "builtin" || sourceInfo.source === "sdk") return sourceInfo.source;

	const packageMatch = sourceInfo.path.match(/\/node_modules\/((?:@[^/]+\/)?[^/]+)/);
	if (packageMatch) return packageMatch[1].replace(/^@/, "").replace("/", "-");

	const fileName = basename(sourceInfo.path).replace(/\.(?:[cm]?[jt]sx?)$/, "");
	if (fileName !== "index") return fileName;

	const parent = basename(dirname(sourceInfo.path));
	if (!new Set(["src", "extension", "extensions", "pi-extension"]).has(parent)) return parent;
	return basename(dirname(dirname(sourceInfo.path)));
}

async function projectReadme(sourcePath: string): Promise<{ path: string; content: string } | undefined> {
	const sourceIsDirectory = await stat(sourcePath).then((entry) => entry.isDirectory()).catch(() => false);
	let directory = sourceIsDirectory ? sourcePath : dirname(sourcePath);
	for (let depth = 0; depth < 12; depth += 1) {
		for (const fileName of ["README.md", "README.MD", "readme.md"]) {
			const path = join(directory, fileName);
			try {
				return { path, content: await readFile(path, "utf8") };
			} catch {
				// Try the next README name or parent directory.
			}
		}
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return undefined;
}

function fmtTokens(tokens: number): string {
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return tokens.toString();
}

function renderContextUsage(pi: ExtensionAPI, ctx: ExtensionCommandContext): string {
	const usage = ctx.getContextUsage();
	if (!usage || !ctx.model) return "Context usage is unavailable until Pi completes a model turn.";

	const contextWindow = usage.contextWindow;
	const usedTokens = usage.tokens ?? 0;
	const systemPromptTokens = Math.ceil(ctx.getSystemPrompt().length / 4);
	const activeNames = new Set(pi.getActiveTools());
	const toolTokens = pi
		.getAllTools()
		.filter((tool) => activeNames.has(tool.name))
		.reduce((total, tool) => {
			const chars = tool.name.length + (tool.description ?? "").length + JSON.stringify(tool.parameters ?? {}).length;
			return total + Math.ceil(chars / 4);
		}, 0);
	const messageTokens = Math.max(0, usedTokens - systemPromptTokens - toolTokens);
	const bufferTokens = ctx.model.maxTokens ?? 0;
	const freeTokens = Math.max(0, contextWindow - usedTokens - bufferTokens);
	const cellCount = 88;
	const cellsFor = (tokens: number) => Math.round((tokens / contextWindow) * cellCount);
	const systemCells = Math.max(systemPromptTokens > 0 ? 1 : 0, cellsFor(systemPromptTokens));
	const toolCells = Math.max(toolTokens > 0 ? 1 : 0, cellsFor(toolTokens));
	const messageCells = Math.max(messageTokens > 0 ? 1 : 0, cellsFor(messageTokens));
	let bufferCells = Math.max(bufferTokens > 0 ? 1 : 0, cellsFor(bufferTokens));
	const freeCells = cellCount - systemCells - toolCells - messageCells - bufferCells;
	if (freeCells < 0) bufferCells = Math.max(0, bufferCells + freeCells);
	const cells = [
		...Array(systemCells).fill("◍"),
		...Array(toolCells).fill("⚙"),
		...Array(messageCells).fill("●"),
		...Array(Math.max(0, freeCells)).fill("·"),
		...Array(bufferCells).fill("○"),
	];
	while (cells.length < cellCount) cells.splice(cells.length - bufferCells, 0, "·");
	while (cells.length > cellCount) cells.pop();

	const grid = Array.from({ length: 8 }, (_, row) => cells.slice(row * 11, row * 11 + 11).join(" ")).join("\n");
	const percent = usage.percent === null ? "?" : Math.round(usage.percent);
	const pct = (tokens: number) => (contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0);
	return `Context Usage\n\n${grid}\n\n${ctx.model.id}   ${fmtTokens(usedTokens)} / ${fmtTokens(contextWindow)} tokens (${percent}%)\n\n◍ System Prompt: ${fmtTokens(systemPromptTokens).padStart(7)} (${pct(systemPromptTokens)}%)\n⚙ Tools:         ${fmtTokens(toolTokens).padStart(7)} (${pct(toolTokens)}%)\n● Messages:      ${fmtTokens(messageTokens).padStart(7)} (${pct(messageTokens)}%)\n· Empty:         ${fmtTokens(freeTokens).padStart(7)} (${pct(freeTokens)}%)\n○ Buffer:        ${fmtTokens(bufferTokens).padStart(7)} (${pct(bufferTokens)}%)`;
}

function inferExtensions(pi: ExtensionAPI): ExplorerExtension[] {
	const extensions = new Map<string, ExplorerExtension>();
	const ensure = (sourceInfo: ResourceSource) => {
		const key = sourceKey(sourceInfo);
		let extension = extensions.get(key);
		if (!extension) {
			extension = { sourceInfo, tools: [], commands: [], events: [] };
			extensions.set(key, extension);
		}
		return extension;
	};

	for (const tool of pi.getAllTools()) {
		ensure(tool.sourceInfo).tools.push(tool.name);
	}
	for (const command of pi.getCommands()) {
		if (command.source !== "extension") continue;
		ensure(command.sourceInfo).commands.push(command.name);
	}

	return Array.from(extensions.values());
}

async function collectExtensions(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	explicitSources?: readonly ResourceSource[],
): Promise<ExplorerExtension[]> {
	const inferred = inferExtensions(pi);
	const extensions = new Map(inferred.map((extension) => [sourceKey(extension.sourceInfo), extension]));
	const sources = explicitSources ?? await discoverExtensionSources(
		inferred.map((extension) => extension.sourceInfo),
		{
			agentDir: getAgentDir(),
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		},
	);

	for (const sourceInfo of sources) {
		const key = sourceKey(sourceInfo);
		if (!extensions.has(key)) {
			extensions.set(key, { sourceInfo, tools: [], commands: [], events: [] });
		}
	}

	await Promise.all(Array.from(extensions.values()).map(async (extension) => {
		extension.events = await scanExtensionEventHooks(extension.sourceInfo.path);
	}));
	return Array.from(extensions.values());
}

function nameExtensions(extensions: ExplorerExtension[]): NamedExplorerExtension[] {
	const counts = new Map<string, number>();
	return extensions.map((extension) => {
		const name = extensionName(extension.sourceInfo);
		const count = (counts.get(name) ?? 0) + 1;
		counts.set(name, count);
		return {
			...extension,
			name,
			directoryName: safeName(count === 1 ? name : `${name}-${count}`),
		};
	});
}

type EventSubscription = {
	extension: NamedExplorerExtension;
	hook: EventHook;
};

function groupHooksByEvent(hooks: readonly EventHook[]): Map<string, EventHook[]> {
	const grouped = new Map<string, EventHook[]>();
	for (const hook of hooks) {
		const eventHooks = grouped.get(hook.event) ?? [];
		eventHooks.push(hook);
		grouped.set(hook.event, eventHooks);
	}
	return new Map(Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)));
}

function groupSubscriptionsByEvent(
	extensions: readonly NamedExplorerExtension[],
): Map<string, EventSubscription[]> {
	const grouped = new Map<string, EventSubscription[]>();
	for (const extension of extensions) {
		for (const hook of extension.events) {
			const subscriptions = grouped.get(hook.event) ?? [];
			subscriptions.push({ extension, hook });
			grouped.set(hook.event, subscriptions);
		}
	}
	for (const subscriptions of grouped.values()) {
		subscriptions.sort((left, right) =>
			left.extension.name.localeCompare(right.extension.name)
			|| left.hook.path.localeCompare(right.hook.path)
			|| left.hook.line - right.hook.line,
		);
	}
	return new Map(Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right)));
}

function sourceLocation(hook: EventHook): string {
	return `${pathLink(hook.path, basename(hook.path))}:${hook.line}`;
}

function renderExtensionEvents(extension: NamedExplorerExtension): string {
	const grouped = groupHooksByEvent(extension.events);
	if (grouped.size === 0) return `# ${extension.name} events\n\n(none)\n`;

	const sections = Array.from(grouped.entries()).map(([event, hooks]) =>
		`## [${event}](../../Events/${safeName(event)}.md)\n\n${hooks.map((hook) => `- ${sourceLocation(hook)}`).join("\n")}`,
	);
	return `# ${extension.name} events\n\n${sections.join("\n\n")}\n`;
}

async function writeSnapshot(path: string, content: string): Promise<void> {
	await writeFile(path, content, "utf8");
	await chmod(path, 0o444);
}

async function linkSnapshot(path: string, target: string): Promise<void> {
	try {
		await symlink(target, path);
	} catch {
		await writeSnapshot(path, `Source file: ${pathLink(target)}\n`);
	}
}

type ExplorerSnapshotOptions = {
	extensionSources?: readonly ResourceSource[];
};

export async function createExplorerSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	root = join(getAgentDir(), "cache", "agent-explorer", stamp()),
	snapshotOptions: ExplorerSnapshotOptions = {},
): Promise<string> {
	const options = ctx.getSystemPromptOptions();
	const skillsDir = join(root, "Skills");
	const extensionsDir = join(root, "Extensions");
	const eventsDir = join(root, "Events");
	const toolsDir = join(root, "Tools");
	const commandsDir = join(root, "Commands");
	const contextDir = join(root, "Context");
	await Promise.all([root, skillsDir, extensionsDir, eventsDir, toolsDir, commandsDir, contextDir]
		.map((path) => mkdir(path, { recursive: true })));

	const tools = pi.getAllTools();
	const activeTools = new Set(pi.getActiveTools());
	const commands = pi.getCommands().filter((command) => command.source === "extension");
	const extensions = nameExtensions(await collectExtensions(pi, ctx, snapshotOptions.extensionSources));
	const extensionsBySource = new Map(extensions.map((extension) => [sourceKey(extension.sourceInfo), extension]));
	const eventSubscriptions = groupSubscriptionsByEvent(extensions);
	const eventSubscriptionCount = Array.from(eventSubscriptions.values())
		.reduce((total, subscriptions) => total + subscriptions.length, 0);
	const sessionDirectory = ctx.sessionManager.getSessionDir();
	const sessionFile = ctx.sessionManager.getSessionFile();
	const contextUsage = renderContextUsage(pi, ctx);

	await writeSnapshot(
		join(root, "README.md"),
		`# Pi Agent Explorer\n\nSnapshot: ${new Date().toISOString()}\n\n- Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown"}\n- CWD: ${pathLink(ctx.cwd, "project directory")}\n- Active tools: ${activeTools.size}/${tools.length}\n- Skills: ${(options.skills ?? []).length}\n- Extensions: ${extensions.length}\n- Event subscriptions: ${eventSubscriptionCount}\n- Events observed: ${eventSubscriptions.size}\n- Extension commands: ${commands.length}\n- Context files: ${(options.contextFiles ?? []).length}\n\n## Session\n\n- **Sessions folder:** ${pathLink(sessionDirectory, "sessions folder")}\n- **Current session file:** ${sessionFile ? pathLink(sessionFile, "current session") : "ephemeral (not saved)"}\n\n## Context Usage\n\n\`\`\`text\n${contextUsage}\n\`\`\`\n\nThis is a runtime snapshot. Tool metadata lives in the top-level Tools folder, and each extension links to the tools and events it provides. Event metadata is source-derived from literal \`pi.on(...)\` registrations reachable from discovered extension entry points. Dynamic event names or aliased API variables may not appear. Extension and command files are generated metadata; skill and context files link to their loaded source. Neovim launches in read-only mode.\n`,
	);

	for (const skill of options.skills ?? []) {
		const dir = join(skillsDir, safeName(skill.name));
		await mkdir(dir, { recursive: true });
		await linkSnapshot(join(dir, "SKILL.md"), skill.filePath);
		await writeSnapshot(
			join(dir, "README.md"),
			`# ${skill.name}\n\n${skill.description ?? "(no description)"}\n\n- Source: ${pathLink(skill.filePath)}\n- Model invocation: ${skill.disableModelInvocation ? "disabled" : "enabled"}\n`,
		);
	}

	for (const extension of extensions) {
		const extensionDir = join(extensionsDir, extension.directoryName);
		await mkdir(extensionDir, { recursive: true });

		const readme =
			extension.sourceInfo.source === "builtin" || extension.sourceInfo.source === "sdk"
				? undefined
				: await projectReadme(extension.sourceInfo.path);
		await writeSnapshot(
			join(extensionDir, "README.md"),
			`# ${extension.name}\n\n- Source: ${pathLink(extension.sourceInfo.path)}\n- Scope: ${extension.sourceInfo.scope}\n- Tools: ${pathLink("TOOLS.md", extension.tools.length.toString())}\n- Events: ${pathLink("EVENTS.md", extension.events.length.toString())}\n- Commands: ${extension.commands.length ? extension.commands.map((name) => `/${name}`).join(", ") : "(none)"}\n\n## Project README\n\n${readme ? `Source: ${pathLink(readme.path)}\n\n${readme.content}` : "(No project README available for this provider.)"}\n`,
		);
		await writeSnapshot(
			join(extensionDir, "TOOLS.md"),
			`# ${extension.name} tools\n\n${
				extension.tools.length
					? extension.tools.map((toolName) => `- [${toolName}](../../Tools/${safeName(toolName)}.md)`).join("\n")
					: "(none)"
			}\n`,
		);
		await writeSnapshot(join(extensionDir, "EVENTS.md"), renderExtensionEvents(extension));
	}

	await writeSnapshot(
		join(eventsDir, "README.md"),
		`# Events\n\nThis index is source-derived from literal \`pi.on(...)\` registrations.\n\n${
			eventSubscriptions.size
				? Array.from(eventSubscriptions.entries()).map(([event, subscriptions]) => {
					const extensionCount = new Set(subscriptions.map(({ extension }) => extension.directoryName)).size;
					return `- [${event}](${safeName(event)}.md): ${subscriptions.length} handler${subscriptions.length === 1 ? "" : "s"}, ${extensionCount} extension${extensionCount === 1 ? "" : "s"}`;
				}).join("\n")
				: "(none)"
		}\n`,
	);

	for (const [event, subscriptions] of eventSubscriptions) {
		const byExtension = new Map<string, EventSubscription[]>();
		for (const subscription of subscriptions) {
			const extensionSubscriptions = byExtension.get(subscription.extension.directoryName) ?? [];
			extensionSubscriptions.push(subscription);
			byExtension.set(subscription.extension.directoryName, extensionSubscriptions);
		}
		const sections = Array.from(byExtension.values()).map((extensionSubscriptions) => {
			const extension = extensionSubscriptions[0]?.extension;
			if (!extension) return "";
			return `## [${extension.name}](../Extensions/${extension.directoryName}/README.md)\n\n${
				extensionSubscriptions.map(({ hook }) => `- ${sourceLocation(hook)}`).join("\n")
			}`;
		});
		await writeSnapshot(
			join(eventsDir, `${safeName(event)}.md`),
			`# ${event}\n\n${sections.filter(Boolean).join("\n\n")}\n`,
		);
	}

	for (const tool of tools) {
		const extension = extensionsBySource.get(sourceKey(tool.sourceInfo));
		const extensionLink = extension
			? pathLink(`../Extensions/${extension.directoryName}/README.md`, extension.name)
			: "(unknown)";
		await writeSnapshot(
			join(toolsDir, `${safeName(tool.name)}.md`),
			`# ${tool.name}\n\n- Active: ${activeTools.has(tool.name) ? "yes" : "no"}\n- Extension: ${extensionLink}\n- Source: ${tool.sourceInfo.source}\n- Scope: ${tool.sourceInfo.scope}\n- Path: ${pathLink(tool.sourceInfo.path)}\n\n## Description\n\n${tool.description ?? "(none)"}\n\n## Parameters\n\n\`\`\`json\n${JSON.stringify(tool.parameters ?? {}, null, 2)}\n\`\`\`\n`,
		);
	}

	for (const command of commands) {
		await writeSnapshot(
			join(commandsDir, `${safeName(command.name)}.md`),
			`# /${command.name}\n\n${command.description ?? "(no description)"}\n\n- Extension: ${pathLink(command.sourceInfo.path)}\n- Scope: ${command.sourceInfo.scope}\n`,
		);
	}

	for (const [index, contextFile] of (options.contextFiles ?? []).entries()) {
		await linkSnapshot(join(contextDir, `${String(index + 1).padStart(2, "0")}-${safeName(basename(contextFile.path))}`), contextFile.path);
	}

	return root;
}

function explorerPluginRoot(): string {
	return resolve(dirname(fileURLToPath(import.meta.url)), "..", "herdr", "pi-agent-explorer");
}

async function launchExplorer(pi: ExtensionAPI, root: string): Promise<string> {
	if (process.env.HERDR_ENV === "1") {
		const pluginRoot = explorerPluginRoot();
		const openPopup = () =>
			pi.exec(
				"herdr",
				[
					"plugin",
					"pane",
					"open",
					"--plugin",
					"pi-agent-explorer",
					"--entrypoint",
					"explorer",
					"--placement",
					"popup",
					"--cwd",
					root,
					"--env",
					`HERDR_EXPLORER_ROOT=${root}`,
					"--focus",
				],
				{ timeout: 5000 },
			);

		let launched = await openPopup();
		if (launched.code !== 0) {
			const linked = await pi.exec("herdr", ["plugin", "link", pluginRoot], { timeout: 5000 });
			if (linked.code === 0) launched = await openPopup();
		}
		if (launched.code === 0) return "Herdr popup";
		throw new Error(launched.stderr || launched.stdout || "Unable to open Herdr popup");
	}

	if (process.env.TMUX) {
		const launched = await pi.exec("tmux", ["split-window", "-h", "-c", root, "nvim", "-R", root], { timeout: 5000 });
		if (launched.code === 0) return "tmux split";
	}

	const launched = await pi.exec("open", ["-na", "Ghostty.app", "--args", "-e", "nvim", "-R", root], { timeout: 5000 });
	if (launched.code === 0) return "Ghostty window";
	throw new Error(launched.stderr || "Unable to launch Neovim");
}

export default function agentExplorer(pi: ExtensionAPI) {
	pi.registerCommand("agent-explorer", {
		description: "Open loaded Pi resources in a read-only snapshot",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/agent-explorer requires interactive Pi", "error");
				return;
			}
			const root = await createExplorerSnapshot(pi, ctx);
			const target = await launchExplorer(pi, root);
			ctx.ui.notify(`Agent explorer opened in ${target}: ${root}`, "info");
		},
	});
}
