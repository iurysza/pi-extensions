import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cardRenderers, cardRuntime } from "./renderers.js";
import { specForTool } from "./index.js";

export type AdoptCandidate = { name: string; version: string; testedVersion: string; factory: (pi: ExtensionAPI) => void | Promise<void> };
/** Unregistered spike. Loading the normal package never enables adoption. */
export async function adoptFactory(pi: ExtensionAPI, candidate: AdoptCandidate, warn: (message: string) => void): Promise<boolean> {
  if (candidate.version !== candidate.testedVersion) {
    warn(`tool cards: ${candidate.name} ${candidate.version} is untested; keep the original extension enabled.`);
    return false;
  }
  let existing: Set<string>;
  try { existing = new Set(pi.getAllTools().map((tool) => tool.name)); }
  catch {
    warn(`tool cards: ${candidate.name} not adopted: getAllTools is unavailable during extension loading. Keep the original enabled.`);
    return false;
  }
  const runtime = cardRuntime(pi);
  let warned = false;
  const proxy = new Proxy(pi, {
    get(target, key) {
      if (key !== "registerTool") return Reflect.get(target, key);
      return (tool: any) => {
        // Also catch late MCP registrations and tools added since the factory started.
        if (existing.has(tool.name) || pi.getAllTools().some((t) => t.name === tool.name)) {
          if (!warned) { warned = true; warn(`tool cards: ${candidate.name} skipped an already registered tool; keep only one extension source.`); }
          return;
        }
        const spec = specForTool(tool);
        existing.add(tool.name);
        pi.registerTool(spec ? { ...tool, ...cardRenderers(spec, runtime) } : tool);
      };
    },
  });
  await candidate.factory(proxy);
  return true;
}
