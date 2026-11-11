// A bundle must never hold older code than its manifest says, and two builds at once must not
// mix their files. Each case builds a tiny package in a throwaway root.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { buildBundles, bundleDirOf, bundleStatus } from "../../scripts/build-bundles.mjs";

const entries = [{ pkg: "demo", slug: "demo", loader: "src/index.ts", main: "src/main.ts" }];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bundle-race-")));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "packages/demo/src"), { recursive: true });
  writeFileSync(join(root, "packages/demo/src/main.ts"), 'import { word } from "./word.ts";\nexport default word;\n');
  writeFileSync(join(root, "packages/demo/src/word.ts"), 'export const word: string = "old";\n');

  return root;
}

const temps = root => readdirSync(join(root, "packages/demo/.prebundle")).filter(name => name.includes(".tmp-"));

test("a source that changes during the build leaves no bundle, so the source loads", async t => {
  const root = fixture(t);
  const word = join(root, "packages/demo/src/word.ts");
  const logs = [];

  // First a good build, to prove the old bundle is removed too.
  assert.equal((await buildBundles({ root, entries })).built.length, 1);
  assert.equal(bundleStatus({ root, entries })[0].state, "fresh");

  const { built, failed } = await buildBundles({
    root,
    entries,
    log: line => logs.push(line),
    onRead: path => {
      if (path === word) writeFileSync(word, 'export const word: string = "new";\n');
    },
  });

  assert.equal(built.length, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error.message, /sources changed during the build/);
  assert.match(logs.join("\n"), /warning: demo\/demo failed to build and will load from source: sources changed during the build/);
  assert.equal(existsSync(bundleDirOf(root, entries[0])), false);
  assert.equal(bundleStatus({ root, entries })[0].state, "missing");
  assert.deepEqual(temps(root), []);
  await assert.rejects(buildBundles({ root, entries, strict: true, onRead: path => path === word && writeFileSync(word, `export const word: string = "${Math.random()}";\n`) }), /failed to build/);
});

test("the manifest hash is the hash of the bytes in the bundle", async t => {
  const root = fixture(t);

  await buildBundles({ root, entries, strict: true });

  const dir = bundleDirOf(root, entries[0]);
  const loaded = await import(pathToFileURL(join(dir, "index.ts")).href);

  assert.equal(loaded.default, "old");
  assert.equal(bundleStatus({ root, entries })[0].state, "fresh");
  writeFileSync(join(root, "packages/demo/src/word.ts"), 'export const word: string = "new";\n');
  assert.equal(bundleStatus({ root, entries })[0].state, "stale");
});

test("builds that run at the same time leave one whole, fresh bundle and no temporary folders", async t => {
  const root = fixture(t);
  const runs = await Promise.all(Array.from({ length: 6 }, () => buildBundles({ root, entries })));
  const dir = bundleDirOf(root, entries[0]);

  assert.ok(runs.some(run => run.built.length === 1));
  assert.equal(bundleStatus({ root, entries })[0].state, "fresh");
  assert.deepEqual(temps(root), []);
  assert.deepEqual(readdirSync(dir).sort(), ["index.ts", "manifest.json"]);
  assert.match(readFileSync(join(dir, "index.ts"), "utf8"), /"old"/);
});
