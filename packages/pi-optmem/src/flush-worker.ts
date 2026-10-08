import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FlushError, flushMemories, registryCall, type FlushJob } from "./flush.ts";
import { FLUSH_CHILD, FLUSH_JOB, logFlush, removeFlushSnapshot } from "./flush-job.ts";
import { runMemo } from "./generate/pipeline.ts";

/** Loaded only by the detached worker; never starts an agent turn or compaction. */
export default function flushWorker(pi: ExtensionAPI): void {
  if (process.env[FLUSH_CHILD] !== "1" || !process.env[FLUSH_JOB]) return;
  pi.on("session_before_compact", async () => ({ cancel: true }));
  pi.on("session_start", async (_event, ctx) => {
    const file = process.env[FLUSH_JOB]!;
    let job: FlushJob | undefined;
    try {
      job = JSON.parse(readFileSync(file, "utf8")) as FlushJob;
      logFlush(job, { status: "running", pid: process.pid });
      const result = await flushMemories(job, (args) => runMemo(job!.memoPath, job!.memoryDir, args), (prompt) => registryCall(ctx, job!.model, prompt));
      logFlush(job, { status: "done", ...result });
    } catch (error) {
      // Provider errors can include credentials or transcript excerpts. Do not log them.
      if (job) logFlush(job, { status: "failed", stage: "flush", reason: error instanceof FlushError ? error.code : "unexpected-error" });
    } finally {
      removeFlushSnapshot(file);
      ctx.shutdown();
    }
  });
}
