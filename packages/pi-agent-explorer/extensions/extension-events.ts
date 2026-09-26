import { DefaultPackageManager, SettingsManager } from "@earendil-works/pi-coding-agent";

import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

export type ResourceSource = {
	source: string;
	scope: string;
	path: string;
};

export type EventHook = {
	event: string;
	path: string;
	line: number;
};

export type ExtensionDiscoveryOptions = {
	agentDir: string;
	cwd: string;
	projectTrusted: boolean;
	argv?: readonly string[];
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"] as const;
const SOURCE_EXTENSION_SET = new Set<string>(SOURCE_EXTENSIONS);

function isIdentifierCharacter(character: string | undefined): boolean {
	return character !== undefined && /[a-zA-Z0-9_$]/.test(character);
}

function skipLineComment(source: string, start: number): number {
	const end = source.indexOf("\n", start + 2);
	return end === -1 ? source.length : end;
}

function skipBlockComment(source: string, start: number): number {
	const end = source.indexOf("*/", start + 2);
	return end === -1 ? source.length : end + 2;
}

function readStringLiteral(
	source: string,
	start: number,
): { value: string; end: number } | undefined {
	const quote = source[start];
	if (quote !== '"' && quote !== "'") return undefined;

	let value = "";
	for (let index = start + 1; index < source.length; index += 1) {
		const character = source[index];
		if (character === "\\") {
			const escaped = source[index + 1];
			if (escaped === undefined) return undefined;
			value += escaped;
			index += 1;
			continue;
		}
		if (character === quote) return { value, end: index + 1 };
		if (character === "\n") return undefined;
		value += character;
	}
	return undefined;
}

function skipTemplateExpression(source: string, start: number): number {
	let depth = 1;
	for (let index = start; index < source.length;) {
		if (source.startsWith("//", index)) {
			index = skipLineComment(source, index);
			continue;
		}
		if (source.startsWith("/*", index)) {
			index = skipBlockComment(source, index);
			continue;
		}
		if (source[index] === '"' || source[index] === "'") {
			index = readStringLiteral(source, index)?.end ?? index + 1;
			continue;
		}
		if (source[index] === "`") {
			index = skipTemplateLiteral(source, index);
			continue;
		}
		if (source[index] === "{") depth += 1;
		if (source[index] === "}") {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
		index += 1;
	}
	return source.length;
}

function skipTemplateLiteral(source: string, start: number): number {
	for (let index = start + 1; index < source.length;) {
		if (source[index] === "\\") {
			index += 2;
			continue;
		}
		if (source[index] === "`") return index + 1;
		if (source.startsWith("${", index)) {
			index = skipTemplateExpression(source, index + 2);
			continue;
		}
		index += 1;
	}
	return source.length;
}

function skipTrivia(source: string, start: number): number {
	let index = start;
	while (index < source.length) {
		if (/\s/.test(source[index] ?? "")) {
			index += 1;
			continue;
		}
		if (source.startsWith("//", index)) {
			index = skipLineComment(source, index);
			continue;
		}
		if (source.startsWith("/*", index)) {
			index = skipBlockComment(source, index);
			continue;
		}
		break;
	}
	return index;
}

function lineNumberAt(source: string, offset: number): number {
	let line = 1;
	for (let index = 0; index < offset; index += 1) {
		if (source[index] === "\n") line += 1;
	}
	return line;
}

export function findLiteralPiEventHooks(source: string, path: string): EventHook[] {
	const hooks: EventHook[] = [];

	for (let index = 0; index < source.length;) {
		if (source.startsWith("//", index)) {
			index = skipLineComment(source, index);
			continue;
		}
		if (source.startsWith("/*", index)) {
			index = skipBlockComment(source, index);
			continue;
		}
		if (source[index] === '"' || source[index] === "'") {
			index = readStringLiteral(source, index)?.end ?? index + 1;
			continue;
		}
		if (source[index] === "`") {
			index = skipTemplateLiteral(source, index);
			continue;
		}

		if (
			source.startsWith("pi", index)
			&& !isIdentifierCharacter(source[index - 1])
			&& !isIdentifierCharacter(source[index + 2])
		) {
			let cursor = skipTrivia(source, index + 2);
			if (source[cursor] === ".") {
				cursor = skipTrivia(source, cursor + 1);
				if (
					source.startsWith("on", cursor)
					&& !isIdentifierCharacter(source[cursor - 1])
					&& !isIdentifierCharacter(source[cursor + 2])
				) {
					cursor = skipTrivia(source, cursor + 2);
					if (source[cursor] === "(") {
						cursor = skipTrivia(source, cursor + 1);
						const event = readStringLiteral(source, cursor);
						if (event) {
							hooks.push({ event: event.value, path, line: lineNumberAt(source, index) });
						}
					}
				}
			}
		}
		index += 1;
	}

	return hooks;
}

type LexicalToken =
	| { kind: "identifier"; value: string }
	| { kind: "string"; value: string }
	| { kind: "punctuation"; value: string };

function lexicalTokens(source: string): LexicalToken[] {
	const tokens: LexicalToken[] = [];

	for (let index = 0; index < source.length;) {
		if (/\s/.test(source[index] ?? "")) {
			index += 1;
			continue;
		}
		if (source.startsWith("//", index)) {
			index = skipLineComment(source, index);
			continue;
		}
		if (source.startsWith("/*", index)) {
			index = skipBlockComment(source, index);
			continue;
		}
		if (source[index] === '"' || source[index] === "'") {
			const literal = readStringLiteral(source, index);
			if (!literal) {
				index += 1;
				continue;
			}
			tokens.push({ kind: "string", value: literal.value });
			index = literal.end;
			continue;
		}
		if (source[index] === "`") {
			index = skipTemplateLiteral(source, index);
			continue;
		}
		if (isIdentifierCharacter(source[index])) {
			const start = index;
			while (isIdentifierCharacter(source[index])) index += 1;
			tokens.push({ kind: "identifier", value: source.slice(start, index) });
			continue;
		}
		tokens.push({ kind: "punctuation", value: source[index] ?? "" });
		index += 1;
	}

	return tokens;
}

function relativeImportSpecifiers(source: string): string[] {
	const tokens = lexicalTokens(source);
	const specifiers: string[] = [];

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token?.kind !== "identifier" || !new Set(["import", "export", "require"]).has(token.value)) continue;

		for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
			const candidate = tokens[cursor];
			if (candidate?.kind === "punctuation" && candidate.value === ";") break;
			if (candidate?.kind === "string") {
				if (candidate.value.startsWith(".")) specifiers.push(candidate.value);
				break;
			}
		}
	}

	return specifiers;
}

async function isFile(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isFile();
	} catch {
		return false;
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function resolveSourceImport(fromPath: string, specifier: string): Promise<string | undefined> {
	const base = resolve(dirname(fromPath), specifier);
	const extension = extname(base);
	const candidates = extension
		? [
			base,
			...(extension === ".js" ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx"] : []),
		]
		: [
			base,
			...SOURCE_EXTENSIONS.map((suffix) => `${base}${suffix}`),
			...SOURCE_EXTENSIONS.map((suffix) => join(base, `index${suffix}`)),
		];

	for (const candidate of candidates) {
		if (SOURCE_EXTENSION_SET.has(extname(candidate)) && await isFile(candidate)) return candidate;
	}
	return undefined;
}

async function nearestPackageRoot(path: string): Promise<string> {
	let directory = dirname(path);
	for (let depth = 0; depth < 16; depth += 1) {
		if (await isFile(join(directory, "package.json"))) return directory;
		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return dirname(path);
}

function isInside(root: string, path: string): boolean {
	const difference = relative(root, path);
	return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

export async function scanExtensionEventHooks(entryPath: string): Promise<EventHook[]> {
	let sourcePath = entryPath;
	if (await isDirectory(sourcePath)) {
		const indexPath = (await Promise.all(SOURCE_EXTENSIONS.map(async (extension) => {
			const candidate = join(sourcePath, `index${extension}`);
			return await isFile(candidate) ? candidate : undefined;
		}))).find((candidate) => candidate !== undefined);
		if (!indexPath) return [];
		sourcePath = indexPath;
	}
	if (!SOURCE_EXTENSION_SET.has(extname(sourcePath)) || !await isFile(sourcePath)) return [];

	const canonicalEntryPath = await realpath(sourcePath).catch(() => resolve(sourcePath));
	const boundary = await nearestPackageRoot(canonicalEntryPath);
	const queue = [canonicalEntryPath];
	const visited = new Set<string>();
	const hooks: EventHook[] = [];

	while (queue.length > 0) {
		const path = queue.shift();
		if (!path || visited.has(path)) continue;
		visited.add(path);

		let source: string;
		try {
			source = await readFile(path, "utf8");
		} catch {
			continue;
		}
		hooks.push(...findLiteralPiEventHooks(source, path));

		for (const specifier of relativeImportSpecifiers(source)) {
			const importedPath = await resolveSourceImport(path, specifier);
			if (importedPath && isInside(boundary, importedPath) && !visited.has(importedPath)) {
				queue.push(importedPath);
			}
		}
	}

	return hooks.sort((left, right) =>
		left.event.localeCompare(right.event)
		|| left.path.localeCompare(right.path)
		|| left.line - right.line,
	);
}

async function sourceKey(source: ResourceSource): Promise<string> {
	if (source.source === "builtin" || source.source === "sdk" || source.path.startsWith("<")) {
		return `${source.source}:${source.path}`;
	}
	return realpath(source.path).catch(() => resolve(source.path));
}

function cliExtensionSources(argv: readonly string[], cwd: string): ResourceSource[] {
	const paths: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index] ?? "";
		if (argument === "-e" || argument === "--extension") {
			const path = argv[index + 1];
			if (path) paths.push(path);
			index += 1;
			continue;
		}
		if (argument.startsWith("--extension=")) paths.push(argument.slice("--extension=".length));
	}
	return paths.map((path) => ({
		source: "cli",
		scope: "temporary",
		path: isAbsolute(path) ? path : resolve(cwd, path),
	}));
}

async function resolvedExtensionSources(
	options: ExtensionDiscoveryOptions,
): Promise<{ sources: ResourceSource[]; controlledRoots: string[] }> {
	const settingsManager = SettingsManager.create(options.cwd, options.agentDir);
	const packageManager = new DefaultPackageManager({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager,
	});
	const resolved = await packageManager.resolve(async () => "skip");
	const inScope = (scope: string) => options.projectTrusted || scope !== "project";
	const sources = resolved.extensions
		.filter((resource) => resource.enabled && inScope(resource.metadata.scope))
		.map((resource) => ({
			source: resource.metadata.source,
			scope: resource.metadata.scope,
			path: resource.path,
		}));
	const controlledRoots = packageManager.listConfiguredPackages().flatMap((configuredPackage) =>
		configuredPackage.installedPath && inScope(configuredPackage.scope)
			? [resolve(configuredPackage.installedPath)]
			: [],
	);
	return { sources, controlledRoots };
}

async function ancestorManifestSources(source: ResourceSource): Promise<ResourceSource[]> {
	if (source.path.startsWith("<")) return [];

	const entries: ResourceSource[] = [];
	let directory = dirname(resolve(source.path));
	for (let depth = 0; depth < 16; depth += 1) {
		const manifestPath = join(directory, "package.json");
		try {
			const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
				pi?: { extensions?: unknown };
			};
			if (Array.isArray(manifest.pi?.extensions)) {
				for (const entry of manifest.pi.extensions) {
					if (typeof entry !== "string") continue;
					entries.push({ ...source, path: resolve(directory, entry) });
				}
			}
		} catch {
			// This directory is not a Pi package boundary.
		}

		const parent = dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
	return entries;
}

export async function discoverExtensionSources(
	seedSources: readonly ResourceSource[],
	options: ExtensionDiscoveryOptions,
): Promise<ResourceSource[]> {
	const sources = new Map<string, ResourceSource>();
	const queue: ResourceSource[] = [];
	const add = async (source: ResourceSource) => {
		const normalized = source.path.startsWith("<")
			? source
			: { ...source, path: resolve(source.path) };
		const key = await sourceKey(normalized);
		if (sources.has(key)) return;
		sources.set(key, normalized);
		queue.push(normalized);
	};

	for (const source of seedSources) await add(source);
	const resolved = await resolvedExtensionSources(options);
	for (const source of resolved.sources) await add(source);
	const controlledRoots = resolved.controlledRoots;
	for (const source of cliExtensionSources(options.argv ?? process.argv.slice(2), options.cwd)) await add(source);

	while (queue.length > 0) {
		const source = queue.shift();
		if (!source) continue;
		if (controlledRoots.some((root) => isInside(root, source.path))) continue;
		for (const manifestSource of await ancestorManifestSources(source)) await add(manifestSource);
	}

	return Array.from(sources.values());
}
