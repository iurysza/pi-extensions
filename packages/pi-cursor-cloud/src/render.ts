import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { elapsedMs, isActive, shortId, visibleAgents, type CloudAgent, type State } from "./state.js";

export type WidgetTheme = Pick<Theme, "fg" | "bold">;
export const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Cloud text is untrusted terminal input, not ANSI markup.
export const cleanText = (text: string): string => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
export const singleLine = (text: string): string => cleanText(text).replace(/\s+/g, " ").trim();
export function duration(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function renderWidget(state: State, theme: WidgetTheme, width: number, frame: number, now: number): string[] {
  const agents = visibleAgents(state, now);
  if (!agents.length || width < 1) return [];
  const active = agents.some(isActive);
  const color = active ? "accent" : "dim";
  const lines = [theme.fg(color, `${active ? "●" : "○"} Cloud agents`)];
  const total = agents.reduce((n, a) => n + (isActive(a) ? 2 : 1), 1);
  let budget = total > 12 ? 10 : 11;
  const shown: CloudAgent[] = [];
  for (const agent of agents) {
    const size = isActive(agent) ? 2 : 1;
    if (budget < size) break;
    shown.push(agent);
    budget -= size;
  }
  const hidden = agents.length - shown.length;
  shown.forEach((agent, index) => {
    const last = index === shown.length - 1 && hidden === 0;
    const running = isActive(agent);
    const status = agent.status.type;
    const icon = running ? theme.fg("accent", SPINNER[frame % SPINNER.length])
      : status === "idle" ? theme.fg("success", "✓")
      : status === "failed" ? theme.fg("error", "✗") : theme.fg("dim", "■");
    const name = theme.bold(singleLine(agent.name));
    const header = `${theme.fg("dim", last ? "└─" : "├─")} ${icon} ${name} ${theme.fg("dim", shortId(agent.id))}`;
    const stats = theme.fg("dim", `· ${duration(elapsedMs(agent, now))} · ${agent.tools} tools`);
    const available = Math.max(0, width - visibleWidth(`${header}   ${stats}`));
    const description = theme.fg("dim", truncateToWidth(singleLine(agent.description), available));
    lines.push(`${header}  ${description} ${stats}`);
    if (running) lines.push(theme.fg("dim", `${last ? " " : "│"}    ⎿  ${singleLine(agent.activity)}`));
  });
  if (hidden) lines.push(theme.fg("dim", `└─ +${hidden} more`));
  return lines.map(line => truncateToWidth(line, width));
}

export function formatCompletion(agent: CloudAgent): string {
  if (!("result" in agent.status)) return `Cloud agent ${shortId(agent.id)} is ${agent.status.type}.`;
  const { result } = agent.status;
  const label = agent.status.type === "idle" ? "finished" : agent.status.type === "failed" ? "failed" : "cancelled";
  const header = `Cloud agent ${singleLine(agent.name)} (${shortId(agent.id)}) ${label} · ${duration(result.durationMs)}`;
  const error = agent.status.type === "failed" ? `Error: ${cleanText(agent.status.error)}` : "";
  const branches = result.branches.map(b => [b.repoUrl, b.branch && `branch: ${b.branch}`, b.prUrl && `PR: ${b.prUrl}`].filter(Boolean).join(" · "));
  return [header, error, cleanText(result.text) || "No result text.", ...branches.map(cleanText)].filter(Boolean).join("\n\n");
}

export function formatList(state: State, now: number): string {
  if (!state.length) return "No cloud agents started in this process.";
  return ["ID        NAME                  STATUS      ELAPSED  REPO", ...state.map(a =>
    `${shortId(a.id).padEnd(10)}${singleLine(a.name).slice(0, 20).padEnd(22)}${a.status.type.padEnd(12)}${duration(elapsedMs(a, now)).padEnd(9)}${a.repo}`)].join("\n");
}
