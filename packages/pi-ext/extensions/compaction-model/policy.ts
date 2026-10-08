/**
 * Hermes-style additions to Pi's compaction summary. These are pure functions,
 * so the hook stays thin and the tests need no Pi runtime.
 */

const ANCHOR_OPEN = "<session-start verbatim>";
const ANCHOR_CLOSE = "</session-start>";
const POINTER_OPEN = "<summary-note>";
const POINTER_CLOSE = "</summary-note>";
const ANCHOR_MAX_CHARS = 2000;

/** Appended to Pi's prompt; Pi's sections stay as they are. */
export const EXTRA_INSTRUCTIONS = [
  "Also record, inside the existing sections:",
  "- approaches that were tried and failed, and why;",
  "- the last test or build command and its result;",
  "- exact error messages that are still unresolved;",
  "- preferences the user stated.",
  "Keep exact paths, commands and identifiers verbatim.",
].join("\n");

export function mergeInstructions(extra: string, user?: string): string {
  return user?.trim() ? `${extra}\n\n${user.trim()}` : extra;
}

type Entry = { type: string; message?: { role?: string; content?: unknown } };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** The first user message of the branch: what the session set out to do. */
export function firstUserText(entries: readonly Entry[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== "message" || entry.message?.role !== "user") continue;
    const text = textOf(entry.message.content).trim();
    if (text) return text.length > ANCHOR_MAX_CHARS ? `${text.slice(0, ANCHOR_MAX_CHARS)}\n[… truncated]` : text;
  }
  return undefined;
}

function cut(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  if (start < 0) return text;
  const end = text.indexOf(close, start);
  if (end < 0) return text;
  return (text.slice(0, start) + text.slice(end + close.length)).trim();
}

/** Remove our own blocks, so the model never rewrites or duplicates them. */
export function stripAdditions(summary: string): string {
  return cut(cut(summary, ANCHOR_OPEN, ANCHOR_CLOSE), POINTER_OPEN, POINTER_CLOSE);
}

/** Wrap the model's summary with the verbatim session start and a pointer back to the evidence. */
export function decorateSummary(summary: string, anchor: string | undefined, sessionFile: string | undefined): string {
  const parts: string[] = [];
  if (anchor) parts.push(`${ANCHOR_OPEN}\n${anchor}\n${ANCHOR_CLOSE}`);
  parts.push(stripAdditions(summary));
  const where = sessionFile ? ` in ${sessionFile}` : " in this session's file";
  parts.push(
    `${POINTER_OPEN}\nThis summary is reference only. Follow the latest user message.` +
      ` The full text of the summarised turns is still${where}.` +
      ` When exact wording, output or errors matter, look them up with session_query or search_sessions instead of guessing.\n${POINTER_CLOSE}`,
  );
  return parts.join("\n\n");
}

/** True when context use has crossed the configured percent of the window. */
export function overThreshold(usage: { tokens: number | null; contextWindow: number } | undefined, percent: number | undefined): boolean {
  if (!usage || usage.tokens === null || !percent || usage.contextWindow <= 0) return false;
  return usage.tokens >= (usage.contextWindow * percent) / 100;
}
