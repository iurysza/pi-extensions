import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";

const FILE_NAME = "WTF.md";

export async function recordWtf(cwd: string, note: string, now: Date = new Date()): Promise<string> {
  const normalized = note.trim();
  if (!normalized) throw new Error("note must not be empty");

  const filePath = path.join(cwd, FILE_NAME);
  let prefix = "";
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing.length > 0 && !existing.endsWith("\n")) prefix = "\n";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    prefix = "# WTF\n\n";
  }

  const entry = `## ${now.toISOString()}\n\n${normalized}\n\n`;
  await appendFile(filePath, `${prefix}${entry}`, "utf8");
  return filePath;
}

export default function piWtf(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wtf",
    label: "WTF",
    description: "Record repeated or systemic workflow friction in the current workspace's WTF.md. Use only for recurring process/tooling problems worth fixing, not one-off errors or general notes.",
    promptSnippet: "wtf — record repeated/systemic workflow friction in WTF.md",
    promptGuidelines: [
      "Use wtf when repeated or systemic workflow friction should be preserved for later improvement.",
      "Do not use wtf for one-off errors, task status, or general notes.",
    ],
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          minLength: 1,
          description: "Concise friction report: what repeats, its impact, and useful context.",
        },
      },
      required: ["note"],
      additionalProperties: false,
    } as any,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const { note } = params as { note: string };
        const filePath = await recordWtf(ctx.cwd, note);
        return {
          content: [{ type: "text" as const, text: `Recorded workflow friction in ${filePath}` }],
          details: { path: filePath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Failed to record workflow friction: ${message}` }],
          details: { error: true },
        };
      }
    },
  });
}
