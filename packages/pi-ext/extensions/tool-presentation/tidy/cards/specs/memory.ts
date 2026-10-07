import { CYAN, YELLOW } from "../../render.js";
import { firstLine, resultText, rawExpanded, type CardSpec } from "../spec.js";
const failed = (r: Parameters<typeof resultText>[0]) => /^(?:Too long:|Error:|memo_\w+ is not available|.*ENOENT)/i.test(resultText(r));
const base = { failed, expanded: rawExpanded };
export const memorySpecs: Record<string, CardSpec> = {
  memo_note: { ...base, icon: "󰎜", color: YELLOW, label: "memo", headline: (a) => a.line, target: () => "",
    summary: (r) => {
      const saved = resultText(r).match(/Saved as (#\d+)\./);
      return saved ? `saved ${saved[1]}${/Compress memories #/.test(resultText(r)) ? " · nap requested" : ""}` : firstLine(r);
    } },
  memo_nap: { ...base, icon: "󰒲", color: YELLOW, label: "memo", headline: (a) => a.line, target: (a) => `#${a.range}`,
    summary: (r) => /\d+-\d+ saved\./.test(resultText(r)) ? `merged${/Compress memories #/.test(resultText(r)) ? " · nap requested" : ""}` : firstLine(r) },
  memo_zoom: { ...base, icon: "󰛭", color: CYAN, label: "memo", headline: () => "open memory node", target: (a) => `#${a.range}`,
    summary: (r) => {
      const lines = resultText(r).split("\n").filter((l) => /^\s*#\d/.test(l));
      return lines.length ? (lines.length === 2 && lines.every((l) => /^\s*#\d+-\d+\b/.test(l)) ? "2 halves" : `${lines.length} memories`) : firstLine(r);
    } },
  memo_recall: { ...base, icon: "󰧑", color: CYAN, label: "memo", headline: () => "recall memory", target: (a) => `/${a.regex}/`,
    summary: (r) => resultText(r).match(/\d+ matches?\./)?.[0].replace(/\.$/, "") ?? firstLine(r) },
};
