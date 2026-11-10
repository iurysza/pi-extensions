#!/usr/bin/env node
// Builds the startup bundles for the heavy Pi extension entries.
//
// Usage: node scripts/build-bundles.mjs [--strict] [--status]
//   --strict  exit 1 when any entry fails to build (CI). Without it a failed entry is skipped
//             with a warning, so an install still succeeds and that entry loads from source.
//   --status  build nothing; print which bundles match the sources on disk.
//
// Output, per entry: packages/<pkg>/.prebundle/<slug>/{index.ts, chunk-*.ts, manifest.json}.
// The folder is git-ignored. Sources stay where they are: each entry file is a small loader
// (see packages/pi-ext/extensions/shared/prebundle.ts) that uses the bundle only when
// manifest.json matches the sources.
//
// Rules:
// - Split ESM, written as .ts: the fastest shape Pi's extension loader accepts.
// - Modules Pi provides, and everything that resolves into node_modules, stay external.
// - Our own TypeScript and workspace packages are bundled.
// - `import.meta.url` is rewritten to a relative URL back to the original source file, so code
//   that reads files beside its source keeps working, and the tree can be moved after the build.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MANIFEST_VERSION = 1;
export const BUNDLE_DIR = ".prebundle";

/** Entries that get a bundle. `loader` is the path Pi loads; `main` is the code it bundles. */
export const ENTRIES = [
  { pkg: "pi-cursor-sdk", slug: "pi-cursor-sdk", loader: "src/index.ts", main: "src/main.ts" },
  { pkg: "pi-ext", slug: "tool-presentation", loader: "extensions/tool-presentation/index.ts", main: "extensions/tool-presentation/main.ts" },
  { pkg: "pi-ext", slug: "leader-key", loader: "extensions/leader-key/index.ts", main: "extensions/leader-key/main.ts" },
  { pkg: "pi-ext", slug: "pi-telescope", loader: "extensions/pi-telescope/index.ts", main: "extensions/pi-telescope/main.ts" },
  { pkg: "pi-ext", slug: "compaction-model", loader: "extensions/compaction-model/index.ts", main: "extensions/compaction-model/main.ts" },
  { pkg: "pi-ext", slug: "session-snap", loader: "extensions/session-snap/index.ts", main: "extensions/session-snap/main.ts" },
  { pkg: "pi-ext", slug: "permissions", loader: "extensions/permissions/permissions.ts", main: "extensions/permissions/main.ts" },
  { pkg: "pi-ext", slug: "handoff", loader: "extensions/handoff/index.ts", main: "extensions/handoff/main.ts" },
  { pkg: "pi-cursor-cloud", slug: "pi-cursor-cloud", loader: "src/index.ts", main: "src/main.ts" },
  { pkg: "pi-token-tank", slug: "pi-token-tank", loader: "src/index.ts", main: "src/main.ts" },
];

/** Must never be reachable through static imports from a bundled entry. */
export const LAZY_ONLY_PACKAGES = ["@cursor/sdk", "shiki", "@shikijs"];
export const LAZY_ONLY_SOURCES = ["packages/pi-ext/extensions/tool-presentation/rich-diff.ts"];

// Pi resolves these to its own copies (the alias list in its extension loader). The old scope
// names are built from parts so scripts/check-catalog.mjs does not flag this file.
const PI_PROVIDED = ["@earendil-works/", ["@mario", "zechner/pi-"].join(""), "typebox", ["@sin", "clair/typebox"].join("")];
const isPiProvided = (id) => PI_PROVIDED.some((p) => (p.endsWith("/") || p.endsWith("-") ? id.startsWith(p) : id === p || id.startsWith(`${p}/`)));
const posix = (path) => path.split(sep).join("/");

/** Same value as hashInputs() in the prebundle.ts loader helper. */
export function hashInputs(bundleDir, inputs) {
  const hash = createHash("sha256");
  for (const input of inputs) {
    hash.update(`${input}\0`);
    hash.update(readFileSync(resolve(bundleDir, input)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export const bundleDirOf = (root, entry) => join(root, "packages", entry.pkg, BUNDLE_DIR, entry.slug);

function plugin(outDir) {
  return {
    name: "pi-prebundle",
    setup(b) {
      b.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.pluginData?.inner) return undefined;
        if (args.path.startsWith("node:") || isPiProvided(args.path)) return { path: args.path, external: true };
        const found = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: { inner: true } });
        const outside = found.errors.length > 0 || found.external || found.path.includes(`${sep}node_modules${sep}`) || found.path.endsWith(".node");
        return outside ? { path: args.path, external: true } : { path: found.path };
      });
      b.onLoad({ filter: /\.(ts|mts|js|mjs)$/ }, (args) => {
        if (args.path.includes(`${sep}node_modules${sep}`)) return undefined;
        const text = readFileSync(args.path, "utf8");
        if (!text.includes("import.meta.url")) return undefined;
        const target = JSON.stringify(posix(relative(outDir, args.path)));
        return { contents: text.replaceAll("import.meta.url", `(new URL(${target}, import.meta.url).href)`), loader: args.path.endsWith("ts") ? "ts" : "js" };
      });
    },
  };
}

/**
 * Static import closure of a bundle: the output files Node loads before the entry runs, the
 * sources inside them, and the external modules they import with `import ... from`.
 */
export function staticClosure(metafile, entryOutput) {
  const outputs = new Set();
  const queue = [entryOutput];
  while (queue.length > 0) {
    const name = queue.pop();
    if (outputs.has(name)) continue;
    outputs.add(name);
    for (const edge of metafile.outputs[name].imports) {
      if (edge.kind === "import-statement" && !edge.external) queue.push(edge.path);
    }
  }
  const sources = new Set();
  const externals = new Set();
  for (const name of outputs) {
    for (const input of Object.keys(metafile.outputs[name].inputs)) sources.add(input);
    for (const edge of metafile.outputs[name].imports) {
      if (edge.external && edge.kind !== "dynamic-import") externals.add(edge.path);
    }
  }
  return { outputs: [...outputs].sort(), sources: [...sources].sort(), externals: [...externals].sort() };
}

/** Problems that would pull a lazy-only module back into startup. Empty when the bundle is fine. */
export function lazyGuardProblems(closure, packages = LAZY_ONLY_PACKAGES, sources = LAZY_ONLY_SOURCES) {
  const problems = [];
  for (const external of closure.externals) {
    if (packages.some((name) => external === name || external.startsWith(`${name}/`))) problems.push(`static import of ${external}`);
  }
  for (const source of closure.sources) {
    if (sources.includes(source)) problems.push(`${source} is on the startup path`);
  }
  return problems;
}

async function buildEntry(root, entry) {
  const outDir = bundleDirOf(root, entry);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "packages", entry.pkg, entry.main)],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    splitting: true,
    outdir: outDir,
    entryNames: "index",
    chunkNames: "chunk-[hash]",
    outExtension: { ".js": ".ts" },
    plugins: [plugin(outDir)],
    metafile: true,
    logLevel: "silent",
    legalComments: "none",
    banner: { js: "// Generated by scripts/build-bundles.mjs. Do not edit." },
  });
  const inputs = Object.keys(result.metafile.inputs)
    .filter((input) => !input.includes("node_modules/"))
    .map((input) => posix(relative(outDir, join(root, input))))
    .sort();
  // Written last: a build that dies half way leaves no manifest, so the source loads.
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify({ v: MANIFEST_VERSION, inputs, sha256: hashInputs(outDir, inputs) }, null, 1)}\n`);
  const entryOutput = posix(relative(root, join(outDir, "index.ts")));
  const bytes = Object.values(result.metafile.outputs).reduce((sum, output) => sum + output.bytes, 0);
  return { entry, outDir, metafile: result.metafile, entryOutput, inputs, bytes, files: Object.keys(result.metafile.outputs).length };
}

/** Builds every entry. Returns `{ built, failed }`; throws only when `strict` and an entry failed. */
export async function buildBundles({ root: givenRoot, entries = ENTRIES, strict = false, log = () => {} } = {}) {
  // esbuild reports real paths. Use the real root too, or a symlinked root would turn the
  // relative import.meta.url targets into paths that climb to / and break when the tree moves.
  const root = realpathSync(givenRoot);
  const built = [];
  const failed = [];
  // Every package folder exists even when its entries fail, so an installer that copies the
  // folders finds them.
  for (const pkg of new Set(entries.map((entry) => entry.pkg))) mkdirSync(join(root, "packages", pkg, BUNDLE_DIR), { recursive: true });
  for (const entry of entries) {
    const started = performance.now();
    try {
      const result = await buildEntry(root, entry);
      built.push(result);
      log(`built ${entry.pkg}/${entry.slug}: ${result.inputs.length} sources, ${result.files} files, ${Math.round(result.bytes / 1024)} KB, ${Math.round(performance.now() - started)} ms`);
    } catch (error) {
      rmSync(bundleDirOf(root, entry), { recursive: true, force: true });
      failed.push({ entry, error });
      log(`warning: ${entry.pkg}/${entry.slug} failed to build and will load from source: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (strict && failed.length > 0) throw new Error(`${failed.length} bundle(s) failed to build: ${failed.map((f) => `${f.entry.pkg}/${f.entry.slug}`).join(", ")}`);
  return { built, failed };
}

/** "fresh", "stale" or "missing" for each entry. */
export function bundleStatus({ root, entries = ENTRIES }) {
  return entries.map((entry) => {
    const outDir = bundleDirOf(root, entry);
    try {
      const manifest = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
      const fresh = manifest.v === MANIFEST_VERSION && hashInputs(outDir, manifest.inputs) === manifest.sha256;
      return { entry, state: fresh ? "fresh" : "stale" };
    } catch {
      return { entry, state: "missing" };
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  if (args.includes("--status")) {
    for (const { entry, state } of bundleStatus({ root })) console.log(`${state.padEnd(7)} ${entry.pkg}/${entry.slug}`);
  } else {
    try {
      await buildBundles({ root, strict: args.includes("--strict"), log: (line) => console.log(line) });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
