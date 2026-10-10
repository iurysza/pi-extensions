import { cardParts, type CardParts } from "../tool-presentation/tidy/cards/card.js";
import { compactNumber, type CardSpec } from "../tool-presentation/tidy/cards/spec.js";
import type { TidyMode } from "../tool-presentation/tidy/config.js";
import { CYAN, YELLOW } from "../tool-presentation/tidy/render.js";

interface Common {
  /** provider/model configured for compaction */
  model: string;
  reason: string;
  /** Display name of the session model, which Pi uses on fallback */
  sessionModel?: string;
}

/** What happened to one compaction, stored as a display-only session entry. */
export type CompactionReport =
  | (Common & {
      kind: "used";
      /** Short display name, for example haiku-5.5 */
      name: string;
      tokensBefore: number;
      /** Summary size in output tokens, when the provider reports usage */
      summaryTokens?: number;
      inputTokens?: number;
      keepRecentTokens?: number;
      elapsedMs: number;
    })
  | (Common & { kind: "fallback"; why: string })
  | (Common & { kind: "failed"; why: string });

/** Shown while the configured model is writing the summary. */
export interface CompactionRunning { name: string; reason: string; tokensBefore: number; elapsedMs: number }

export const ENTRY_TYPE = "compaction-model";

const ICON = "󰘕";

interface Args { headline: string; target: string }
interface Result { summary: string; lines: string[] }

const spec = (color: string): CardSpec => ({
  icon: ICON,
  color,
  label: "compact",
  // Icon only. The group name would repeat the headline ("compact compacted").
  showGroupLabel: false,
  headline: (a) => a.headline,
  target: (a) => a.target,
  summary: (r) => r.details?.summary ?? "",
  errorSummary: (r) => r.details?.summary ?? "",
  expanded: (r) => r.details?.lines ?? [],
});

const tokens = (n: number) => `${compactNumber(n)} tokens`;
const row = (key: string, value: string) => `${key.padEnd(10)} ${value}`;

export interface CardStyle { expanded?: boolean; icons?: boolean; mode?: TidyMode }

/** Card parts for a finished compaction, in the same shape as a tidy tool card. */
export function reportParts(report: CompactionReport, style: CardStyle = {}): CardParts {
  const session = report.sessionModel ?? "the session model";
  if (report.kind === "used") {
    const lines = [
      row("model", report.model),
      ...(report.inputTokens === undefined ? [] : [row("input", `${report.inputTokens.toLocaleString("en-US")} tokens`)]),
      ...(report.summaryTokens === undefined ? [] : [row("summary", `${report.summaryTokens.toLocaleString("en-US")} tokens`)]),
      row("session", `${session} (not used)`),
    ];
    return cardParts({
      spec: spec(CYAN),
      args: {
        headline: `compacted with ${report.name} · ${report.reason}`,
        target: report.summaryTokens === undefined ? `from ${tokens(report.tokensBefore)}` : `${compactNumber(report.tokensBefore)} → ${tokens(report.summaryTokens)}`,
      } satisfies Args,
      result: { details: { summary: report.keepRecentTokens === undefined ? "done" : `kept ${compactNumber(report.keepRecentTokens)} recent`, lines } satisfies Result },
    }, { ...style, elapsedMs: report.elapsedMs });
  }
  const headline = report.kind === "fallback" ? `fell back to ${session} · ${report.reason}` : `compaction failed · ${report.reason}`;
  return cardParts({
    spec: spec(YELLOW),
    args: { headline, target: report.model } satisfies Args,
    result: { isError: true, details: { summary: report.why, lines: [row("configured", report.model), row("why", report.why)] } satisfies Result },
  }, style);
}

/** Card head for a compaction still in progress. */
export function runningParts(running: CompactionRunning, style: CardStyle = {}): CardParts {
  return cardParts({
    spec: spec(CYAN),
    args: { headline: `compacting with ${running.name} · ${running.reason}`, target: tokens(running.tokensBefore) } satisfies Args,
    result: {},
  }, { ...style, isPartial: true, elapsedMs: running.elapsedMs });
}

/** Plain rows, for tests and headless output. */
export function reportRows(report: CompactionReport, style: CardStyle = {}): string[] {
  const { head, body, tail } = reportParts(report, style);
  return [...head, ...body, ...tail];
}
