import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = resolve(import.meta.dirname, "..");
const output = resolve(packageRoot, ".tool-presentation-test-dist");
const testsDir = resolve(output, "tests/tool-presentation/tidy");

rmSync(output, { recursive: true, force: true });
try {
  const typescriptRoot = dirname(require.resolve("typescript/package.json"));
  execFileSync(process.execPath, [
    resolve(typescriptRoot, "bin/tsc"),
    "-p",
    resolve(packageRoot, "tests/tool-presentation/tsconfig.json"),
  ], { cwd: packageRoot, stdio: "inherit" });
  const tests = readdirSync(testsDir)
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => resolve(testsDir, name));
  execFileSync(process.execPath, ["--test", ...tests], {
    cwd: packageRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(output, { recursive: true, force: true });
}
