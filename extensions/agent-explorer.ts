import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, resolve } from "node:path";

type ResourceSource = { source: string; scope: string; path: string };

type ExplorerExtension = {
	sourceInfo: ResourceSource;
	tools: string[];
	commands: string[];
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
	return sourceInfo.source === "builtin" || sourceInfo.source === "sdk"
		? sourceInfo.source
		: sourceInfo.path;
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
	let directory = dirname(sourcePath);
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
			extension = { sourceInfo, tools: [], commands: [] };
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

async function createExplorerSnapshot(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<string> {
	const options = ctx.getSystemPromptOptions();
	const root = join(getAgentDir(), "cache", "agent-explorer", stamp());
	const skillsDir = join(root, "Skills");
	const extensionsDir = join(root, "Extensions");
	const commandsDir = join(root, "Commands");
	const contextDir = join(root, "Context");
	await Promise.all([root, skillsDir, extensionsDir, commandsDir, contextDir].map((path) => mkdir(path, { recursive: true })));

	const tools = pi.getAllTools();
	const activeTools = new Set(pi.getActiveTools());
	const commands = pi.getCommands().filter((command) => command.source === "extension");
	const extensions = inferExtensions(pi);
	const sessionDirectory = ctx.sessionManager.getSessionDir();
	const sessionFile = ctx.sessionManager.getSessionFile();
	const contextUsage = renderContextUsage(pi, ctx);

	await writeSnapshot(
		join(root, "README.md"),
		`# Pi Agent Explorer\n\nSnapshot: ${new Date().toISOString()}\n\n- Model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown"}\n- CWD: ${pathLink(ctx.cwd, "project directory")}\n- Active tools: ${activeTools.size}/${tools.length}\n- Skills: ${(options.skills ?? []).length}\n- Extensions: ${extensions.length}\n- Extension commands: ${commands.length}\n- Context files: ${(options.contextFiles ?? []).length}\n\n## Session\n\n- **Sessions folder:** ${pathLink(sessionDirectory, "sessions folder")}\n- **Current session file:** ${sessionFile ? pathLink(sessionFile, "current session") : "ephemeral (not saved)"}\n\n## Context Usage\n\n\`\`\`text\n${contextUsage}\n\`\`\`\n\nThis is a runtime snapshot. Extension and command files are generated metadata; skill and context files link to their loaded source. Tools are grouped under the extension that provides them. Neovim launches in read-only mode.\n`,
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

	const extensionNameCounts = new Map<string, number>();
	for (const extension of extensions) {
		const name = extensionName(extension.sourceInfo);
		const count = (extensionNameCounts.get(name) ?? 0) + 1;
		extensionNameCounts.set(name, count);
		const directoryName = safeName(count === 1 ? name : `${name}-${count}`);
		const extensionDir = join(extensionsDir, directoryName);
		const extensionToolsDir = join(extensionDir, "Tools");
		await mkdir(extensionToolsDir, { recursive: true });

		const readme =
			extension.sourceInfo.source === "builtin" || extension.sourceInfo.source === "sdk"
				? undefined
				: await projectReadme(extension.sourceInfo.path);
		await writeSnapshot(
			join(extensionDir, "README.md"),
			`# ${name}\n\n- Source: ${pathLink(extension.sourceInfo.path)}\n- Scope: ${extension.sourceInfo.scope}\n- Tools: ${extension.tools.length ? extension.tools.join(", ") : "(none)"}\n- Commands: ${extension.commands.length ? extension.commands.map((name) => `/${name}`).join(", ") : "(none)"}\n\n## Project README\n\n${readme ? `Source: ${pathLink(readme.path)}\n\n${readme.content}` : "(No project README available for this provider.)"}\n`,
		);

		for (const toolName of extension.tools) {
			const tool = tools.find((candidate) => candidate.name === toolName);
			if (!tool) continue;
			await writeSnapshot(
				join(extensionToolsDir, `${safeName(tool.name)}.md`),
				`# ${tool.name}\n\n- Active: ${activeTools.has(tool.name) ? "yes" : "no"}\n- Source: ${tool.sourceInfo.source}\n- Scope: ${tool.sourceInfo.scope}\n- Path: ${pathLink(tool.sourceInfo.path)}\n\n## Description\n\n${tool.description ?? "(none)"}\n\n## Parameters\n\n\`\`\`json\n${JSON.stringify(tool.parameters ?? {}, null, 2)}\n\`\`\`\n`,
			);
		}
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
