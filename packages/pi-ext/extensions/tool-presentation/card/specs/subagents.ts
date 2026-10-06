import { CYAN, MAGENTA } from "../../tidy/render.js";
import { basename, count, firstLine, joinFacts, rawExpanded, resultText, type CardSpec, type CardResult } from "../spec.js";
const shortId = (id: unknown): string => String(id ?? "").replace(/^([0-9a-f]{8})-[0-9a-f-]+$/i, "$1");
const status = (r: CardResult): string => r.details?.status ?? resultText(r).match(/Status:\s*([\w-]+)/i)?.[1]?.toLowerCase() ?? "";
const failed = (r: CardResult) => ["error", "aborted", "stopped"].includes(status(r)) || ["not_found", "not_running"].includes(r.details?.kind) || /Agent not found|No agent found|not running|Unknown agent type|Error:/i.test(resultText(r));
const resultSummary = (r: CardResult): string => {
  const d = r.details ?? {}; const s = status(r);
  if (r.details?.kind === "not_found" || /Agent not found|No agent found/i.test(resultText(r))) return "no such agent";
  if (s === "background") return joinFacts("background", shortId(d.agentId));
  if (s === "error") return d.error ?? firstLine(r);
  if (s === "aborted") return "max turns";
  if (s === "stopped") return "stopped";
  if (s === "steered") return "wrapped up";
  return joinFacts(s === "running" ? d.activity ?? "running" : s === "completed" ? "done" : s || firstLine(r), count(d.toolUses ?? (Number(resultText(r).match(/Tool uses:\s*(\d+)/i)?.[1]) || undefined), "tools"), d.tokens ? `${d.tokens} tok` : resultText(r).match(/([\d.]+k?)\s*(?:tok|tokens)/i)?.[0]);
};
export const subagentSpecs: Record<string, CardSpec> = {
  Agent: { icon: "󰚩", color: MAGENTA, label: "agent", headline: (a) => a.description ?? "run agent", target: (a) => `@${a.name ?? a.subagent_type ?? "agent"}`,
    summary: resultSummary, failed, running: resultSummary,
    expanded: (r, a) => [joinFacts(r.details?.modelName, r.details?.tags?.join(", "), count(r.details?.turnCount, "turns")), String(a.prompt ?? ""), ...rawExpanded(r)].filter(Boolean) },
  SubagentWorkflow: { icon: "󰒪", color: MAGENTA, label: "workflow", headline: (a) => a.meta?.description ?? (basename(a.scriptPath) || "workflow"),
    target: (a, r) => r?.details?.taskId ?? basename(a.scriptPath), summary: (r) => joinFacts(r.details?.taskId ? "background" : firstLine(r), count(r.details?.agentCount, "agents"), r.details?.tokens ? `${r.details.tokens} tok` : ""),
    failed: (r) => !!r.isError || /error|missing|failed/i.test(firstLine(r)), expanded: rawExpanded,
    running: (r) => r.details?.workflowProgress?.phaseTitle ?? "running" },
  get_subagent_result: { icon: "󰄠", color: CYAN, label: "result", headline: (a) => a.wait ? "wait for result" : "get result", target: (a) => `@${shortId(a.agent_id)}`, summary: resultSummary, failed, expanded: rawExpanded },
  steer_subagent: { icon: "󰓔", color: MAGENTA, label: "steer", headline: () => "steer agent", target: (a) => `@${shortId(a.agent_id)}`,
    summary: (r, a) => r.details?.kind === "not_running" || /not running|already finished|not found/i.test(resultText(r)) ? firstLine(r) : `${/queued/i.test(resultText(r)) ? "queued" : "sent"} "${a.message ?? ""}"`, failed, expanded: rawExpanded },
};
