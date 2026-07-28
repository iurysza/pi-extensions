import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import piWtf, { recordWtf, slugify } from "../src/index.ts";

async function withWorkspace(run) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-wtf-"));
  try { await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

test("registers the wtf tool", () => {
  let tool;
  piWtf({ registerTool(value) { tool = value; } });
  assert.equal(tool.name, "wtf");
  assert.match(tool.description, /ai-artifacts\/wtf/);
});

test("creates one dated, slugged artifact per friction note", async () => {
  await withWorkspace(async (cwd) => {
    const first = await recordWtf(cwd, "  Search repeatedly misses generated files.  ", new Date("2026-04-01T10:00:00.000Z"));
    const second = await recordWtf(cwd, "Need to retry the same setup after every reload.", new Date("2026-04-01T11:00:00.000Z"));

    assert.equal(first, path.join(cwd, "ai-artifacts", "wtf", "2026-04-01-search-repeatedly-misses-generated-files.md"));
    assert.equal(second, path.join(cwd, "ai-artifacts", "wtf", "2026-04-01-need-to-retry-the-same-setup-after-every-reload.md"));
    assert.equal(await readFile(first, "utf8"), "# WTF\n\nSearch repeatedly misses generated files.\n");
    assert.equal(await readFile(second, "utf8"), "# WTF\n\nNeed to retry the same setup after every reload.\n");
  });
});

test("adds a numeric suffix rather than overwriting an existing artifact", async () => {
  await withWorkspace(async (cwd) => {
    await recordWtf(cwd, "Repeated build failure", new Date("2026-04-01T10:00:00.000Z"));
    const duplicate = await recordWtf(cwd, "Repeated build failure", new Date("2026-04-01T11:00:00.000Z"));
    assert.equal(duplicate, path.join(cwd, "ai-artifacts", "wtf", "2026-04-01-repeated-build-failure-2.md"));
  });
});

test("normalizes notes into file-safe slugs", () => {
  assert.equal(slugify("  Déjà vu: build’s fucked!  "), "deja-vu-build-s-fucked");
  assert.equal(slugify("🤬"), "friction");
});

test("rejects empty notes without creating an artifact directory", async () => {
  await withWorkspace(async (cwd) => {
    await assert.rejects(recordWtf(cwd, "   "), /must not be empty/);
    await assert.rejects(readFile(path.join(cwd, "ai-artifacts", "wtf")), { code: "ENOENT" });
  });
});
