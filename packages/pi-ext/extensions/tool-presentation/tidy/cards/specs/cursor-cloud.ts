import { CYAN, MAGENTA } from "../../render.js";
const BLUE = "\x1b[34m";
import { firstLine, joinFacts, oneLine, rawExpanded, resultText, type CardResult, type CardSpec } from "../spec.js";

// Tool results use details.agent/details.agents; completion messages use details directly.
type Agent = { id: string; url: string; name: string; status: string; repo: string; ref: string; model: string; elapsedMs: number; tools: number; activity: string; text?: string; error?: string };
const agent = (r: CardResult): Agent | undefined => r.details?.agent ?? r.details?.agents?.[0];
const repoName = (url: string) => url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? url;
const clock = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const facts = (a: Agent) => joinFacts(a.status, clock(a.elapsedMs), `${a.tools} tool${a.tools === 1 ? "" : "s"}`);
const failed = (r: CardResult) => !!r.isError || /^(No cloud agent|Agent already has|Cloud agent handle|Session shut down)/.test(firstLine(r));
const metadata = (a: Agent) => [["id", a.id], ["repo", `${a.repo} @ ${a.ref}`], ["model", a.model], ["url", a.url]].map(([k, v]) => `${k.padEnd(6)}${v}`);
const details = (a: Agent) => [joinFacts(`${repoName(a.repo)} @ ${a.ref}`, a.model), `url   ${a.url}`, a.activity && `Last: ${a.activity}`].filter(Boolean) as string[];
const open = (r: CardResult) => { const a = agent(r); return a?.url ? { label: "Open ↗", url: a.url } : undefined; };
const expanded = (r: CardResult): string[] => {
  const agents: Agent[] = r.details?.agents ?? (r.details?.agent ? [r.details.agent] : []);
  if (!agents.length) return rawExpanded(r);
  return agents.flatMap((a, i) => [...(i ? [""] : []), `${a.name} ${a.id} · ${facts(a)}`, ...details(a), ...(a.text ? ["", ...a.text.split("\n")] : [])]);
};
const completionSummary = (r: CardResult) => {
  const a: Agent | undefined = r.details;
  if (!a?.status) return firstLine(r);
  const status = a.status === "idle" ? "finished" : a.status;
  return joinFacts(status, clock(a.elapsedMs), a.status === "failed" ? `Error: ${(a.error || "Cloud run failed.").split("\n")[0]}`
    : `${a.tools} tool${a.tools === 1 ? "" : "s"}`, a.status === "failed" ? undefined : `${repoName(a.repo)} @ ${a.ref}`);
};

export const cursorCloudSpecs: Record<string, CardSpec> = {
  cursor_cloud_completion: { icon: "󰅟", color: BLUE, label: "cursor cloud", headline: (a) => oneLine(a.prompt) || "cloud agent completed",
    target: (_a, r) => r?.details?.name ?? "", summary: completionSummary, errorSummary: completionSummary,
    failed: (r) => r.details?.status === "failed",
    link: (r) => r.details?.url ? { label: "Open in Cursor ↗", url: r.details.url } : undefined,
    expanded: (r) => {
      const a: Agent | undefined = r.details;
      if (!a?.url) return rawExpanded(r).map(line => `│ ${line}`);
      return [...metadata(a).map(line => `│ ${line}`), "│", ...(a.text || "No result text.").split("\n").map(line => `│ ${line}`)];
    } },
  cursor_cloud_spawn: { icon: "󰅟", color: BLUE, label: "cursor cloud", headline: (a) => oneLine(a.prompt) || "spawn cloud agent",
    target: (a, r) => agent(r ?? {})?.name ?? a.name ?? "",
    summary: (r) => { const a = agent(r); return a ? joinFacts("background", a.id, `${repoName(a.repo)} @ ${a.ref}`) : firstLine(r); },
    failed, expanded, link: open, running: () => "creating agent" },
  cursor_cloud_send: { icon: "󰅟", color: MAGENTA, label: "cursor cloud", headline: (a) => oneLine(a.prompt) || "follow up",
    target: (a) => `@${a.id ?? ""}`, summary: (r) => failed(r) ? firstLine(r) : "follow-up sent", failed, expanded, link: open },
  cursor_cloud_cancel: { icon: "󰅟", color: MAGENTA, label: "cursor cloud", headline: () => "cancel run",
    target: (a) => `@${a.id ?? ""}`, summary: (r) => /already/.test(firstLine(r)) ? firstLine(r).replace(/^Cloud agent \S+ is /, "") : failed(r) ? firstLine(r) : "cancel requested",
    failed, expanded, link: open },
  cursor_cloud_status: { icon: "󰅟", color: CYAN, label: "cursor cloud", headline: (a) => a.id ? "status" : "status of all",
    target: (a) => a.id ? `@${a.id}` : "",
    summary: (r) => {
      const all: Agent[] | undefined = r.details?.agents;
      if (!all) return failed(r) ? firstLine(r) : resultText(r) ? "status" : "";
      if (all.length === 1) return facts(all[0]);
      return all.length ? `${all.length} agents · ${all.filter((a) => a.status === "running" || a.status === "starting").length} running` : "no agents";
    },
    failed, expanded, link: (r, a) => a.id ? open(r) : undefined },
};
