import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadFooterMode, saveFooterMode } from "../src/preferences.js";

describe("footer preferences", () => {
  it("defaults to minimal and round-trips full", async () => {
    const dir = await mkdtemp(join(tmpdir(), "quota-preference-"));
    const path = join(dir, "mode.json");
    try {
      assert.equal(await loadFooterMode(path), "minimal");
      await saveFooterMode("full", path);
      assert.equal(await loadFooterMode(path), "full");
      await writeFile(path, "invalid");
      assert.equal(await loadFooterMode(path), "minimal");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("contains write failures", async () => {
    await assert.doesNotReject(saveFooterMode("full", "/dev/null/preference.json"));
  });
});
