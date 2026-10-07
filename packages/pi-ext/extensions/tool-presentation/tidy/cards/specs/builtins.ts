import { style } from "../../render.js";
import { argDetail, summarize, expandedLines } from "../card.js";
import type { CardSpec } from "../spec.js";
export function builtinSpec(name: string): CardSpec {
  return { ...style(name), label: name, legacy: true, headline: (a) => argDetail(name, a), target: (a) => argDetail(name, a),
    summary: (r, a) => summarize(name, r, !!r.isError, a), expanded: (r, a) => expandedLines(name, a, r) };
}
