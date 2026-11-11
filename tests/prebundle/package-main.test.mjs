// A published package's `main` must keep its named exports. The Pi entry (pi.extensions) is a
// loader with a default export only, so `main` points at the source module instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { root } from "./helpers.mjs";

test("@iurysza/pi-token-tank main exports its public names, and Pi still loads the loader", async () => {
  const manifest = JSON.parse(readFileSync(join(root, "packages/pi-token-tank/package.json"), "utf8"));
  assert.equal(manifest.main, "src/main.ts");
  assert.deepEqual(manifest.pi.extensions, ["src/index.ts"]);
  const mod = await import("@iurysza/pi-token-tank");
  for (const name of ["createTokenTank", "createCoordinator", "createMemoryQuotaStore", "providerForModel"]) assert.equal(typeof mod[name], "function", name);
  assert.equal(typeof mod.default, "function");
  assert.equal(typeof mod.providers, "object");
  assert.equal(typeof mod.COOLDOWN_BASE_MS, "number");
  assert.equal(typeof mod.COOLDOWN_MAX_MS, "number");
  // QuotaProvider is a type; it must stay exported from the source main.
  assert.match(readFileSync(join(root, "packages/pi-token-tank", manifest.main), "utf8"), /^export type \{ QuotaProvider \}/m);
});
