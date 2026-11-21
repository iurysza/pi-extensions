import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import piMplChart, { renderChart } from "../src/index.ts";
import { latencyDashboard } from "./example.mjs";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const artifacts = path.resolve(import.meta.dirname, "../../../ai-artifacts/mpl1");

async function withDir(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "pi-mpl-test-"));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function assertPng(result, dir) {
  assert.ok(!("error" in result), `unexpected error: ${result.error}`);
  assert.match(result.image, /^data:image\/png;base64,/);
  const bytes = Buffer.from(result.image.split(",")[1], "base64");
  assert.deepEqual(bytes.subarray(0, 8), SIGNATURE);
  assert.ok(result.width > 0 && result.height > 0);
  assert.equal(bytes.readUInt32BE(16), result.width);
  assert.ok(result.pngPath.startsWith(dir));
  assert.deepEqual((await readFile(result.pngPath)).subarray(0, 8), SIGNATURE);
}

test("registers the mpl_render tool", () => {
  let tool;
  piMplChart({ registerTool(value) { tool = value; } });
  assert.equal(tool.name, "mpl_render");
  assert.ok(tool.outputSchema);
});

test("renders the latency dashboard (slate and dark)", async () => {
  await withDir(async (dir) => {
    const light = await renderChart(latencyDashboard(), dir);
    await assertPng(light, dir);
    await copyFile(light.pngPath, path.join(artifacts, "latency-dashboard.png"));
    const dark = await renderChart({ ...latencyDashboard(), style: "pro-dark" }, dir);
    await assertPng(dark, dir);
    await copyFile(dark.pngPath, path.join(artifacts, "latency-dashboard-dark.png"));
  });
});

test("tool execute returns structuredContent and an image block", async () => {
  let tool;
  piMplChart({ registerTool(value) { tool = value; } });
  const out = await tool.execute("id", { name: "t", ops: [["plot", [[1, 2, 3], [3, 1, 2]]]] });
  assert.ok(!out.isError);
  assert.equal(out.content[1].type, "image");
  assert.ok(out.structuredContent.pngPath);
});

test("unknown method returns {error} naming the op, no throw", async () => {
  const result = await renderChart({ name: "bad", ops: [["plot", [[1, 2], [1, 2]]], ["plott", [[1], [1]]]] });
  assert.deepEqual(Object.keys(result), ["error"]);
  assert.match(result.error, /op 1 'plott'.*unknown Axes method/);
  let tool;
  piMplChart({ registerTool(value) { tool = value; } });
  const out = await tool.execute("id", { name: "bad", ops: [["plott", [[1], [1]]]] });
  assert.equal(out.isError, true);
  assert.match(out.structuredContent.error, /op 0 'plott'/);
});

test("bad $date returns {error}", async () => {
  const result = await renderChart({ name: "bad", ops: [["axvline", [{ $date: "not-a-date" }]]] });
  assert.match(result.error, /op 0 'axvline'.*bad \$date/);
});

test("mpljs throw (unknown kwarg) returns {error}", async () => {
  const result = await renderChart({ name: "bad", ops: [["plot", [[1, 2], [1, 2]], { nonsense: 1 }]] });
  assert.match(result.error, /op 0 'plot'/);
});

test("unsafe method names are rejected", async () => {
  for (const method of ["__proto__", "constructor", "_private", "hasOwnProperty"]) {
    const result = await renderChart({ name: "bad", ops: [[method, []]] });
    assert.match(result.error, new RegExp(`op 0 '${method}'.*not allowed`), method);
  }
});

test("bad sca index returns {error}", async () => {
  const result = await renderChart({ name: "bad", ops: [["sca", [3]]] });
  assert.match(result.error, /op 0 'sca'.*out of range/);
});
