// Footer text. Nerd Font v3 Material Design glyphs; off shows nothing.
import type { MemoryMode } from "./core.ts";
import type { Job } from "./generate/job.ts";

export const ICON = {
  brain: "\u{F09D1}", // nf-md-brain
  eye: "\u{F0208}", // nf-md-eye
  alert: "\u{F0026}", // nf-md-alert
  sync: "\u{F04E6}", // nf-md-sync
  check: "\u{F012C}", // nf-md-check
  download: "\u{F01DA}", // nf-md-download
  sleep: "\u{F04B2}", // nf-md-sleep
} as const;

/** Job part of the footer, or undefined when there is nothing to say. */
export function jobStatus(job: Job | undefined, running: boolean): string | undefined {
  if (!job) return undefined;
  if (job.phase === "awaiting-confirm") return `${ICON.check} review`;
  if (job.phase === "failed") return `${ICON.alert} failed`;
  if (!running) return undefined;
  if (job.phase === "distil") return `${ICON.sync} ${job.kind === "catchup" ? "catchup " : ""}${job.processed}/${job.total}`;
  if (job.phase === "importing") return `${ICON.download} import`;
  if (job.phase === "naps") return `${ICON.sleep} ${job.napsDone}${job.napsPending !== undefined ? `/${job.napsDone + job.napsPending}` : ""}`;
  return undefined;
}

/** Whole footer entry. undefined clears it. */
export function statusText(mode: MemoryMode, memoMissing: boolean, job: string | undefined): string | undefined {
  if (mode === "off") return undefined;
  if (memoMissing) return `${ICON.brain} ${ICON.alert} no memo`;
  const base = mode === "read" ? `${ICON.brain} ${ICON.eye}` : ICON.brain;
  return job ? `${base} ${job}` : base;
}
