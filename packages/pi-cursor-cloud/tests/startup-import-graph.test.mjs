import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const SRC = join(process.cwd(), 'src');

// Packages that must stay behind dynamic import() so they cost nothing at Pi startup.
// If one shows up in the static graph from index.ts, startup got slower: load it lazily instead.
const LAZY_PACKAGES = ['@cursor/sdk'];

/** Specifiers that load at runtime: skips `import type` and imports whose names are all `type`. */
function runtimeImports(file) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const specifiers = [];
  for (const node of source.statements) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      if (clause && !clause.name && named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(element => element.isTypeOnly)) continue;
      specifiers.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && !node.isTypeOnly) {
      specifiers.push(node.moduleSpecifier.text);
    }
  }
  return specifiers;
}

function startupGraph(entry) {
  const files = new Set();
  const packages = new Set();
  const visit = file => {
    if (files.has(file)) return;
    files.add(file);
    for (const specifier of runtimeImports(file)) {
      if (!specifier.startsWith('.')) { packages.add(specifier); continue; }
      const next = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
      if (existsSync(next)) visit(next);
    }
  };
  visit(entry);
  return { files, packages };
}

test('startup graph from index.ts is walked', () => {
  const { files } = startupGraph(join(SRC, 'index.ts'));
  assert.ok(files.has(join(SRC, 'cloud-client.ts')));
});

for (const name of LAZY_PACKAGES) {
  test(`does not statically load ${name} at startup`, () => {
    const { packages } = startupGraph(join(SRC, 'index.ts'));
    assert.equal(packages.has(name), false);
  });
}
