import { CYAN, MAGENTA, YELLOW } from "../../render.js";
import { shortPath } from "../../render.js";
import { basename, firstLine, joinFacts, oneLine, rawExpanded, resultText, shortUrl, type CardArgs, type CardResult, type CardSpec } from "../spec.js";
const BLUE = "\x1b[34m";

const asList = (value: unknown): string[] => (Array.isArray(value) ? value : value ? [value] : []).map(String);
/** Short name for a file, folder, URL or PR target. */
const targetName = (value: string): string => /^https?:\/\//.test(value) ? shortUrl(value) : shortPath(value);
const failedText = (r: CardResult): boolean => !!r.isError || !!r.details?.error;

const VERB: Record<string, string> = { annotate: "annotate", review: "review code", last: "annotate last message", list: "open reviews", close: "close review" };

/** The `plannotator` tool: opens a browser review, or lists and closes the open ones. */
const plannotator: CardSpec = {
  icon: "󰏫", color: BLUE, label: "plannotator", failed: failedText, expanded: rawExpanded,
  headline: (a) => VERB[a.action] ?? oneLine(a.action) ?? "plannotator",
  target: (a) => {
    if (a.action === "close") return a.session ?? "";
    const targets = asList(a.target);
    if (!targets.length) return "";
    return targets.length > 1 ? `${targetName(targets[0])} +${targets.length - 1}` : targetName(targets[0]);
  },
  running: (_p, a) => a.action === "list" || a.action === "close" ? "working" : "opening",
  summary: (r, a) => {
    const d = r.details ?? {};
    if (a.action === "list") {
      const n = resultText(r).split("\n").filter((l) => /\bpn-[\w-]+/.test(l)).length;
      return n ? `${n} open` : "none open";
    }
    if (a.action === "close") return firstLine(r) || "closed";
    return joinFacts(d.session, a.gate ? "gated" : "", d.url ? shortUrl(d.url) : "") || "opened";
  },
  link: (r) => r.details?.url ? { label: "Open ↗", url: r.details.url } : undefined,
};

const INBOX_VERB: Record<string, string> = {
  send_message: "send message", read_thread: "read thread", search: "search inbox", resolve_message: "resolve",
  snooze_thread: "snooze thread", thread_pulls: "thread PRs", submit_guide: "submit guide", get_guide_brief: "guide brief", card: "board card", steps: "update steps",
};
const questionCount = (body: unknown): number => (String(body ?? "").match(/^:::question(?:-multi|-text)?\s*$/gm) ?? []).length;
const firstBodyLine = (body: unknown): string => oneLine(String(body ?? "").split("\n").find((l) => l.trim() && !l.startsWith(":::")));

/** The `plannotator_inbox` tool: messages and questions the person answers later. */
const plannotatorInbox: CardSpec = {
  icon: "󰇮", color: MAGENTA, label: "inbox", failed: failedText, expanded: (r, a) => {
    const body = a.action === "send_message" && a.body ? [...String(a.body).split("\n"), ""] : [];
    return [...body, ...rawExpanded(r)];
  },
  headline: (a) => {
    switch (a.action) {
      case "send_message": return oneLine(a.subject) || firstBodyLine(a.body) || INBOX_VERB.send_message;
      case "submit_guide": return oneLine(a.subject) || INBOX_VERB.submit_guide;
      case "card": return oneLine(a.title) || `card ${a.op ?? ""}`.trim();
      case "search": return `search "${oneLine(a.query)}"`;
      default: return INBOX_VERB[a.action] ?? oneLine(a.action) ?? "inbox";
    }
  },
  target: (a) => {
    switch (a.action) {
      case "send_message": case "submit_guide": return a.reply_to ? "reply" : a.thread ? `thread: ${oneLine(a.thread)}` : "new thread";
      case "read_thread": return a.thread_id ?? "all threads";
      case "card": return joinFacts(a.op, a.column);
      case "steps": return `${a.steps?.length ?? 0} steps`;
      case "resolve_message": return a.message_id ?? "";
      default: return a.thread_id ?? "";
    }
  },
  running: () => "sending",
  summary: (r, a) => {
    if (a.action === "send_message") {
      const q = questionCount(a.body);
      const att = asList(a.attachments).length;
      return joinFacts("sent", q ? `${q} question${q === 1 ? "" : "s"}` : "", att ? `${att} file${att === 1 ? "" : "s"}` : "");
    }
    if (a.action === "steps") return joinFacts(`${a.steps?.filter((s: any) => s.status === "done").length ?? 0}/${a.steps?.length ?? 0} done`);
    return firstLine(r) || "done";
  },
};

export const plannotatorSpecs: Record<string, CardSpec> = { plannotator, plannotator_inbox: plannotatorInbox };
