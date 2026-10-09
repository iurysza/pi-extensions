export interface BranchInfo {
  repoUrl: string;
  branch?: string;
  prUrl?: string;
}

export interface Outcome {
  text: string;
  durationMs: number;
  branches: readonly BranchInfo[];
}

export type Status =
  | { type: "starting" }
  | { type: "running"; runId: string }
  | { type: "idle"; result: Outcome; endedAt: number }
  | { type: "failed"; error: string; result: Outcome; endedAt: number }
  | { type: "cancelled"; result: Outcome; endedAt: number };

export interface CloudAgent {
  id: string;
  name: string;
  description: string;
  repo: string;
  ref: string;
  model: string;
  startedAt: number;
  status: Status;
  activity: string;
  text: string;
  tools: number;
  toolCallIds: readonly string[];
}

export type State = readonly CloudAgent[];
export type Activity =
  | { type: "thinking" }
  | { type: "text"; text: string; replace?: boolean }
  | { type: "tool"; callId: string; activity: string }
  | { type: "activity"; activity: string };

export type Event =
  | { type: "spawned"; agent: CloudAgent }
  | { type: "removed"; id: string }
  | { type: "running"; id: string; runId: string }
  | { type: "delta" | "step"; id: string; activity: Activity }
  | { type: "followUp"; id: string; prompt: string; now: number }
  | { type: "finished" | "cancelled"; id: string; result: Outcome; now: number }
  | { type: "error"; id: string; error: string; result: Outcome; now: number };

export const shortId = (id: string): string => id.replace(/^bc-/, "").slice(0, 8);
export const isActive = (agent: CloudAgent): boolean =>
  agent.status.type === "starting" || agent.status.type === "running";

export function visibleAgents(state: State, now: number): State {
  return state.filter(a => isActive(a) || ("endedAt" in a.status && now - a.status.endedAt < 60_000))
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a)));
}

export function elapsedMs(agent: CloudAgent, now: number): number {
  return "result" in agent.status ? agent.status.result.durationMs : Math.max(0, now - agent.startedAt);
}

/** Ignore late stream events and duplicate terminal events. Only followUp reopens a settled agent. */
export function reduce(state: State, event: Event): State {
  if (event.type === "spawned") return state.some(a => a.id === event.agent.id) ? state : [...state, event.agent];
  if (event.type === "removed") return state.filter(a => a.id !== event.id);
  return state.map(agent => {
    if (agent.id !== event.id) return agent;
    if (event.type === "followUp") {
      if (isActive(agent)) return agent;
      return { ...agent, startedAt: event.now, description: event.prompt, status: { type: "starting" },
        activity: "starting…", text: "", tools: 0, toolCallIds: [] };
    }
    if (!isActive(agent)) return agent;
    switch (event.type) {
      case "running": return { ...agent, status: { type: "running", runId: event.runId } };
      case "finished": return { ...agent, status: { type: "idle", result: event.result, endedAt: event.now }, activity: "finished" };
      case "cancelled": return { ...agent, status: { type: "cancelled", result: event.result, endedAt: event.now }, activity: "cancelled" };
      case "error": return { ...agent, status: { type: "failed", error: event.error, result: event.result, endedAt: event.now }, activity: event.error };
      case "delta":
      case "step": {
        const update = event.activity;
        switch (update.type) {
          case "thinking": return { ...agent, activity: "thinking…" };
          case "activity": return { ...agent, activity: update.activity };
          case "text": {
            const text = update.replace ? update.text : agent.text + update.text;
            return { ...agent, text, activity: text.slice(-240) };
          }
          case "tool": {
            const seen = agent.toolCallIds.includes(update.callId);
            return { ...agent, activity: update.activity, tools: agent.tools + Number(!seen),
              toolCallIds: seen ? agent.toolCallIds : [...agent.toolCallIds, update.callId] };
          }
        }
      }
    }
  });
}
