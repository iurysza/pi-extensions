import { CYAN, MAGENTA } from "../../render.js";
const BLUE = "\x1b[34m";
import { firstLine, joinFacts, oneLine, rawExpanded, resultText, type CardResult, type CardSpec } from "../spec.js";

// pi-cursor-cloud puts a summary in `details.agent` (or `details.agents` for status).
type Agent = { id: string; url: string; name: string; status: string; repo: string; ref: string; model: string; elapsedMs: number; tools: number; activity: string; text?: string };
const agent = (r: CardResult): Agent | undefined => r.details?.agent ?? r.details?.agents?.[0];
const repoName = (url: string) => url.replace(/\.git$/, "").split("/").filter(Boolean).pop() ?? url;
const clock = (ms: number) => { const s = Math.floor(Math.max(0, ms) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const facts = (a: Agent) => joinFacts(a.status, clock(a.elapsedMs), `${a.tools} tool${a.tools === 1 ? "" : "s"}`);
const failed = (r: CardResult) => !!r.isError || /^(No cloud agent|Agent already has|Cloud agent handle|Session shut down)/.test(firstLine(r));
const details = (a: Agent) => [joinFacts(`${repoName(a.repo)} @ ${a.ref}`, a.model), `Open: ${a.url}`, a.activity && `Last: ${a.activity}`].filter(Boolean) as string[];
const expanded = (r: CardResult): string[] => {
  const agents: Agent[] = r.details?.agents ?? (r.details?.agent ? [r.details.agent] : []);
  if (!agents.length) return rawExpanded(r);
  return agents.flatMap((a, i) => [...(i ? [""] : []), `${a.name} ${a.id} · ${facts(a)}`, ...details(a), ...(a.text ? ["", ...a.text.split("\n")] : [])]);
};

export const cursorCloudSpecs: Record<string, CardSpec> = {
  cursor_cloud_spawn: { icon: "󰅟", color: BLUE, label: "cloud", headline: (a) => oneLine(a.prompt) || "spawn cloud agent",
    target: (a, r) => agent(r ?? {})?.name ?? a.name ?? "",
    summary: (r) => { const a = agent(r); return a ? joinFacts("background", a.id, `${repoName(a.repo)} @ ${a.ref}`) : firstLine(r); },
    failed, expanded, running: () => "creating agent" },
  cursor_cloud_send: { icon: "󰅟", color: MAGENTA, label: "cloud", headline: (a) => oneLine(a.prompt) || "follow up",
    target: (a) => `@${a.id ?? ""}`, summary: (r) => failed(r) ? firstLine(r) : "follow-up sent", failed, expanded },
  cursor_cloud_cancel: { icon: "󰅟", color: MAGENTA, label: "cloud", headline: () => "cancel run",
    target: (a) => `@${a.id ?? ""}`, summary: (r) => /already/.test(firstLine(r)) ? firstLine(r).replace(/^Cloud agent \S+ is /, "") : failed(r) ? firstLine(r) : "cancel requested",
    failed, expanded },
  cursor_cloud_status: { icon: "󰅟", color: CYAN, label: "cloud", headline: (a) => a.id ? "status" : "status of all",
    target: (a) => a.id ? `@${a.id}` : "",
    summary: (r) => {
      const all: Agent[] | undefined = r.details?.agents;
      if (!all) return failed(r) ? firstLine(r) : resultText(r) ? "status" : "";
      if (all.length === 1) return facts(all[0]);
      return all.length ? `${all.length} agents · ${all.filter((a) => a.status === "running" || a.status === "starting").length} running` : "no agents";
    },
    failed, expanded },
};
