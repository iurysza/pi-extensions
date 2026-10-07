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
const nativeExpanded = new Set(["ask_user", "cursor_ask_question", "choose_visual_artifact_direction", "plannotator_submit_plan", "plannotator_mark_done", "Agent", "SubagentWorkflow", "get_subagent_result"]);
export function specForTool(tool: { name: string; label?: string; title?: string; annotations?: { readOnlyHint?: boolean } }): CardSpec | undefined {
  const spec = Object.hasOwn(cardSpecs, tool.name) ? cardSpecs[tool.name] : undefined;
  if (spec) return nativeExpanded.has(tool.name) ? { ...spec, expanded: undefined } : spec;
  return /^mcp__.+__.+$/.test(tool.name) ? mcpSpec(tool) : undefined;
}
