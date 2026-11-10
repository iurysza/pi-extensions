import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const ROOT = join(process.cwd(), "extensions", "tool-presentation");

// Modules that must stay behind dynamic import() so they cost nothing at Pi startup.
// If one shows up in the static graph from main.ts, startup got slower: load it lazily instead.
// index.ts is only the prebundle loader; main.ts is the extension.
const LAZY_FILES = ["rich-diff"];
const LAZY_PACKAGES = ["@shikijs/cli", "diff"];

// Top-level `import ... from` / `export ... from` / `import "x"` statements. pi-ext uses TypeScript 7,
// which has no JS compiler API, so this scans statements at line start. Dynamic import() is not matched.
const STATEMENT = /^(?:import|export)\s+(?:([^;]*?)\s+from\s+)?["']([^"']+)["']/gm;

/** Specifiers that load at runtime: skips `import type` and imports whose names are all `type`. */
function runtimeImports(file: string): string[] {
  const specifiers: string[] = [];
  for (const [, clause = "", specifier] of readFileSync(file, "utf8").matchAll(STATEMENT)) {
    const bindings = clause.trim();
    if (/^type\s/.test(bindings)) continue;
    const named = bindings.match(/^\{([\s\S]*)\}$/);
    const names = named?.[1].split(",").map((name) => name.trim()).filter(Boolean);
    if (names?.length && names.every((name) => name.startsWith("type "))) continue;
    specifiers.push(specifier);
  }
  return specifiers;
}

function startupGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const base = resolve(dirname(file), specifier.replace(/\.js$/, ""));
      const next = [`${base}.ts`, join(base, "index.ts")].find(existsSync);
      if (next) visit(next);
    }
  };
  visit(entry);
  return { files, packages };
}

const graph = startupGraph(join(ROOT, "main.ts"));

test("tool-presentation startup graph reaches tidy", () => {
  assert.ok(graph.files.has(join(ROOT, "tidy", "index.ts")));
});

for (const name of LAZY_FILES) {
  test(`tool-presentation does not statically load ${name} at startup`, () => {
    assert.ok(existsSync(join(ROOT, `${name}.ts`)));
    assert.equal(graph.files.has(join(ROOT, `${name}.ts`)), false);
  });
}

for (const name of LAZY_PACKAGES) {
  test(`tool-presentation does not statically load ${name} at startup`, () => {
    assert.equal(graph.packages.has(name), false);
  });
}
