/**
 * Sweep overlay — TUI for reviewing and confirming session cleanup.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────────┐
 * │  ⚡ Session Snap — Scan Results                         │
 * │                                                         │
 * │  🗑️  DELETE   82 sessions   3.2 MB                      │
 * │  📦 ARCHIVE  180 sessions  58.4 MB                      │
 * │  ✅ KEEP     284 sessions  52.4 MB                      │
 * │                                                         │
 * │  ─── DELETE (82) ──────────────────────────────────────  │
 * │  > ✕ 2026-02-21  pi-ext     /exit only        0.3 KB   │
 * │    ✕ 2026-02-22  skald      "how to.." 1msg   1.2 KB   │
 * │    ✓ 2026-02-22  lgtm-k8s   "fix dep.." 2msg  4.1 KB   │
 * │                                                         │
 * │  Tab: switch category  Space: toggle  Enter: execute    │
 * │  a: select all  n: deselect all  Esc: cancel            │
 * └─────────────────────────────────────────────────────────┘
 */

import type { Component, Focusable } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ClassifiedSession, SessionCategory } from "./types.js";
import { formatBytes, formatDuration, projectName } from "./scanner.js";

export interface SweepResult {
  toDelete: string[];
  toArchive: ClassifiedSession[];
}

interface SweepOverlayOptions {
  sessions: ClassifiedSession[];
  theme: any;
  getTermRows: () => number;
  requestRender: () => void;
  onDone: (result: SweepResult | null) => void;
}

type TabId = "delete" | "archive" | "keep";
const TABS: TabId[] = ["delete", "archive", "keep"];
const TAB_ICONS: Record<TabId, string> = { delete: "🗑️ ", archive: "📦", keep: "✅" };
const TAB_LABELS: Record<TabId, string> = { delete: "DELETE", archive: "ARCHIVE", keep: "KEEP" };

interface SessionRow {
  session: ClassifiedSession;
  selected: boolean;
}

export class SweepOverlay implements Component, Focusable {
  focused = false;
  private activeTab: TabId = "delete";
  private scrollOffset = 0;
  private cursorIndex = 0;
  private rows: Map<TabId, SessionRow[]>;
  private theme: any;
  private getTermRows: () => number;
  private requestRender: () => void;
  private onDone: (result: SweepResult | null) => void;
  private allSessions: ClassifiedSession[];

  constructor(opts: SweepOverlayOptions) {
    this.theme = opts.theme;
    this.getTermRows = opts.getTermRows;
    this.requestRender = opts.requestRender;
    this.onDone = opts.onDone;
    this.allSessions = opts.sessions;

    // Group sessions by category
    this.rows = new Map();
    for (const tab of TABS) {
      const filtered = opts.sessions
        .filter((s) => s.category === tab)
        .sort((a, b) => a.lastActivityAt - b.lastActivityAt);
      this.rows.set(
        tab,
        filtered.map((s) => ({
          session: s,
          // DELETE and ARCHIVE default to selected, KEEP defaults to unselected
          selected: tab !== "keep",
        })),
      );
    }
  }

  private getCurrentRows(): SessionRow[] {
    return this.rows.get(this.activeTab) ?? [];
  }

  handleInput(data: string): void {
    const rows = this.getCurrentRows();

    if (data === "\x1b" || data === "\x1b[") {
      // Escape → cancel
      this.onDone(null);
      return;
    }

    if (data === "\t") {
      // Tab → switch category
      const idx = TABS.indexOf(this.activeTab);
      this.activeTab = TABS[(idx + 1) % TABS.length];
      this.cursorIndex = 0;
      this.scrollOffset = 0;
      this.requestRender();
      return;
    }

    if (data === "\x1b[Z") {
      // Shift-Tab → switch category backwards
      const idx = TABS.indexOf(this.activeTab);
      this.activeTab = TABS[(idx - 1 + TABS.length) % TABS.length];
      this.cursorIndex = 0;
      this.scrollOffset = 0;
      this.requestRender();
      return;
    }

    if (data === "\x1b[A" || data === "k") {
      // Up
      if (this.cursorIndex > 0) {
        this.cursorIndex--;
        if (this.cursorIndex < this.scrollOffset) {
          this.scrollOffset = this.cursorIndex;
        }
      }
      this.requestRender();
      return;
    }

    if (data === "\x1b[B" || data === "j") {
      // Down
      if (this.cursorIndex < rows.length - 1) {
        this.cursorIndex++;
        const visibleHeight = this.getVisibleHeight();
        if (this.cursorIndex >= this.scrollOffset + visibleHeight) {
          this.scrollOffset = this.cursorIndex - visibleHeight + 1;
        }
      }
      this.requestRender();
      return;
    }

    if (data === " ") {
      // Space → toggle selection
      if (rows[this.cursorIndex]) {
        rows[this.cursorIndex].selected = !rows[this.cursorIndex].selected;
      }
      this.requestRender();
      return;
    }

    if (data === "a") {
      // Select all in current tab
      for (const row of rows) row.selected = true;
      this.requestRender();
      return;
    }

    if (data === "n") {
      // Deselect all in current tab
      for (const row of rows) row.selected = false;
      this.requestRender();
      return;
    }

    if (data === "\r" || data === "\n") {
      // Enter → confirm and execute
      const toDelete: string[] = [];
      const toArchive: ClassifiedSession[] = [];

      for (const row of this.rows.get("delete") ?? []) {
        if (row.selected) toDelete.push(row.session.path);
      }
      for (const row of this.rows.get("archive") ?? []) {
        if (row.selected) toArchive.push(row.session);
      }

      this.onDone({ toDelete, toArchive });
      return;
    }
  }

  private getVisibleHeight(): number {
    // Leave room for header (8 lines) + footer (3 lines) + borders
    return Math.max(5, this.getTermRows() - 16);
  }

  render(width: number): string[] {
    const th = this.theme;
    const lines: string[] = [];
    const innerW = width - 4;

    // ── Title ──
    lines.push("");
    lines.push("  " + th.bold(th.fg("accent", "⚡ Session Snap")));
    lines.push("");

    // ── Summary stats ──
    for (const tab of TABS) {
      const tabRows = this.rows.get(tab) ?? [];
      const selected = tabRows.filter((r) => r.selected).length;
      const totalSize = tabRows.reduce((sum, r) => sum + r.session.fileSizeBytes, 0);
      const selectedSize = tabRows.filter((r) => r.selected).reduce((sum, r) => sum + r.session.fileSizeBytes, 0);

      const icon = TAB_ICONS[tab];
      const label = TAB_LABELS[tab];
      const isActive = this.activeTab === tab;

      let line = `  ${icon} `;
      if (isActive) {
        line += th.bold(th.fg("accent", padRight(label, 9)));
      } else {
        line += th.fg("dim", padRight(label, 9));
      }
      line += th.fg("muted", `${padLeft(String(selected), 4)}/${tabRows.length} sessions`);
      line += th.fg("dim", `  ${formatBytes(selectedSize)}`);

      lines.push(line);
    }

    lines.push("");

    // ── Tab header ──
    const tabRows = this.getCurrentRows();
    const selectedCount = tabRows.filter((r) => r.selected).length;
    const tabTitle = `── ${TAB_LABELS[this.activeTab]} (${selectedCount}/${tabRows.length}) `;
    lines.push("  " + th.fg("border", tabTitle + "─".repeat(Math.max(0, innerW - visibleWidth(tabTitle)))));

    // ── Session list ──
    if (tabRows.length === 0) {
      lines.push("");
      lines.push("  " + th.fg("dim", "(no sessions in this category)"));
    } else {
      const visibleH = this.getVisibleHeight();
      const end = Math.min(tabRows.length, this.scrollOffset + visibleH);

      for (let i = this.scrollOffset; i < end; i++) {
        const row = tabRows[i];
        const isCursor = i === this.cursorIndex;
        const s = row.session;

        const checkbox = row.selected ? th.fg("success", "✓") : th.fg("dim", "·");
        const cursor = isCursor ? th.fg("accent", "▸") : " ";
        const date = new Date(s.createdAt).toISOString().slice(0, 10);
        const proj = padRight(projectName(s.cwd), 14);
        const msgs = `${s.userMessageCount}msg`;
        const dur = formatDuration(s.durationSeconds);
        const size = formatBytes(s.fileSizeBytes);
        const preview = truncateToWidth(s.firstMessage.replace(/\n/g, " ") || "(empty)", Math.max(10, innerW - 60));

        let line = `  ${cursor} ${checkbox} ${th.fg("dim", date)}  `;
        if (isCursor) {
          line += th.fg("accent", proj);
        } else {
          line += th.fg("muted", proj);
        }
        line += th.fg("dim", ` ${padLeft(dur, 5)} ${padLeft(msgs, 5)} ${padLeft(size, 8)} `);
        line += th.fg("dim", `"${preview}"`);

        lines.push(truncateToWidth(line, width));
      }

      // Scroll indicator
      if (tabRows.length > visibleH) {
        const pos = Math.round((this.scrollOffset / (tabRows.length - visibleH)) * 100);
        lines.push("  " + th.fg("dim", `  ↕ ${this.scrollOffset + 1}-${end}/${tabRows.length} (${pos}%)`));
      }
    }

    // ── Footer ──
    lines.push("");
    lines.push(
      "  " +
        th.fg("dim", "Tab") +
        th.fg("muted", ": category  ") +
        th.fg("dim", "Space") +
        th.fg("muted", ": toggle  ") +
        th.fg("dim", "a") +
        th.fg("muted", "/") +
        th.fg("dim", "n") +
        th.fg("muted", ": all/none  ") +
        th.fg("dim", "Enter") +
        th.fg("muted", ": execute  ") +
        th.fg("dim", "Esc") +
        th.fg("muted", ": cancel"),
    );
    lines.push("");

    return lines;
  }

  invalidate(): void {}
}

function padRight(s: string, w: number): string {
  return s.length >= w ? s.slice(0, w) : s + " ".repeat(w - s.length);
}

function padLeft(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}
