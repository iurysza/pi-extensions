import { memorySpecs } from "./specs/memory.js";
import { miscSpecs } from "./specs/misc.js";
import { webSpecs } from "./specs/web.js";
import { subagentSpecs } from "./specs/subagents.js";
import { resourceSpecs, mcpSpec } from "./specs/mcp.js";
import { codemodeSpec } from "./specs/codemode.js";
import type { CardSpec } from "./spec.js";
export { cardRenderers, cardRuntime, ownedCard, type CardAPI } from "./renderers.js";
export { renderCard, WidthAwareLines, fitToolLine, formatElapsed } from "./card.js";
export type { CardSpec, CardArgs, CardResult } from "./spec.js";
export const cardSpecs: Record<string, CardSpec> = { ...memorySpecs, ...miscSpecs, ...webSpecs, ...subagentSpecs, ...resourceSpecs, codemode: codemodeSpec };
export function specForTool(tool: { name: string; label?: string; title?: string; annotations?: { readOnlyHint?: boolean } }): CardSpec | undefined {
  return cardSpecs[tool.name] ?? (tool.name.startsWith("mcp__") ? mcpSpec(tool) : undefined);
}
