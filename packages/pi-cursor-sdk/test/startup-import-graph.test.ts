import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

// Modules that must stay behind dynamic import() so they cost nothing at Pi startup.
// If one of these shows up in the static graph from index.ts, startup got slower: load it lazily instead.
const LAZY_MODULES = [
	"cursor-cloud-lifecycle",
	"cursor-session-agent",
	"cursor-session-agent-cleanup",
	"cursor-fallback-warning",
	"cursor-tools-debug-report",
	"cursor-pi-tool-bridge-diagnostics",
	"cursor-pi-tool-bridge-run",
	"cursor-tool-presentation-registry",
	"cursor-tool-manifest",
	"cursor-session-compaction-prep",
	"cursor-agents-context",
	"cursor-native-tool-display-tools",
	"cursor-provider",
] as const;

function runtimeRelativeImports(file: string): string[] {
	const source = ts.createSourceFile(file, readFileSync(file, "utf-8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const specifiers: string[] = [];
	for (const node of source.statements) {
		if (ts.isImportDeclaration(node)) {
			const clause = node.importClause;
			if (clause?.isTypeOnly) continue;
			// `import { type A } from` still loads the module at runtime only when a value binding or side-effect import exists.
			const named = clause?.namedBindings;
			const onlyTypeNames = clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((element) => element.isTypeOnly);
			if (onlyTypeNames) continue;
			if (ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
			const onlyTypeNames = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every((element) => element.isTypeOnly));
			if (!onlyTypeNames) specifiers.push(node.moduleSpecifier.text);
		}
	}
	return specifiers.filter((specifier) => specifier.startsWith("."));
}

function resolveSource(from: string, specifier: string): string | undefined {
	const target = resolve(join(from, ".."), specifier.replace(/\.js$/, ".ts"));
	return existsSync(target) ? target : undefined;
}

function collectStartupGraph(entry: string): Set<string> {
	const seen = new Set<string>();
	const visit = (file: string): void => {
		if (seen.has(file)) return;
		seen.add(file);
		for (const specifier of runtimeRelativeImports(file)) {
			const next = resolveSource(file, specifier);
			if (next) visit(next);
		}
	};
	visit(entry);
	return seen;
}

describe("extension startup import graph", () => {
	const graph = collectStartupGraph(join(SRC, "index.ts"));
	const names = new Set([...graph].map((file) => file.slice(SRC.length + 1).replace(/\.ts$/, "")));

	it("walks a non-trivial graph from index.ts", () => {
		expect(names.has("index")).toBe(true);
		expect(names.has("cursor-state")).toBe(true);
		expect(names.has("cursor-provider-lazy")).toBe(true);
	});

	it.each(LAZY_MODULES)("does not statically load %s at startup", (module) => {
		expect(existsSync(join(SRC, `${module}.ts`))).toBe(true);
		expect(names.has(module)).toBe(false);
	});
});
