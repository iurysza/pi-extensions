import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTIFACT_DIRECTORY = ["ai-artifacts", "wtf"];

export function slugify(note: string): string {
  const slug = note
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "friction";
}

export async function recordWtf(cwd: string, note: string, now: Date = new Date()): Promise<string> {
  const normalized = note.trim();
  if (!normalized) throw new Error("note must not be empty");

  const directory = path.join(cwd, ...ARTIFACT_DIRECTORY);
  await mkdir(directory, { recursive: true });

  const date = now.toISOString().slice(0, 10);
  const slug = slugify(normalized);
  const content = `# WTF\n\n${normalized}\n`;
  for (let duplicate = 1; ; duplicate += 1) {
    const suffix = duplicate === 1 ? "" : `-${duplicate}`;
    const filePath = path.join(directory, `${date}-${slug}${suffix}.md`);
    try {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export default function piWtf(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "wtf",
    label: "WTF",
    description: "Record repeated or systemic workflow friction as dated files in the current workspace's ai-artifacts/wtf directory. Use only for recurring process/tooling problems worth fixing, not one-off errors or general notes.",
    promptSnippet: "wtf — record repeated/systemic workflow friction in ai-artifacts/wtf",
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
