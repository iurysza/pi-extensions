// Checks on the real bundles: the lazy-import guard, the loader wiring, and that bundled code
// registers the same things as the source.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { ENTRIES, LAZY_ONLY_PACKAGES, LAZY_ONLY_SOURCES, buildBundles, bundleDirOf, bundleStatus, lazyGuardProblems, staticClosure } from "../../scripts/build-bundles.mjs";
import { root, runProbe } from "./helpers.mjs";

const { built } = await buildBundles({ root, strict: true });
const scratch = mkdtempSync(join(tmpdir(), "prebundle-home-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

test("every bundle matches the sources on disk after a build", () => {
  for (const { entry, state } of bundleStatus({ root })) assert.equal(state, "fresh", `${entry.pkg}/${entry.slug}`);
});

test("lazy-only modules stay off the startup path of every bundle", () => {
  for (const { entry, metafile, entryOutput } of built) {
    const closure = staticClosure(metafile, entryOutput);
    assert.deepEqual(lazyGuardProblems(closure), [], `${entry.pkg}/${entry.slug}`);
  }
});

test("the lazy modules are still in the build, behind a dynamic import", () => {
  const cursor = built.find(({ entry }) => entry.slug === "pi-cursor-sdk");
  const lazyExternals = Object.values(cursor.metafile.outputs).flatMap((output) => output.imports)
    .filter((edge) => edge.external && edge.kind === "dynamic-import").map((edge) => edge.path);
  assert.ok(lazyExternals.includes("@cursor/sdk"), "pi-cursor-sdk no longer imports @cursor/sdk lazily; update the guard");
  const cards = built.find(({ entry }) => entry.slug === "tool-presentation");
  assert.ok(LAZY_ONLY_SOURCES.every((source) => source in cards.metafile.inputs), "rich-diff.ts left the tool-presentation build; update the guard");
});

test("the guard reports a static import of a lazy-only module", () => {
  const closure = { outputs: [], sources: [LAZY_ONLY_SOURCES[0]], externals: ["@cursor/sdk", "@shikijs/cli/dist/x.js", "shiki-like"] };
  assert.equal(lazyGuardProblems(closure).length, 3);
  assert.deepEqual(LAZY_ONLY_PACKAGES, ["@cursor/sdk", "shiki", "@shikijs"]);
});

test("each bundled entry is a loader that Pi already loads", () => {
  for (const entry of ENTRIES) {
    const packageDir = join(root, "packages", entry.pkg);
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    assert.ok(manifest.pi.extensions.some((path) => path.replace(/^\.\//, "") === entry.loader), `${entry.loader} is not a pi.extensions entry of ${entry.pkg}`);
    const loader = readFileSync(join(packageDir, entry.loader), "utf8");
    assert.match(loader, /loadPrebundled/);
    const [, target] = loader.match(/new URL\("([^"]+)", import\.meta\.url\)/);
    assert.equal(resolve(dirname(join(packageDir, entry.loader)), target), bundleDirOf(root, entry));
  }
});

test("every copy of the loader helper is the same", () => {
  const copies = ["packages/pi-ext/extensions/shared/prebundle.ts", "packages/pi-cursor-sdk/src/prebundle.ts", "packages/pi-cursor-cloud/src/prebundle.ts", "packages/pi-token-tank/src/prebundle.ts"].map((path) => readFileSync(join(root, path), "utf8"));
  assert.ok(copies.every((copy) => copy === copies[0]));
});

test("every rewritten import.meta.url points at a source file that exists", () => {
  let checked = 0;
  for (const { outDir } of built) {
    for (const file of readdirSync(outDir).filter((name) => name.endsWith(".ts"))) {
      for (const [, target] of readFileSync(join(outDir, file), "utf8").matchAll(/new URL\("([^"]+)", import\.meta\.url\)\.href/g)) {
        assert.ok(existsSync(resolve(outDir, target)), `${file}: ${target}`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 0, "no rewritten import.meta.url found; the rewrite or this test is broken");
});

test("a bundle registers the same tools, commands, shortcuts, renderers and events as its source", () => {
  // An empty home and no Cursor key keep the Cursor entry off the network and off real settings.
  const env = { HOME: scratch, PI_CODING_AGENT_DIR: join(scratch, "agent"), CURSOR_API_KEY: undefined, PI_OFFLINE: "1" };
  for (const entry of ENTRIES) {
    const source = JSON.parse(runProbe("probe-register.mjs", join(root, "packages", entry.pkg, entry.main), env).stdout);
    const bundle = JSON.parse(runProbe("probe-register.mjs", join(bundleDirOf(root, entry), "index.ts"), env).stdout);
    assert.deepEqual(bundle, source, `${entry.pkg}/${entry.slug}`);
    assert.ok(Object.values(source).flat().length > 0, `${entry.pkg}/${entry.slug} registered nothing; the probe is broken`);
  }
});
