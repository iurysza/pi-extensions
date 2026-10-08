import { appendFileSync, existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fixture(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event, ctx) => {
    if (process.env.PI_OPTMEM_FLUSH_CHILD !== "1") return;
    const trace = process.env.PI_OPTMEM_TEST_TRACE;
    if (trace) {
      type Stream = { result(): Promise<{ content: { type: string; text?: string }[] }> };
      const registry = ctx.modelRegistry as unknown as { streamSimple(...args: unknown[]): Stream };
      const streamSimple = registry.streamSimple.bind(registry);
      registry.streamSimple = (...args) => {
        const stream = streamSimple(...args);
        const result = stream.result.bind(stream);
        stream.result = async () => {
          const response = await result();
          appendFileSync(trace, JSON.stringify(response.content.filter((part) => part.type === "text").map((part) => part.text)) + "\n");
          return response;
        };
        return stream;
      };
    }
    const marker = process.env.PI_OPTMEM_TEST_EXIT_MARKER;
    if (!marker) return;
    // Make the flush start only AFTER the parent has exited, so the test cannot
    // pass merely because the model happened to finish before compaction did.
    const deadline = Date.now() + 60_000;
    while (!existsSync(marker) && Date.now() < deadline) await setTimeout(25);
    if (!existsSync(marker)) throw new Error("parent exit marker missing");
  });
  // Deterministic summary: this test isolates the real flush call, not summary quality.
  pi.on("session_before_compact", async (event) => ({
    compaction: {
      summary: "The older turns were summarised for the detached memory flush integration test.",
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
    },
  }));
}
