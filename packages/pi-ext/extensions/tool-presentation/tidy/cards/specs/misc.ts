import { CYAN, YELLOW, MAGENTA, DIM, RESET } from "../../render.js";
import { shortPath } from "../../render.js";
import { basename, count, detailsError, firstLine, joinFacts, oneLine, rawExpanded, resultText, shortUrl, type CardSpec } from "../spec.js";
const BLUE = "\x1b[34m";
const base = { failed: detailsError, expanded: rawExpanded };
const dim = (text: string) => `${DIM}${text}${RESET}`;

export const miscSpecs: Record<string, CardSpec> = {
  session_query: { ...base, icon: "󰭻", color: CYAN, label: "session", headline: (a) => a.question,
    target: (a) => `${basename(a.sessionPath)}${a.detailed ? " · detailed" : ""}`,
    failed: (r) => detailsError(r) || !!r.details?.cancelled,
    running: () => "loading", summary: (r) => r.details?.cancelled ? "cancelled" : r.details?.empty ? dim("empty") : "answered",
    expanded: (r) => resultText(r).replace(/^\*\*Query:\*\*[^\n]*\n\n---\n\n/, "").split("\n") },
  search_sessions: { ...base, icon: "󰋚", color: CYAN, label: "sessions", headline: () => "search sessions", target: (a) => `"${a.query}"`,
    summary: (r) => r.details?.empty || r.details?.resultCount === 0 ? dim("no matches") : count(r.details?.resultCount, "sessions") },
  wtf: { ...base, icon: "󱃞", color: YELLOW, label: "wtf", headline: (a) => String(a.note ?? "").split(/[.!?](?:\s|$)/)[0], target: () => "",
    summary: (r) => basename(r.details?.path), expanded: (_r, a) => String(a.note ?? "").split("\n") },
  handoff: { ...base, icon: "󰔰", color: MAGENTA, label: "handoff", headline: (a) => a.goal || "continue in new session", target: (a) => a.tab ? "tab" : "split",
    summary: () => "new session started", expanded: (r, a) => String(r.details?.goal ?? a.goal ?? "").split("\n") },
  cmux_browser: { ...base, icon: "󰾔", color: MAGENTA, label: "browser", headline: (a) => `browser ${a.action ?? ""}`, target: (a) => shortUrl(a.url ?? a.selector), summary: firstLine },
  cmux_workspace: { ...base, icon: "󰯌", color: MAGENTA, label: "pane", headline: (a) => `pane ${a.action ?? ""}`, target: (a) => a.surface_id ?? a.direction ?? "", summary: firstLine },
  cmux_notify: { ...base, icon: "󰂞", color: BLUE, label: "notify", headline: (a) => a.title, target: (a) => a.subtitle ?? "", summary: () => "sent" },
  cursor_ask_question: { ...base, icon: "󱜺", color: BLUE, label: "ask", headline: (a) => a.questions?.[0]?.question ?? a.questions?.[0]?.prompt ?? a.question ?? a.prompt ?? "ask the user",
    target: (a) => count(a.questions?.length ?? 1, "questions"), running: () => "waiting for you", failed: (r) => detailsError(r) || !!r.details?.cancelled,
    summary: (r) => (r.details?.answers ?? []).map((a: any) => a.answer ?? "cancelled").join("; ") },
  // Replay-only activity card the Cursor SDK package emits for work Pi has no tool for. Args and details are duck-typed.
  cursor: { ...base, icon: "󰳽", color: BLUE, label: "cursor", headline: (a) => oneLine(a.activityTitle) || "Cursor activity",
    // The activity summary is already the whole story, so there is no separate target.
    target: () => "",
    running: () => "running", failed: (r) => detailsError(r) || !!r.isError,
    summary: (r, a) => {
      const d = r.details ?? {};
      const lines = typeof d.linesAdded === "number" || typeof d.linesRemoved === "number" ? `+${d.linesAdded ?? 0}/-${d.linesRemoved ?? 0}` : "";
      return joinFacts(oneLine(d.summary ?? a.activitySummary) || firstLine(r), lines) || "completed";
    },
    errorSummary: (r) => resultText(r).split("\n").find((l) => /^error\s*:/i.test(l.trim()))?.trim() ?? (typeof r.details?.error === "string" ? r.details.error : firstLine(r)),
    expanded: (r) => (r.details?.diffString ?? r.details?.diff ?? r.details?.expandedText ?? resultText(r)).split("\n") },
  cursor_activate_skill: { ...base, icon: "󱐋", color: MAGENTA, label: "skill", headline: () => "activate skill", target: (a) => a.name,
    summary: (r) => count(r.details?.resources?.length, "resources") },
  ask_user: { ...base, icon: "󱜸", color: BLUE, label: "ask", headline: (a) => a.question,
    target: (a) => a.options?.length ? `${count(a.options.length, "options")}${a.allowMultiple ? " · multi" : ""}` : "freeform",
    running: () => "waiting for you", failed: (r) => !!r.details?.cancelled || detailsError(r),
    summary: (r) => {
      const response = r.details?.response;
      if (!response) return "cancelled";
      return (response.kind === "selection" ? (response.selections ?? []).join(", ") : response.text ?? response.value ?? "answered") + (response.comment ? ` — ${response.comment}` : "");
    },
    expanded: (r, a) => {
      const d = r.details ?? {}; const response = d.response;
      return [d.context ?? a.context ?? "", ...(d.options ?? a.options ?? []).map((o: any) => `${response?.selections?.includes(o.title) ? "●" : "○"} ${o.title}${o.description ? `: ${o.description}` : ""}`), response?.text ?? "", response?.comment ?? ""].filter(Boolean);
    } },
  add_directory: { ...base, icon: "󰉗", color: YELLOW, label: "adddir", headline: (a) => a.reason || "add directory", target: (a, r) => shortPath(r?.details?.directory ?? a.path ?? ""),
    summary: (r) => joinFacts(r.details?.hasAgentsMd ? "AGENTS.md" : r.details?.hasClaudeMd ? "CLAUDE.md" : "", count(r.details?.skillCount, "skills"), r.details?.extensionCount ? count(r.details.extensionCount, "ext") : "", r.details?.reload ? "reload" : ""),
    expanded: (r) => [(r.details?.skillNames ?? []).join(", ")] },
  search_external_files: { ...base, icon: "󰈞", color: CYAN, label: "extfind", headline: () => "find external files", target: (a) => a.pattern,
    summary: (r) => `${r.details?.totalFound ?? 0} files${r.details?.dirCount === undefined ? "" : ` in ${r.details.dirCount} dirs`}` },
  choose_visual_artifact_direction: { ...base, icon: "󰏘", color: BLUE, label: "look", headline: (a) => a.question, target: (a) => count(a.directions?.length ?? 0, "directions"),
    running: () => "waiting for you", failed: (r) => !!r.details?.cancelled || detailsError(r), summary: (r) => r.details?.selected?.title ?? "cancelled",
    expanded: (r, a) => (r.details?.directions ?? a.directions ?? []).flatMap((d: any) => [`${d.title === r.details?.selected?.title ? "●" : "○"} ${d.title}: ${d.description}`, d.instruction]) },
  create_visual_artifact: { ...base, icon: "󱕍", color: YELLOW, label: "artifact", headline: (a) => a.title, target: (a) => joinFacts(a.artifactType ?? "artifact", `${a.nodes?.length ?? 0} nodes`),
    summary: (r) => shortUrl(r.details?.url), expanded: (r, a) => [a.description, a.topics?.join(", "), r.details?.path, r.details?.url].filter(Boolean) },
  web_enable: { ...base, icon: "󰀳", color: YELLOW, label: "web", headline: () => "enable web tools", target: () => "",
    failed: (r) => detailsError(r) || !!r.details?.unavailable || !!r.details?.missing,
    summary: (r) => Array.isArray(r.details?.enabled) ? `${r.details.enabled.length} tools enabled` : firstLine(r) },
  plannotator_mark_done: { ...base, icon: "󰄴", color: YELLOW, label: "plan", headline: () => "mark step done", target: (a) => `step ${a.step}`,
    failed: (r) => r.details?.completed === false || detailsError(r), summary: firstLine },
  plannotator_submit_plan: { ...base, icon: "󰳹", color: BLUE, label: "plan", headline: () => "submit plan", target: (a) => shortPath(a.filePath ?? ""),
    running: () => "waiting for you", failed: (r) => r.details?.approved === false || detailsError(r), summary: (r) => r.details?.approved ? "approved" : r.details?.approved === false ? r.details.feedback || "changes requested" : "handed off" },
};
