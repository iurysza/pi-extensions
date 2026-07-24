/**
 * Context-aware notifications via cmux.
 *
 * Replaces generic "Waiting for input" with notifications that tell you
 * what happened and what the agent needs.
 *
 * Uses `cmux notify` CLI instead of the socket API, because the socket
 * notification methods can be silently suppressed for focused surfaces.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message, TextContent } from "@earendil-works/pi-ai";
import { isBashToolResult } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import type { CmuxClient } from "./cmux-client.js";

interface TurnStats {
  filesEdited: string[];
  filesWritten: string[];
  bashCommands: number;
  bashErrors: number;
  lastError: string | null;
}

// Module-level turn tracking (reset each agent run)
let turnStats: TurnStats = freshStats();

function freshStats(): TurnStats {
  return {
    filesEdited: [],
    filesWritten: [],
    bashCommands: 0,
    bashErrors: 0,
    lastError: null,
  };
}

/**
 * Check if our surface is currently focused via `cmux identify`.
 * Returns true if the focused surface matches our surface.
 */
async function isSurfaceFocused(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    execFile("cmux", ["identify"], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(false);
      try {
        const info = JSON.parse(stdout);
        const focusedSurface = info?.focused?.surface_ref;
        const callerSurface = info?.caller?.surface_ref;
        resolve(!!focusedSurface && focusedSurface === callerSurface);
      } catch {
        resolve(false);
      }
    });
  });
}

/**
 * Send a notification via `cmux notify` CLI.
 * Skips if our surface is currently focused (user is already looking).
 */
async function notify(
  title: string,
  body?: string,
  subtitle?: string,
): Promise<void> {
  if (await isSurfaceFocused()) return;

  const args = ["notify", "--title", title];
  if (body) args.push("--body", body);
  if (subtitle) args.push("--subtitle", subtitle);

  const surfaceId = process.env.CMUX_SURFACE_ID;
  if (surfaceId) args.push("--surface", surfaceId);

  return new Promise<void>((resolve) => {
    execFile("cmux", args, { timeout: 5000 }, () => resolve());
  });
}

/** Build a one-line summary from turn stats. */
function buildSummary(stats: TurnStats): string {
  const parts: string[] = [];

  const totalFiles = new Set([...stats.filesEdited, ...stats.filesWritten]).size;
  if (totalFiles > 0) {
    parts.push(`${totalFiles} file${totalFiles > 1 ? "s" : ""}`);
  }

  if (stats.bashCommands > 0) {
    if (stats.bashErrors > 0) {
      parts.push(`${stats.bashErrors} error${stats.bashErrors > 1 ? "s" : ""}`);
    }
  }

  if (parts.length === 0) return "Done";
  return parts.join(", ");
}

/** Extract the last assistant text from messages (truncated). */
function lastAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant") {
      const textParts = (msg as AssistantMessage).content.filter(
        (c): c is TextContent => c.type === "text",
      );
      if (textParts.length > 0) {
        const text = textParts.map((t) => t.text).join(" ").trim();
        if (text.length > 120) return text.slice(0, 117) + "...";
        return text;
      }
    }
  }
  return null;
}

export function wireNotifications(pi: ExtensionAPI, _client: CmuxClient): void {
  // Reset stats at the start of each agent run
  pi.on("agent_start", async () => {
    turnStats = freshStats();
  });

  // Track file edits/writes
  pi.on("tool_result", async (event) => {
    if (event.toolName === "edit") {
      const path = (event.input as any)?.path;
      if (path) turnStats.filesEdited.push(path);
    } else if (event.toolName === "write") {
      const path = (event.input as any)?.path;
      if (path) turnStats.filesWritten.push(path);
    } else if (isBashToolResult(event)) {
      turnStats.bashCommands++;
      if (event.isError) {
        turnStats.bashErrors++;
        // Extract first meaningful line from error content
        const errorText = event.content
          .filter((c): c is TextContent => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        const firstLine = errorText.split("\n").find((l) => l.trim());
        if (firstLine) {
          turnStats.lastError =
            firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine;
        }
      }
    }
  });

  // Fire notification when the agent finishes
  pi.on("agent_end", async (event) => {
    const summary = buildSummary(turnStats);
    const assistantText = lastAssistantText(event.messages as Message[]);

    // Build notification
    const title = "pi";
    let body: string;

    if (turnStats.lastError) {
      body = `Error: ${turnStats.lastError}`;
    } else if (assistantText) {
      body = assistantText;
    } else {
      body = summary;
    }

    await notify(title, body, summary !== "Done" ? summary : undefined);
  });
}
