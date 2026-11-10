// Child process for equivalence.test.mjs: runs an extension factory against a recording fake of
// Pi's ExtensionAPI and prints the names it registered.
import { pathToFileURL } from "node:url";

const seen = { tools: [], commands: [], shortcuts: [], flags: [], renderers: [], providers: [], events: [] };
const record = { registerTool: "tools", registerCommand: "commands", registerShortcut: "shortcuts", registerFlag: "flags", registerMessageRenderer: "renderers", registerToolRenderer: "renderers", registerProvider: "providers", on: "events" };
const nameOf = (value) => (typeof value === "string" ? value : String(value?.name ?? value?.id ?? JSON.stringify(value)));
const events = { on: () => () => {}, emit: () => {} };
const pi = new Proxy({}, {
  get(_target, key) {
    if (key === "events") return events;
    if (key === "then") return undefined;
    if (record[key]) return (first) => { seen[record[key]].push(nameOf(first)); };
    if (String(key).startsWith("get")) return () => [];
    return () => undefined;
  },
});

const mod = await import(pathToFileURL(process.argv[2]).href);
await mod.default(pi);
for (const list of Object.values(seen)) list.sort();
process.stdout.write(JSON.stringify(seen));
process.exit(0);
