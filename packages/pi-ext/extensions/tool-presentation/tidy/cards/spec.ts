export type CardArgs = Record<string, any>;
export type CardResult = { content?: readonly any[]; details?: any; isError?: boolean; output?: string; error?: string; message?: string };

/** Presentation only. A spec never changes arguments or results. */
export interface CardSpec {
  icon: string;
  color: string;
  label: string;
  headline(args: CardArgs): string;
  target(args: CardArgs, result?: CardResult): string;
  summary(result: CardResult, args: CardArgs): string;
  link?(result: CardResult, args: CardArgs): { label: string; url: string } | undefined;
  failed?(result: CardResult): boolean;
  errorSummary?(result: CardResult, args: CardArgs): string;
  running?(partial: CardResult, args: CardArgs): string;
  expanded?(result: CardResult, args: CardArgs): string[];
  /** Built-ins retain their historical formatting during extraction. */
  legacy?: boolean;
}

export function resultText(result: CardResult): string {
  const content = result?.content;
  if (Array.isArray(content)) return content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
  return result?.output ?? result?.error ?? result?.message ?? "";
}
export const oneLine = (value: unknown): string => String(value ?? "").replace(/\s+/g, " ").trim();
export const firstLine = (result: CardResult): string => resultText(result).trim().split("\n")[0] ?? "";
export const shortUrl = (value: unknown): string => oneLine(value).replace(/^https?:\/\/(www\.)?/, "");
export const basename = (value: unknown): string => oneLine(value).split(/[\\/]/).pop() ?? "";
export const joinFacts = (...facts: unknown[]): string => facts.filter((v) => v !== undefined && v !== null && v !== "").join(" · ");
/** `noun` is the plural form; a count of exactly 1 drops its trailing "s". */
export const count = (value: unknown, noun: string): string =>
	typeof value === "number" ? `${value} ${value === 1 && noun.endsWith("s") ? noun.slice(0, -1) : noun}` : "";
export const compactNumber = (value: number): string => value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(value);
export const detailsError = (r: CardResult): boolean => Boolean(r.details?.error);
export const rawExpanded = (r: CardResult): string[] => {
  const text = resultText(r).trimEnd();
  try { return JSON.stringify(JSON.parse(text), null, 2).split("\n"); } catch { return text ? text.split("\n") : []; }
};
export function errorText(r: CardResult): string {
  return typeof r.details?.error === "string" ? r.details.error : resultText(r) || "error";
}
