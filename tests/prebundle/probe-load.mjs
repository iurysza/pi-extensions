// Child process for loader.test.mjs: imports a loader entry and prints what its factory returns.
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(process.argv[2]).href);
process.stdout.write(String(await mod.default()));
