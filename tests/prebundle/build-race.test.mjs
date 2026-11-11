// A bundle must never hold older code than its manifest says, and two builds at once must not
// mix their files. Each case builds a tiny package in a throwaway root.
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { RETIRED_KEEP_MS, buildBundles, bundleDirOf, bundleStatus } from "../../scripts/build-bundles.mjs";
import { freshBundle } from "../../packages/pi-ext/extensions/shared/prebundle.ts";

const entries = [{ pkg: "demo", slug: "demo", loader: "src/index.ts", main: "src/main.ts" }];

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bundle-race-")));

  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "packages/demo/src"), { recursive: true });
  writeFileSync(join(root, "package.json"), '{ "name": "fixture", "devDependencies": { "esbuild": "1.0.0" } }\n');
  writeFileSync(join(root, "packages/demo/tsconfig.json"), "{}\n");
  writeFileSync(join(root, "packages/demo/src/main.ts"), 'import { word } from "./word.ts";\nexport default word;\nexport const lazy = async () => (await import("./lazy.ts")).late;\n');
  writeFileSync(join(root, "packages/demo/src/lazy.ts"), 'export const late: string = "late-1";\n');
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
  assert.equal(existsSync(join(bundleDirOf(root, entries[0]), "manifest.json")), false);
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
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).outputs).sort(), readdirSync(dir).filter(name => name !== "manifest.json").sort());
  assert.equal((await import(pathToFileURL(join(dir, "index.ts")).href)).default, "old");
});

test("a Pi that started before a rebuild can still import its lazy chunk", async t => {
  const root = fixture(t);
  const dir = bundleDirOf(root, entries[0]);
  const lazySource = join(root, "packages/demo/src/lazy.ts");

  await buildBundles({ root, entries, strict: true });

  const running = await import(pathToFileURL(join(dir, "index.ts")).href);
  const firstChunks = readdirSync(dir).filter(name => name.startsWith("chunk-"));

  assert.ok(firstChunks.length > 0);
  writeFileSync(lazySource, 'export const late: string = "late-2";\n');
  await buildBundles({ root, entries, strict: true });
  assert.equal(bundleStatus({ root, entries })[0].state, "fresh");
  // The session that loaded the first build gets the code it started with, not an error.
  assert.equal(await running.lazy(), "late-1");
  // A new session gets the new code: the new index.ts imports the new chunk.
  const fresh = readdirSync(dir).filter(name => name.startsWith("chunk-") && !firstChunks.includes(name));

  assert.equal(fresh.length, 1);
  assert.ok(readFileSync(join(dir, "index.ts"), "utf8").includes(`./${fresh[0]}`));
  assert.equal((await import(pathToFileURL(join(dir, fresh[0])).href)).late, "late-2");

  // Retired files go once they are older than the keep time; the build before the last stays.
  const old = new Date(Date.now() - RETIRED_KEEP_MS - 60_000);
  const secondChunks = readdirSync(dir).filter(name => name.startsWith("chunk-") && !firstChunks.includes(name));

  for (const name of firstChunks) utimesSync(join(dir, name), old, old);
  writeFileSync(lazySource, 'export const late: string = "late-3";\n');
  await buildBundles({ root, entries, strict: true });

  const left = readdirSync(dir);

  assert.equal(firstChunks.some(name => left.includes(name)), false);
  assert.equal(secondChunks.every(name => left.includes(name)), true);
});

test("a failed rebuild removes the manifest but keeps the files a running Pi uses", async t => {
  const root = fixture(t);
  const dir = bundleDirOf(root, entries[0]);

  await buildBundles({ root, entries, strict: true });

  const running = await import(pathToFileURL(join(dir, "index.ts")).href);

  writeFileSync(join(root, "packages/demo/src/word.ts"), "export const word: string = ;\n");
  assert.equal((await buildBundles({ root, entries })).failed.length, 1);
  assert.equal(bundleStatus({ root, entries })[0].state, "missing");
  assert.equal(await running.lazy(), "late-1");
});

test("the build script, the root package.json and the tsconfig are part of the hash", async t => {
  const root = fixture(t);
  const inputs = () => JSON.parse(readFileSync(join(bundleDirOf(root, entries[0]), "manifest.json"), "utf8")).inputs;

  await buildBundles({ root, entries, strict: true });
  assert.ok(inputs().some(input => input.endsWith("scripts/build-bundles.mjs")));

  for (const file of ["package.json", "packages/demo/tsconfig.json"]) {
    await buildBundles({ root, entries, strict: true });
    assert.equal(bundleStatus({ root, entries })[0].state, "fresh");
    appendFileSync(join(root, file), "\n");
    assert.equal(bundleStatus({ root, entries })[0].state, "stale", file);
  }
});

test("a bundle file that is missing or has the wrong size sends the entry to source", async t => {
  const root = fixture(t);
  const dir = bundleDirOf(root, entries[0]);
  const url = pathToFileURL(`${dir}/`);

  await buildBundles({ root, entries, strict: true });
  assert.equal(freshBundle(url), pathToFileURL(join(dir, "index.ts")).href);

  const chunk = join(dir, readdirSync(dir).find(name => name.startsWith("chunk-")));
  const text = readFileSync(chunk);

  appendFileSync(chunk, "// edited\n");
  assert.equal(freshBundle(url), undefined);
  assert.equal(bundleStatus({ root, entries })[0].state, "stale");
  writeFileSync(chunk, text);
  assert.ok(freshBundle(url));
  rmSync(chunk);
  assert.equal(freshBundle(url), undefined);
});
