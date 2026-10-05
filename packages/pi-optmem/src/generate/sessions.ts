// Discover Pi sessions and extract what a distiller needs: user messages and
// the assistant's final text per turn. No model involved.
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

export const SESSION_CHAR_CAP = 12_000;
const USER_MAX = 1_000;
const ASSISTANT_MAX = 800;

export type SessionHeader = {
  readonly path: string;
  readonly id: string;
  readonly timestamp: string;
  readonly cwd: string;
  readonly parentSession?: string;
};

export type Turn = { user: string; assistant: string };

export type Extracted = {
  readonly session: SessionHeader;
  /** Local date (YYYY-MM-DD) of the first kept entry. */
  readonly date: string;
  /** ISO time of the newest kept entry. */
  readonly lastTime: string;
  readonly turns: Turn[];
};

/** `/private/tmp`, `/tmp` and review worktrees are scratch work. */
export function skipSlug(slug: string): boolean {
  return slug.startsWith("--private-tmp") || slug.startsWith("--tmp-") || slug === "--tmp--" || slug.includes("review-pr-");
}

function firstLine(path: string): string {
  const fd = openSync(path, "r");
  try {
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(4096);
    for (let offset = 0; offset < 1_048_576; ) {
      const read = readSync(fd, buffer, 0, buffer.length, offset);
      if (read <= 0) break;
      const newline = buffer.subarray(0, read).indexOf(10);
      if (newline >= 0) {
        chunks.push(Buffer.from(buffer.subarray(0, newline)));
        break;
      }
      chunks.push(Buffer.from(buffer.subarray(0, read)));
      offset += read;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export function parseHeader(path: string, line: string): SessionHeader | undefined {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type !== "session" || typeof value.timestamp !== "string" || typeof value.id !== "string") return undefined;
    return {
      path,
      id: value.id,
      timestamp: value.timestamp,
      cwd: typeof value.cwd === "string" ? value.cwd : "",
      parentSession: typeof value.parentSession === "string" ? value.parentSession : undefined,
    };
  } catch {
    return undefined;
  }
}

/**
 * Top-level sessions only: `<dir>/<slug>/<file>.jsonl`. Deeper files are
 * pi-subagents runs, forks and transcripts. Sorted by start time.
 */
export function discoverSessions(sessionsDir: string): SessionHeader[] {
  const out: SessionHeader[] = [];
  let slugs: string[];
  try {
    slugs = readdirSync(sessionsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
  for (const slug of slugs) {
    if (skipSlug(slug)) continue;
    const dir = join(sessionsDir, slug);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(dir, entry.name);
      const header = parseHeader(path, firstLine(path));
      if (header) out.push(header);
    }
  }
  return out.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.path.localeCompare(b.path));
}

/** Cheap count for the onboarding hint: no file reads. */
export function countSessionFiles(sessionsDir: string): number {
  let count = 0;
  try {
    for (const slug of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!slug.isDirectory() || skipSlug(slug.name)) continue;
      count += readdirSync(join(sessionsDir, slug.name)).filter((name) => name.endsWith(".jsonl")).length;
    }
  } catch {
    return count;
  }
  return count;
}

export function localDate(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "text")
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("\n");
}

/** Skill expansions and file attachments are noise for distilling. */
export function cleanUserText(text: string): string {
  return text
    .replace(/<skill name="([^"]*)"[^>]*>[\s\S]*?<\/skill>/g, "[skill $1]")
    .replace(/<file name="([^"]*)"[^>]*>[\s\S]*?<\/file>/g, "[file $1]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Turns from a session file. Entries before `after` are dropped: a child
 * session's copied parent history, or what an earlier catch-up already saw.
 */
export function extractSession(session: SessionHeader, text: string, after?: string): Extracted | undefined {
  const keep = (time: string | undefined): boolean => {
    if (session.parentSession && (!time || time < session.timestamp)) return false;
    if (after && (!time || time <= after)) return false;
    return true;
  };
  const turns: Turn[] = [];
  let first: string | undefined;
  let last: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (entry.type !== "message") continue;
    const time = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    if (!keep(time)) continue;
    const message = entry.message as { role?: unknown; content?: unknown } | undefined;
    if (message?.role === "user") {
      const user = cleanUserText(textOf(message.content));
      if (!user) continue;
      turns.push({ user, assistant: "" });
    } else if (message?.role === "assistant") {
      const reply = textOf(message.content).trim();
      // The last assistant text before the next user message is the turn's answer.
      if (reply && turns.length) turns[turns.length - 1]!.assistant = reply;
    } else {
      continue;
    }
    if (time) {
      first ??= time;
      last = time;
    }
  }
  if (!turns.length || !first || !last) return undefined;
  return { session, date: localDate(first), lastTime: last, turns };
}

export function readAndExtract(session: SessionHeader, after?: string): Extracted | undefined {
  return extractSession(session, readFileSync(session.path, "utf8"), after);
}

function render(turns: readonly Turn[]): string {
  return turns.map((t) => `U: ${t.user}${t.assistant ? `\nA: ${t.assistant}` : ""}`).join("\n\n");
}

/**
 * Render turns within `cap` characters. Every user message stays; assistant
 * replies go first from the middle, then middle user messages shrink.
 */
export function capTranscript(turns: readonly Turn[], cap = SESSION_CHAR_CAP): string {
  const work = turns.map((t) => ({ user: clip(t.user, USER_MAX), assistant: clip(t.assistant, ASSISTANT_MAX) }));
  let text = render(work);
  if (text.length <= cap) return text;
  const middle = (n: number) => {
    const order: number[] = [];
    const keep = Math.min(2, Math.floor(n / 2));
    for (let i = keep; i < n - keep; i++) order.push(i);
    const mid = (n - 1) / 2;
    return order.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  };
  for (const i of middle(work.length)) {
    work[i]!.assistant = "";
    text = render(work);
    if (text.length <= cap) return text;
  }
  for (const max of [300, 120, 60]) {
    for (const i of middle(work.length)) work[i]!.user = clip(work[i]!.user, max);
    text = render(work);
    if (text.length <= cap) return text;
  }
  // Very long sessions: keep the head and the tail.
  const half = Math.floor((cap - 20) / 2);
  return `${text.slice(0, half)}\n\n[… middle cut …]\n\n${text.slice(-half)}`;
}
