import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TITLE_LENGTH = 24;

let lastTitle: string | undefined;

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block: any) => block?.type === "text" && typeof block.text === "string")
    .map((block: any) => block.text)
    .join(" ");
}

function firstUserPrompt(ctx: ExtensionContext): string | null {
  const entries = ctx.sessionManager.getEntries() as any[];
  const firstUser = entries.find(
    (entry) => entry?.type === "message" && entry.message?.role === "user",
  );

  const text = contentToText(firstUser?.message?.content).trim();
  return text || null;
}

export function slugify(text: string): string {
  const slug = text
    // Clipboard image paths are noise; keep the user's words after them.
    .replace(/\/var\/folders\/\S*?pi-clipboard-[\w-]+\.(png|jpe?g|gif|webp)/gi, " ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  return slug.length > MAX_TITLE_LENGTH
    ? slug.slice(0, MAX_TITLE_LENGTH).replace(/-+$/g, "")
    : slug;
}

function looksLikeBrokenAutoName(name: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}[ t-]\d{2}[:-]\d{2}/i.test(name) ||
    /^\d{4}-\d{2}-\d{2}t\d{2}-\d{2}-\d{2}.*_[0-9a-f-]{16,}$/i.test(name)
  );
}

function deriveTitle(pi: ExtensionAPI, ctx: ExtensionContext): string {
  const explicit = pi.getSessionName();
  const source =
    explicit && !looksLikeBrokenAutoName(explicit)
      ? explicit
      : firstUserPrompt(ctx) || ctx.cwd.split("/").pop() || "pi";

  return slugify(source) || "pi";
}

async function runTmux(args: string[]) {
  await execFileAsync("tmux", args, { timeout: 1000 });
}

export async function renameTmuxWindow(title: string) {
  if (!process.env.TMUX) return;

  const target = process.env.TMUX_PANE;

  if (target) {
    try {
      await runTmux(["set-window-option", "-t", target, "automatic-rename", "off"]);
      await runTmux(["rename-window", "-t", target, title]);
      return;
    } catch {
      // fall through to current tmux context
    }
  }

  try {
    await runTmux(["set-window-option", "automatic-rename", "off"]);
    await runTmux(["rename-window", title]);
  } catch {
    // ignore outside normal tmux contexts
  }
}

async function restoreTmuxAutoRename() {
  if (!process.env.TMUX) return;

  const target = process.env.TMUX_PANE;

  if (target) {
    try {
      await runTmux(["set-window-option", "-t", target, "automatic-rename", "on"]);
      return;
    } catch {
      // fall through to current tmux context
    }
  }

  try {
    await runTmux(["set-window-option", "automatic-rename", "on"]);
  } catch {
    // ignore
  }
}

async function syncTitle(pi: ExtensionAPI, ctx: ExtensionContext) {
  const title = deriveTitle(pi, ctx);
  if (title === lastTitle) return;

  lastTitle = title;
  ctx.ui.setTitle(`pi | ${title}`);
  await renameTmuxWindow(title);
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    await syncTitle(pi, ctx);
  });

  pi.on("message_end", async (_event, ctx) => {
    await syncTitle(pi, ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await syncTitle(pi, ctx);
  });

  pi.on("session_shutdown", async () => {
    await restoreTmuxAutoRename();
  });

  pi.registerCommand("retitle", {
    description: "Sync tmux window title to a kebab-case pi session title",
    handler: async (_args, ctx) => {
      lastTitle = undefined;
      await syncTitle(pi, ctx);
      ctx.ui.notify(`Title: ${lastTitle}`, "info");
    },
  });

}
