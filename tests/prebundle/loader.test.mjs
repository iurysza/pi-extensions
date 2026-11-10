// The loader rule, on a small fixture package in a temp folder: a bundle is used only when it
// matches the sources on disk. Everything else loads the source.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBundles, bundleStatus } from "../../scripts/build-bundles.mjs";
import { root, runProbeWithNotes } from "./helpers.mjs";

const entries = [{ pkg: "fixture", slug: "fixture", loader: "src/index.ts", main: "src/main.ts" }];
const temps = [];

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "prebundle-test-"));
  temps.push(dir);
  const src = join(dir, "packages/fixture/src");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  cpSync(join(root, "packages/pi-ext/extensions/shared/prebundle.ts"), join(src, "prebundle.ts"));
  writeFileSync(join(src, "data.txt"), "data-1");
  writeFileSync(join(src, "helper.ts"), 'export const version: string = "v1";\n');
  writeFileSync(join(src, "main.ts"), [
    'import { readFileSync } from "node:fs";',
    'import { version } from "./helper.js";',
    'export default (): string => `${version}:${readFileSync(new URL("./data.txt", import.meta.url), "utf8")}`;',
    "",
  ].join("\n"));
  writeFileSync(join(src, "index.ts"), [
    'import { loadPrebundled } from "./prebundle.js";',
    'const mod = await loadPrebundled<typeof import("./main.js")>(new URL("../.prebundle/fixture/", import.meta.url), () => import("./main.js"));',
    "export default mod.default;",
    "",
  ].join("\n"));
  await buildBundles({ root: dir, entries, strict: true });
  return dir;
}

const load = (dir, env) => runProbeWithNotes("probe-load.mjs", join(dir, "packages/fixture/src/index.ts"), env);
const bundleFile = (dir, name) => join(dir, "packages/fixture/.prebundle/fixture", name);

test.after(() => { for (const dir of temps) rmSync(dir, { recursive: true, force: true }); });

test("a fresh bundle is loaded, and import.meta.url still points at the source", async () => {
  const dir = await fixture();
  const result = load(dir);
  assert.equal(result.stdout, "v1:data-1");
  assert.match(result.notes, /: bundle\n/);
  assert.equal(bundleStatus({ root: dir, entries })[0].state, "fresh");
});

test("an edited source file loads the source, not the old bundle", async () => {
  const dir = await fixture();
  writeFileSync(join(dir, "packages/fixture/src/helper.ts"), 'export const version: string = "v2";\n');
  const result = load(dir);
  assert.equal(result.stdout, "v2:data-1");
  assert.match(result.notes, /bundle is stale/);
  assert.equal(bundleStatus({ root: dir, entries })[0].state, "stale");
});

test("a deleted source file loads the source path, not the old bundle", async () => {
  const dir = await fixture();
  const helper = join(dir, "packages/fixture/src/helper.ts");
  const text = readFileSync(helper, "utf8");
  rmSync(helper);
  assert.equal(bundleStatus({ root: dir, entries })[0].state, "missing");
  writeFileSync(helper, text);
  assert.match(load(dir).notes, /: bundle\n/);
});

test("no bundle loads the source", async () => {
  const dir = await fixture();
  rmSync(join(dir, "packages/fixture/.prebundle"), { recursive: true });
  const result = load(dir);
  assert.equal(result.stdout, "v1:data-1");
  assert.match(result.notes, /no bundle/);
});

test("a bundle without a manifest (interrupted build) loads the source", async () => {
  const dir = await fixture();
  rmSync(bundleFile(dir, "manifest.json"));
  assert.match(load(dir).notes, /no bundle/);
});

test("a bundle that fails to import loads the source", async () => {
  const dir = await fixture();
  writeFileSync(bundleFile(dir, "index.ts"), "export default (=> broken\n");
  const result = load(dir);
  assert.equal(result.stdout, "v1:data-1");
  assert.match(result.notes, /bundle failed to load/);
});

test("PI_PREBUNDLE=0 loads the source even when the bundle is fresh", async () => {
  const dir = await fixture();
  const result = load(dir, { PI_PREBUNDLE: "0" });
  assert.equal(result.stdout, "v1:data-1");
  assert.match(result.notes, /PI_PREBUNDLE=0/);
});

test("a tree that is moved after the build still loads its bundles", async () => {
  const dir = await fixture();
  const moved = `${dir}-moved`;
  temps.push(moved);
  renameSync(dir, moved);
  const result = load(moved);
  assert.equal(result.stdout, "v1:data-1");
  assert.match(result.notes, /: bundle\n/);
});

test("a failed entry is skipped without --strict and rejected with it", async () => {
  const dir = await fixture();
  writeFileSync(join(dir, "packages/fixture/src/main.ts"), "export default (=> broken\n");
  const loose = await buildBundles({ root: dir, entries });
  assert.equal(loose.failed.length, 1);
  assert.equal(bundleStatus({ root: dir, entries })[0].state, "missing");
  await assert.rejects(buildBundles({ root: dir, entries, strict: true }), /failed to build/);
});
