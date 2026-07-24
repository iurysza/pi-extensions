/**
 * Archive overlay — mirrors session-switch's SplitOverlay look & feel.
 *
 * ╭── search input ────────────┬── preview ─────────────────────╮
 * │ ▸ 2026-02-22  pi-ext       │  pi-ext                       │
 * │   2026-02-23  lgtm-k8s     │  2026-02-22 20:12 · 12 msgs   │
 * │   2026-02-24  skald         │  ──────────────────────────── │
 * │   ...                       │   USER                        │
 * │                             │  Add custom footer extension  │
 * │                             │   AGENT                       │
 * │                             │  I'll create a new...         │
 * ╰─────────────────────────────┴───────────────────────────────╯
 */

import type { Component, Focusable } from "@earendil-works/pi-tui";
import { Input, Markdown, truncateToWidth, visibleWidth, CURSOR_MARKER } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { ArchivedSession } from "./types.js";
import { type MessageBlock, getArchivedMessageBlocks } from "./archive.js";
import { formatBytes, formatDuration, projectName } from "./scanner.js";

export type ArchiveAction =
  | { type: "restore"; sessionId: string }
  | { type: "delete"; sessionId: string }
  | { type: "close" };

interface ArchiveOverlayOptions {
  sessions: ArchivedSession[];
  theme: Theme;
  getTermRows: () => number;
  getTermCols: () => number;
  requestRender: () => void;
  onDone: (action: ArchiveAction) => void;
  onSearch: (query: string) => ArchivedSession[];
}

/** Pad or truncate to exact visible width */
function padTo(s: string, w: number): string {
  const vis = visibleWidth(s);
  if (vis >= w) return truncateToWidth(s, w);
  return s + " ".repeat(w - vis);
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 30) return `${Math.floor(days / 30)}mo`;
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return "now";
}

// ── Preview cache ────────────────────────────────────────────────────────────

const previewCache = new Map<string, MessageBlock[]>();

function getMessageBlocks(sessionId: string): MessageBlock[] {
  const cached = previewCache.get(sessionId);
  if (cached) return cached;
  const blocks = getArchivedMessageBlocks(sessionId);
  previewCache.set(sessionId, blocks);
  return blocks;
}

// ── Left panel header: title + search + separator = 3 lines ──────────────────
const LEFT_HEADER_LINES = 3;

// ── Main component ───────────────────────────────────────────────────────────

export class ArchiveOverlay implements Component, Focusable {
  private _focused = false;
  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    this.searchInput.focused = value;
  }

  private allSessions: ArchivedSession[];
  private filteredSessions: ArchivedSession[];
  private selectedIndex = 0;
  private scrollOffset = 0;
  private searchInput: Input;
  private confirmDelete = false;
  private theme: Theme;
  private mdTheme: any;
  private getTermRows: () => number;
  private getTermCols: () => number;
  private requestRender: () => void;
  private onDone: (action: ArchiveAction) => void;
  private onSearch: (query: string) => ArchivedSession[];

  private lastSelectedId: string | undefined;

  constructor(opts: ArchiveOverlayOptions) {
    this.allSessions = opts.sessions;
    this.filteredSessions = opts.sessions;
    this.theme = opts.theme;
    this.mdTheme = getMarkdownTheme();
    this.getTermRows = opts.getTermRows;
    this.getTermCols = opts.getTermCols;
    this.requestRender = opts.requestRender;
    this.onDone = opts.onDone;
    this.onSearch = opts.onSearch;

    this.searchInput = new Input();
  }

  private doSearch(): void {
    const query = this.searchInput.getValue().trim();
    this.filteredSessions = query ? this.onSearch(query) : this.allSessions;
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredSessions.length - 1));
    this.scrollOffset = 0;
  }

  handleInput(data: string): void {
    // ── Confirm delete ──
    if (this.confirmDelete) {
      if (data === "y" || data === "Y") {
        const session = this.filteredSessions[this.selectedIndex];
        if (session) {
          this.confirmDelete = false;
          this.onDone({ type: "delete", sessionId: session.id });
        }
      } else {
        this.confirmDelete = false;
        this.requestRender();
      }
      return;
    }

    // ── Escape ──
    if (matchesKey(data, "escape")) {
      if (this.searchInput.getValue()) {
        this.searchInput.setValue("");
        this.doSearch();
        this.requestRender();
        return;
      }
      this.onDone({ type: "close" });
      return;
    }

    // ── Navigation ──
    if (matchesKey(data, "up")) {
      this.moveSelection(-1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveSelection(1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "tab")) {
      this.moveSelection(1);
      this.requestRender();
      return;
    }
    if (matchesKey(data, "shift+tab")) {
      this.moveSelection(-1);
      this.requestRender();
      return;
    }

    // ── Actions ──
    if (matchesKey(data, "return")) {
      const session = this.filteredSessions[this.selectedIndex];
      if (session) this.onDone({ type: "restore", sessionId: session.id });
      return;
    }
    if (matchesKey(data, "ctrl+d")) {
      if (this.filteredSessions[this.selectedIndex]) {
        this.confirmDelete = true;
        this.requestRender();
      }
      return;
    }
    if (matchesKey(data, "ctrl+u")) {
      this.searchInput.setValue("");
      this.doSearch();
      this.requestRender();
      return;
    }

    // ── Everything else → search input ──
    this.searchInput.handleInput(data);
    this.doSearch();
    this.requestRender();
  }

  private moveSelection(delta: number): void {
    const len = this.filteredSessions.length;
    if (len === 0) return;
    this.selectedIndex = Math.max(0, Math.min(len - 1, this.selectedIndex + delta));

    // How many items (not lines) fit in the list area
    const maxItems = this.getMaxListItems();
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + maxItems) {
      this.scrollOffset = this.selectedIndex - maxItems + 1;
    }
  }

  /**
   * Compute the total content height (between top and bottom borders).
   * overlay maxHeight is 85% of terminal, minus 2 for top/bottom border rows.
   */
  private getContentHeight(): number {
    const termRows = this.getTermRows();
    return Math.max(10, Math.floor(termRows * 0.80) - 2);
  }

  /**
   * How many session items fit in the list area.
   * Each item = 2 lines (name + metadata), plus LEFT_HEADER_LINES for header.
   */
  private getMaxListItems(): number {
    const contentH = this.getContentHeight();
    const available = contentH - LEFT_HEADER_LINES;
    return Math.max(1, Math.floor(available / 2));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render(width: number): string[] {
    const th = this.theme;
    const innerW = width - 2; // inside │ borders
    const leftW = Math.max(25, Math.floor(innerW * 0.40));
    const rightW = innerW - leftW - 1; // -1 for center │

    // Compute fixed height for content area
    const targetH = this.getContentHeight();

    // ── Left panel: search + list (rendered to exactly targetH lines) ──
    const leftLines = this.renderLeftPanel(leftW, targetH);

    // ── Right panel: preview (rendered to exactly targetH lines) ──
    const selected = this.filteredSessions[this.selectedIndex];
    const rightLines = selected
      ? this.buildPreview(selected, rightW, targetH)
      : this.centeredMessage(th.fg("dim", "(no session selected)"), rightW, targetH);

    // ── Assemble framed output ──
    const lines: string[] = [];
    const sep = th.fg("border", "│");

    // Top border
    lines.push(th.fg("border", "╭" + "─".repeat(leftW) + "┬" + "─".repeat(rightW) + "╮"));

    // Content rows (exactly targetH)
    for (let i = 0; i < targetH; i++) {
      lines.push(
        sep + padTo(leftLines[i] ?? "", leftW) + sep + padTo(rightLines[i] ?? "", rightW) + sep,
      );
    }

    // Bottom border with footer hints
    const footer = this.confirmDelete
      ? " " + th.fg("error", th.bold("⚠ Delete permanently?")) + " " + th.fg("muted", "(y/n)")
      : " " +
        th.fg("dim", "↑↓") + " " + th.fg("muted", "nav") + "  " +
        th.fg("dim", "⏎") + " " + th.fg("muted", "restore") + "  " +
        th.fg("dim", "^D") + " " + th.fg("muted", "delete") + "  " +
        th.fg("dim", "^U") + " " + th.fg("muted", "clear") + "  " +
        th.fg("dim", "esc") + " " + th.fg("muted", "close");

    lines.push(
      th.fg("border", "╰") +
        padTo(footer, leftW + 1 + rightW) +
        th.fg("border", "╯"),
    );

    return lines;
  }

  // ── Left panel ─────────────────────────────────────────────────────────────

  private renderLeftPanel(w: number, totalH: number): string[] {
    const th = this.theme;
    const lines: string[] = [];

    // Title + count
    const title = th.bold(th.fg("accent", " 📦 Archive"));
    const count = th.fg("dim", ` (${this.filteredSessions.length})`);
    lines.push(title + count);

    // Search input
    const inputLines = this.searchInput.render(w - 5);
    lines.push(" " + th.fg("accent", "🔍") + " " + (inputLines[0] ?? ""));

    // Separator
    lines.push(th.fg("border", " " + "─".repeat(Math.max(1, w - 2))));

    // Session list — fill remaining space
    const sessions = this.filteredSessions;
    const maxItems = this.getMaxListItems();

    if (sessions.length === 0) {
      const msg = this.searchInput.getValue() ? "(no matches)" : "(empty archive)";
      lines.push("");
      lines.push(th.fg("dim", "  " + msg));
    } else {
      const end = Math.min(sessions.length, this.scrollOffset + maxItems);
      for (let i = this.scrollOffset; i < end; i++) {
        const s = sessions[i];
        const isSel = i === this.selectedIndex;

        const name = s.name || s.firstMessage.split("\n")[0]?.trim() || "(unnamed)";
        const time = relativeTime(s.lastActivityAt);
        const msgs = `${s.userMessageCount + s.assistantMessageCount}msg`;
        const proj = projectName(s.cwd);

        // Line 1: cursor + name + time
        let primary: string;
        if (isSel) {
          primary = th.fg("accent", " ▸ ") + th.bold(truncateToWidth(name, w - 12)) + " " + th.fg("dim", time);
        } else {
          primary = "   " + th.fg("muted", truncateToWidth(name, w - 12)) + " " + th.fg("dim", time);
        }
        lines.push(truncateToWidth(primary, w));

        // Line 2: project + metadata
        const meta = `   ${th.fg("dim", proj)} · ${th.fg("dim", msgs)} · ${th.fg("dim", formatDuration(s.durationSeconds))}`;
        lines.push(truncateToWidth(meta, w));
      }

      // Scroll info (if scrollable)
      if (sessions.length > maxItems) {
        lines.push(th.fg("dim", `  ${this.scrollOffset + 1}–${end} of ${sessions.length}`));
      }
    }

    // Pad to exact height
    while (lines.length < totalH) lines.push("");
    return lines.slice(0, totalH);
  }

  // ── Right panel: preview ───────────────────────────────────────────────────

  private buildPreview(session: ArchivedSession, w: number, h: number): string[] {
    const th = this.theme;
    const lines: string[] = [];

    // Track selection changes
    if (session.id !== this.lastSelectedId) {
      this.lastSelectedId = session.id;
    }

    // ── Header ──
    const name = session.name || session.firstMessage.split("\n")[0]?.trim() || "(unnamed)";
    lines.push(truncateToWidth(" " + th.bold(th.fg("accent", name)), w));

    const msgs = `${session.userMessageCount + session.assistantMessageCount} msgs`;
    const time = relativeTime(session.lastActivityAt);
    const cwd = session.cwd || "";
    lines.push(truncateToWidth(" " + th.fg("dim", `${msgs} · ${time} · ${cwd}`), w));
    lines.push(th.fg("border", " " + "─".repeat(Math.max(0, w - 2))));

    // ── Conversation preview ──
    const blocks = getMessageBlocks(session.id);
    const headerH = lines.length;
    const contentH = h - headerH;

    if (blocks.length === 0 || contentH <= 0) {
      const emptyLines = this.centeredMessage(th.fg("dim", "(no preview)"), w, Math.max(0, contentH));
      lines.push(...emptyLines);
      while (lines.length < h) lines.push("");
      return lines.slice(0, h);
    }

    // Render message blocks with Markdown (same style as session-switch)
    const allContentLines: string[] = [];
    let lastRole: string | undefined;

    for (const block of blocks) {
      if (allContentLines.length > 0) allContentLines.push("");

      if (block.role === "user") {
        const pill = th.bold(th.inverse(th.fg("accent", " USER ")));
        allContentLines.push(" " + pill);

        const bgBlank = th.bg("userMessageBg", " ".repeat(w));
        allContentLines.push(bgBlank);

        const md = new Markdown(block.text, 1, 0, this.mdTheme, {
          bgColor: (text: string) => th.bg("userMessageBg", text),
          color: (text: string) => th.fg("userMessageText", text),
        });
        for (const line of md.render(w)) {
          allContentLines.push(th.bg("userMessageBg", padTo(line, w)));
        }
        allContentLines.push(bgBlank);
      } else {
        if (lastRole !== "assistant") {
          const pill = th.bold(th.inverse(th.fg("success", " AGENT ")));
          allContentLines.push(" " + pill);
        }

        const md = new Markdown(block.text, 1, 0, this.mdTheme);
        allContentLines.push(...md.render(w));
      }

      lastRole = block.role;
    }

    // Fill content area (truncate to available space)
    for (let i = 0; i < contentH; i++) {
      if (i < allContentLines.length) {
        lines.push(truncateToWidth(allContentLines[i], w));
      } else {
        lines.push("");
      }
    }

    return lines.slice(0, h);
  }

  private centeredMessage(msg: string, w: number, h: number): string[] {
    if (h <= 0) return [];
    const mid = Math.floor(h / 2);
    const vis = visibleWidth(msg);
    const padLeft = Math.max(0, Math.floor((w - vis) / 2));
    return Array.from({ length: h }, (_, i) => (i === mid ? " ".repeat(padLeft) + msg : ""));
  }

  invalidate(): void {}

  dispose(): void {
    previewCache.clear();
  }
}
