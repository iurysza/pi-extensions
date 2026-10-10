import { highlightCode } from "@earendil-works/pi-coding-agent";
import { MAGENTA, DIM, RESET, style } from "../../render.js";
import { formatElapsed } from "../card.js";
import { count, firstLine, joinFacts, resultText, type CardSpec } from "../spec.js";
const output = (r: any) => resultText(r).replace(/^Script (?:completed|failed)\r?\nWall time [^\n]*\r?\nOutput:\r?\n?/i, "").replace(/^Script completed[^\n]*\n?\s*/i, "").trimEnd();
export const codemodeSpec: CardSpec = {
  icon: "󰅩", color: MAGENTA, label: "codemode",
  headline: (a) => String(a.code ?? "").split("\n").map((l) => l.match(/^\s*\/\/\s*(?!@options:)(.+)/)?.[1]).find(Boolean) ?? "run script",
  target: (_a, r) => { const calls = r?.details?.calls; if (!Array.isArray(calls)) return ""; const failures = calls.filter((c: any) => c.status === "error" || c.status === "cancelled").length;
    return joinFacts(count(calls.length, "calls"), failures ? `${failures} failed` : "", calls.find((c: any) => c.status === "running")?.name ? `${calls.find((c: any) => c.status === "running").name} running` : ""); },
  summary: (r) => { const cost = (r.details?.calls ?? []).reduce((total: number, c: any) => total + (typeof c.cost === "number" ? c.cost : 0), 0);
    return joinFacts(output(r).trim().split("\n")[0] || "done", cost ? `$${cost.toFixed(2)}` : ""); },
  errorSummary: (r) => output(r).trim().split("\n")[0] || "script failed",
  failed: (r) => !!r.isError || /^Script failed\b/.test(resultText(r)) || (r.details?.calls ?? []).some((c: any) => c.status === "error" || c.status === "cancelled"),
  expanded: (r, a) => {
    const script = String(a.code ?? "");
    let lines: string[]; try { lines = highlightCode(script, "javascript"); } catch { lines = script.split("\n"); }
    const calls = (r.details?.calls ?? []).flatMap((c: any) => {
      let args: any; try { args = JSON.parse(c.args); } catch { args = {}; }
      const { icon, color } = style(c.name);
      const target = args.reasoning ?? args.path ?? args.command ?? args.pattern ?? c.args ?? "";
      const mark = c.status === "ok" ? "✓" : c.status === "running" ? "·" : "✗";
      return [`${mark} ${color}${icon}${RESET} ${target}${typeof c.durationMs === "number" ? ` ${DIM}· ${formatElapsed(c.durationMs)}${RESET}` : ""}`, ...(c.error ? [`    ${c.error}`] : [])];
    });
    return [...lines, "", ...calls, "", ...output(r).split("\n")];
  },
};
