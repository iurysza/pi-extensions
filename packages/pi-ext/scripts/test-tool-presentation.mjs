import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = resolve(import.meta.dirname, "..");
const output = resolve(packageRoot, ".tool-presentation-test-dist");
const testsRoot = resolve(output, "tests");

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.name.endsWith(".test.js") ? [path] : [];
  });
}

rmSync(output, { recursive: true, force: true });
try {
  const typescriptRoot = dirname(require.resolve("typescript/package.json"));
  execFileSync(process.execPath, [
    resolve(typescriptRoot, "bin/tsc"),
    "-p",
    resolve(packageRoot, "tests/tool-presentation/tsconfig.json"),
  ], { cwd: packageRoot, stdio: "inherit" });
  execFileSync(process.execPath, ["--test", ...findTests(testsRoot)], {
    cwd: packageRoot,
    stdio: "inherit",
  });
} finally {
  rmSync(output, { recursive: true, force: true });
}
