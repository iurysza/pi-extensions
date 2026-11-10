/**
 * session-snap — Session archiver & cleaner for pi
 *
 * Commands:
 *   /snap     — Scan sessions, classify (delete/archive/keep), review & execute
 *   /archive  — Browse archived sessions, search, restore, delete
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { scanAllSessions, formatBytes } from "./scanner.js";
import { archiveSession, deleteSession, listArchived, restoreSession, deleteArchived, getArchivedCount, closeDb } from "./archive.js";
import { SweepOverlay, type SweepResult } from "./sweep-overlay.js";
import { ArchiveOverlay, type ArchiveAction } from "./archive-overlay.js";

export default function (pi: ExtensionAPI) {
  // ── /snap — Sweep & archive ──
  pi.registerCommand("snap", {
    description: "Scan sessions, delete trivial ones, archive old ones",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("session-snap requires interactive mode", "error");
        return;
      }

      // Scan all sessions
      ctx.ui.setStatus("snap", "⚡ Scanning sessions...");

      let sessions: ReturnType<typeof scanAllSessions>;
      try {
        sessions = scanAllSessions((current, total) => {
          ctx.ui.setStatus("snap", `⚡ Scanning ${current}/${total}...`);
        });
      } finally {
        ctx.ui.setStatus("snap", undefined);
      }

      if (sessions.length === 0) {
        ctx.ui.notify("No sessions found", "info");
        return;
      }

      // Exclude current session from the list
      const currentSessionFile = ctx.sessionManager.getSessionFile();
      if (currentSessionFile) {
        sessions = sessions.filter((s) => s.path !== currentSessionFile);
      }

      // Show sweep overlay
      const result = await ctx.ui.custom<SweepResult | null>(
        (tui, theme, _kb, done) => {
          return new SweepOverlay({
            sessions,
            theme,
            getTermRows: () => tui.terminal?.rows ?? 40,
            requestRender: () => tui.requestRender(),
            onDone: done,
          });
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "center",
            width: "85%",
            minWidth: 70,
            maxHeight: "90%",
          },
        },
      );

      if (!result) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      // Execute
      const { toDelete, toArchive } = result;

      if (toDelete.length === 0 && toArchive.length === 0) {
        ctx.ui.notify("Nothing to do", "info");
        return;
      }

      // Confirm one more time
      const total = toDelete.length + toArchive.length;
      const confirmed = await ctx.ui.confirm(
        "Execute session-snap?",
        `Delete ${toDelete.length} sessions, archive ${toArchive.length} sessions (${total} total)`,
      );

      if (!confirmed) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      ctx.ui.setStatus("snap", "⚡ Processing...");

      let deleted = 0;
      let archived = 0;
      let errors = 0;

      try {
        // Delete trivial sessions
        for (const path of toDelete) {
          try {
            deleteSession(path);
            deleted++;
          } catch (e) {
            errors++;
          }
        }

        // Archive old sessions
        for (const session of toArchive) {
          try {
            archiveSession(session);
            archived++;
          } catch (e) {
            errors++;
          }
        }
      } finally {
        ctx.ui.setStatus("snap", undefined);
      }

      let msg = `⚡ Done! Deleted ${deleted}, archived ${archived}`;
      if (errors > 0) msg += `, ${errors} errors`;
      ctx.ui.notify(msg, errors > 0 ? "warning" : "info");
    },
  });

  // ── /archive — Browse archived sessions ──
  pi.registerCommand("archive", {
    description: "Browse, search, and restore archived sessions",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("session-snap requires interactive mode", "error");
        return;
      }

      const count = getArchivedCount();
      if (count === 0) {
        ctx.ui.notify("No archived sessions. Run /snap first.", "info");
        return;
      }

      let keepBrowsing = true;

      while (keepBrowsing) {
        const initialSessions = listArchived();

        const action = await ctx.ui.custom<ArchiveAction>(
          (tui, theme, _kb, done) => {
            return new ArchiveOverlay({
              sessions: initialSessions,
              theme,
              getTermRows: () => tui.terminal?.rows ?? 40,
              getTermCols: () => tui.terminal?.columns ?? 120,
              requestRender: () => tui.requestRender(),
              onDone: done,
              onSearch: (query) => listArchived(query || undefined),
            });
          },
          {
            overlay: true,
            overlayOptions: {
              anchor: "center",
              width: "90%",
              minWidth: 80,
              maxHeight: "85%",
            },
          },
        );

        if (action.type === "close") {
          keepBrowsing = false;
        } else if (action.type === "restore") {
          const restoredPath = restoreSession(action.sessionId);
          if (restoredPath) {
            ctx.ui.notify(`Restored session to ${restoredPath}`, "info");
          } else {
            ctx.ui.notify("Failed to restore session", "error");
          }
          // Continue browsing after restore
        } else if (action.type === "delete") {
          deleteArchived(action.sessionId);
          ctx.ui.notify("Session permanently deleted", "info");
          // Continue browsing after delete
        }
      }
    },
  });

  // ── Status: show archive count in footer ──
  pi.on("session_start", async (_event, ctx) => {
    try {
      const count = getArchivedCount();
      if (count > 0) {
        ctx.ui.setStatus("snap", `📦 ${count} archived`);
      }
    } catch {
      // DB might not exist yet
    }
  });

  // ── Cleanup on shutdown ──
  pi.on("session_shutdown", async () => {
    closeDb();
  });
}
