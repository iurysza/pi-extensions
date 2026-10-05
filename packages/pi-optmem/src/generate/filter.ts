// Deterministic post-filter for distilled lines. The prompt already forbids
// secrets; this is the backstop. It over-drops on purpose.

export const LINE_BYTES = 280;

export type DropReason = "format" | "too-long" | "digits" | "email" | "iban" | "token" | "money" | "phone" | "duplicate";

const RULES: readonly [DropReason, RegExp][] = [
  // 6+ digits in a row, or digit groups like 1234 5678 / 12-34-56-78 (card, ID, tax, bank numbers).
  ["digits", /\d{6,}|\d{3,}(?:[ .-]\d{2,}){2,}/],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ["iban", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,}/],
  // API keys and tokens: known prefixes, or a long mixed run of letters and digits.
  ["token", /\b(?:sk|pk|ghp|gho|ghs|xox[abp]|AKIA|AIza|eyJ)[-_A-Za-z0-9]{8,}|\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/],
  ["money", /[€$£]\s?\d|\b\d[\d.,]*\s?(?:€|EUR|USD|BRL|R\$|GBP|euros?|dollars?|reais)\b/i],
  ["phone", /\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/],
];

export function dropReason(text: string): DropReason | undefined {
  for (const [reason, pattern] of RULES) if (pattern.test(text)) return reason;
  return undefined;
}

export type DatedLine = { readonly date: string; readonly text: string };

const DATED = /^(\d{4}-\d{2}-\d{2}) (.+)$/;

function realDate(date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/** One model output line to a dated line, or a reason it was dropped. Bullets and quotes are tolerated. */
export function parseLine(raw: string): DatedLine | { drop: DropReason } | undefined {
  const line = raw.trim().replace(/^[-*•]\s+/, "").replace(/^`(.*)`$/, "$1").trim();
  if (!line || /^(none|nothing|no durable|n\/a)\b/i.test(line) || line.startsWith("===")) return undefined;
  const match = DATED.exec(line);
  if (!match || !realDate(match[1]!)) return { drop: "format" };
  const text = match[2]!.replace(/\s+/g, " ").trim();
  if (!text) return { drop: "format" };
  if (Buffer.byteLength(text, "utf8") > LINE_BYTES) return { drop: "too-long" };
  const reason = dropReason(text);
  return reason ? { drop: reason } : { date: match[1]!, text };
}

export type FilterResult = { lines: DatedLine[]; dropped: Partial<Record<DropReason, number>>; droppedTotal: number };

function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Validate, privacy-filter, de-duplicate and sort ascending by date (stable). */
export function filterLines(raw: readonly string[], seen: Set<string> = new Set()): FilterResult {
  const dropped: Partial<Record<DropReason, number>> = {};
  const lines: DatedLine[] = [];
  const count = (reason: DropReason) => (dropped[reason] = (dropped[reason] ?? 0) + 1);
  for (const item of raw) {
    const parsed = parseLine(item);
    if (!parsed) continue;
    if ("drop" in parsed) {
      count(parsed.drop);
      continue;
    }
    const key = dedupeKey(parsed.text);
    if (seen.has(key)) {
      count("duplicate");
      continue;
    }
    seen.add(key);
    lines.push(parsed);
  }
  lines.sort((a, b) => a.date.localeCompare(b.date));
  const droppedTotal = Object.values(dropped).reduce((sum, n) => sum + (n ?? 0), 0);
  return { lines, dropped, droppedTotal };
}

export function formatDropped(dropped: Partial<Record<DropReason, number>>): string {
  const parts = Object.entries(dropped).map(([reason, n]) => `${reason} ${n}`);
  return parts.length ? parts.join(", ") : "none";
}
