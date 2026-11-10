// Module identity across extensions. pi-telescope imports ../session-store/db.ts, which the
// session-store extension also imports. This proves the two never shared one instance of that
// module, so giving the pi-telescope bundle its own copy changes nothing.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { ENTRIES, bundleDirOf } from "../../scripts/build-bundles.mjs";

const root = resolve(import.meta.dirname, "../..");
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "prebundle-identity-")));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("Pi gives each extension its own instance of a shared source module", async () => {
  const dir = join(scratch, "fixture");
  mkdirSync(join(dir, "a"), { recursive: true });
  mkdirSync(join(dir, "b"), { recursive: true });
  writeFileSync(join(dir, "shared.ts"), "const g = globalThis as any;\ng.__prebundleIdentity = (g.__prebundleIdentity ?? 0) + 1;\nexport const instance = {};\n");
  const entry = 'import { instance } from "../shared.ts";\nexport default function () { ((globalThis as any).__prebundleInstances ??= []).push(instance); }\n';
  writeFileSync(join(dir, "a/index.ts"), entry);
  writeFileSync(join(dir, "b/index.ts"), entry);
  const loaded = await discoverAndLoadExtensions([join(dir, "a/index.ts"), join(dir, "b/index.ts")], dir, join(scratch, "agent"));
  assert.deepEqual(loaded.errors, []);
  assert.equal(globalThis.__prebundleIdentity, 2, "shared.ts ran once: Pi now shares modules between extensions, so review every module a bundle duplicates");
  assert.notEqual(globalThis.__prebundleInstances[0], globalThis.__prebundleInstances[1]);
});

test("session-store/db.ts keeps its state in the database file, not in exported memory", () => {
  // The only module-level state is the connection and one flag, both private to the instance.
  const text = readFileSync(join(root, "packages/pi-ext/extensions/session-store/db.ts"), "utf8");
  const state = [...text.matchAll(/^(?:export )?let (\w+)/gm)].map((match) => match[1]);
  assert.deepEqual(state, ["_db", "_ftsAvailable"]);
  assert.doesNotMatch(text, /^export (let|var) /m);
  assert.doesNotMatch(text, /globalThis|Symbol\.for/);
});

test("the pi-telescope bundle carries its own copy of session-store/db.ts", () => {
  const entry = ENTRIES.find((item) => item.slug === "pi-telescope");
  const manifest = JSON.parse(readFileSync(join(bundleDirOf(root, entry), "manifest.json"), "utf8"));
  assert.ok(manifest.inputs.some((input) => input.endsWith("session-store/db.ts")), "db.ts is not an input: an edit to it would not mark the bundle stale");
  assert.ok(!ENTRIES.some((item) => item.slug === "session-store"), "session-store is bundled now: check what the two bundles share");
});
