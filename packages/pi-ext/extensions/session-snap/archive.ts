import Database from "better-sqlite3";
import { readFileSync, unlinkSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type ArchivedSession, type SessionMetrics, CONFIG } from "./types.js";
import { extractFullText } from "./scanner.js";

let _db: any | null = null;

/** Get or create the SQLite database connection */
function getDb(): any {
  if (_db) return _db;

  _db = new Database(CONFIG.DB_PATH);

  // Enable WAL mode for better concurrent access
  _db.exec("PRAGMA journal_mode=WAL");

  // Create tables
  _db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      cwd TEXT,
      name TEXT,
      first_message TEXT,
      created_at INTEGER,
      last_activity_at INTEGER,
      duration_seconds INTEGER,
      user_message_count INTEGER,
      assistant_message_count INTEGER,
      total_entries INTEGER,
      file_size_bytes INTEGER,
      archived_at INTEGER,
      full_text TEXT
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS session_data (
      session_id TEXT PRIMARY KEY REFERENCES sessions(id),
      jsonl_gzip BLOB NOT NULL
    )
  `);

  // FTS5 for full-text search
  _db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
      full_text, name, first_message,
      content='sessions',
      content_rowid='rowid'
    )
  `);

  // Triggers to keep FTS in sync
  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
      INSERT INTO sessions_fts(rowid, full_text, name, first_message)
      VALUES (new.rowid, new.full_text, new.name, new.first_message);
    END
  `);

  _db.exec(`
    CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
      INSERT INTO sessions_fts(sessions_fts, rowid, full_text, name, first_message)
      VALUES ('delete', old.rowid, old.full_text, old.name, old.first_message);
    END
  `);

  return _db;
}

/** Archive a session: store metadata + compressed JSONL, then delete original */
export function archiveSession(metrics: SessionMetrics): void {
  const db = getDb();

  // Read and compress original JSONL
  const raw = readFileSync(metrics.path, "utf-8");
  const compressed = gzipSync(Buffer.from(raw, "utf-8"));

  // Extract full text for search
  const fullText = extractFullText(metrics.path);

  // Insert metadata
  db.prepare(`
    INSERT OR REPLACE INTO sessions
    (id, original_path, cwd, name, first_message, created_at, last_activity_at,
     duration_seconds, user_message_count, assistant_message_count,
     total_entries, file_size_bytes, archived_at, full_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    metrics.id,
    metrics.path,
    metrics.cwd,
    metrics.name ?? null,
    metrics.firstMessage,
    metrics.createdAt,
    metrics.lastActivityAt,
    metrics.durationSeconds,
    metrics.userMessageCount,
    metrics.assistantMessageCount,
    metrics.totalEntries,
    metrics.fileSizeBytes,
    Date.now(),
    fullText,
  );

  // Insert compressed data
  db.prepare(`
    INSERT OR REPLACE INTO session_data (session_id, jsonl_gzip)
    VALUES (?, ?)
  `).run(metrics.id, compressed);

  // Delete original file
  unlinkSync(metrics.path);
}

/** Delete a session file without archiving */
export function deleteSession(filePath: string): void {
  unlinkSync(filePath);
}

/** List all archived sessions, optionally filtered by search query */
export function listArchived(searchQuery?: string): ArchivedSession[] {
  const db = getDb();

  if (searchQuery && searchQuery.trim()) {
    const trimmed = searchQuery.trim();

    // Try FTS5 first with prefix matching (append * to last token for live search)
    try {
      const tokens = trimmed.split(/\s+/).filter(Boolean);
      // Each token gets quoted, last one gets prefix wildcard for live search
      const ftsTokens = tokens.map((w, i) => {
        const escaped = w.replace(/"/g, '""');
        return i === tokens.length - 1 ? `"${escaped}"*` : `"${escaped}"`;
      });
      const ftsQuery = ftsTokens.join(" AND ");

      const rows = db
        .prepare(
          `
        SELECT s.* FROM sessions s
        INNER JOIN sessions_fts fts ON s.rowid = fts.rowid
        WHERE sessions_fts MATCH ?
        ORDER BY rank
        LIMIT 200
      `,
        )
        .all(ftsQuery) as any[];

      if (rows.length > 0) return rows.map(rowToArchived);
    } catch {
      // FTS query syntax error — fall through to LIKE
    }

    // Fallback: LIKE search on key fields
    const pattern = `%${trimmed}%`;
    const rows = db
      .prepare(
        `
      SELECT * FROM sessions
      WHERE first_message LIKE ? OR name LIKE ? OR cwd LIKE ? OR full_text LIKE ?
      ORDER BY last_activity_at DESC
      LIMIT 200
    `,
      )
      .all(pattern, pattern, pattern, pattern) as any[];

    return rows.map(rowToArchived);
  }

  const rows = db
    .prepare(
      `
    SELECT * FROM sessions
    ORDER BY last_activity_at DESC
  `,
    )
    .all() as any[];

  return rows.map(rowToArchived);
}

/** Get count of archived sessions */
export function getArchivedCount(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as count FROM sessions").get() as any;
  return row?.count ?? 0;
}

/** Get total size of archive DB */
export function getArchiveSize(): number {
  try {
    const { statSync } = require("node:fs");
    const stat = statSync(CONFIG.DB_PATH);
    return stat.size;
  } catch {
    return 0;
  }
}

/** Restore a session from archive back to its original location */
export function restoreSession(sessionId: string): string | null {
  const db = getDb();

  // Get metadata
  const meta = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as any;
  if (!meta) return null;

  // Get compressed data
  const data = db.prepare("SELECT jsonl_gzip FROM session_data WHERE session_id = ?").get(sessionId) as any;
  if (!data) return null;

  // Decompress
  const jsonl = gunzipSync(data.jsonl_gzip).toString("utf-8");

  // Write back to original path
  const targetPath = meta.original_path;
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, jsonl, "utf-8");

  // Remove from archive
  db.prepare("DELETE FROM session_data WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);

  return targetPath;
}

/** Permanently delete an archived session */
export function deleteArchived(sessionId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM session_data WHERE session_id = ?").run(sessionId);
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

/** Message block for preview rendering */
export interface MessageBlock {
  role: "user" | "assistant";
  text: string;
}

/** Decompress and extract message blocks from an archived session for preview */
export function getArchivedMessageBlocks(sessionId: string): MessageBlock[] {
  const db = getDb();
  const data = db.prepare("SELECT jsonl_gzip FROM session_data WHERE session_id = ?").get(sessionId) as any;
  if (!data) return [];

  try {
    const jsonl = gunzipSync(data.jsonl_gzip).toString("utf-8");
    const blocks: MessageBlock[] = [];

    for (const line of jsonl.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type !== "message" || !entry.message) continue;
        const msg = entry.message;
        if (msg.role !== "user" && msg.role !== "assistant") continue;

        const text = extractMessageText(msg.content);
        if (text.trim()) {
          blocks.push({ role: msg.role, text: text.trim() });
        }
      } catch { /* skip malformed */ }
    }

    // Keep last N for preview
    return blocks.length > 50 ? blocks.slice(blocks.length - 50) : blocks;
  } catch {
    return [];
  }
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

/** Close database connection */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function rowToArchived(row: any): ArchivedSession {
  return {
    id: row.id,
    originalPath: row.original_path,
    cwd: row.cwd,
    name: row.name,
    firstMessage: row.first_message,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    durationSeconds: row.duration_seconds,
    userMessageCount: row.user_message_count,
    assistantMessageCount: row.assistant_message_count,
    totalEntries: row.total_entries,
    fileSizeBytes: row.file_size_bytes,
    archivedAt: row.archived_at,
    fullText: row.full_text,
  };
}
