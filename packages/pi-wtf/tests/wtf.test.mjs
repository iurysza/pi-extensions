import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import piWtf, { recordWtf } from "../src/index.ts";

async function withWorkspace(run) {
  const cwd = await mkdtemp(path.join(tmpdir(), "pi-wtf-"));
  try { await run(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

test("registers the wtf tool", () => {
  let tool;
  piWtf({ registerTool(value) { tool = value; } });
  assert.equal(tool.name, "wtf");
  assert.match(tool.description, /WTF\.md/);
});

test("creates WTF.md and appends timestamped friction", async () => {
  await withWorkspace(async (cwd) => {
    await recordWtf(cwd, "  Search repeatedly misses generated files.  ", new Date("2026-04-01T10:00:00.000Z"));
    await recordWtf(cwd, "Need to retry the same setup after every reload.", new Date("2026-04-01T11:00:00.000Z"));
    const content = await readFile(path.join(cwd, "WTF.md"), "utf8");
    assert.equal(content.match(/^# WTF$/gm)?.length, 1);
    assert.match(content, /## 2026-04-01T10:00:00\.000Z/);
    assert.match(content, /Search repeatedly misses generated files\./);
    assert.match(content, /## 2026-04-01T11:00:00\.000Z/);
  });
});

test("rejects empty notes without creating WTF.md", async () => {
  await withWorkspace(async (cwd) => {
    await assert.rejects(recordWtf(cwd, "   "), /must not be empty/);
    await assert.rejects(readFile(path.join(cwd, "WTF.md")), { code: "ENOENT" });
  });
});
