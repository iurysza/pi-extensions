import { readFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { type SessionMetrics, type SessionCategory, type ClassifiedSession, CONFIG } from "./types.js";

const SESSIONS_DIR = `${process.env.HOME}/.pi/agent/sessions`;

/** Parse a timestamp from session entries — handles both ISO strings and unix ms */
function parseTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") return new Date(ts).getTime();
  return 0;
}

/** Scan a single session JSONL file and compute metrics */
export function scanSession(filePath: string): SessionMetrics {
  const stat = statSync(filePath);
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());

  let id = "";
  let cwd = "";
  let name: string | undefined;
  let firstMessage = "";
  let firstTimestamp = 0;
  let lastTimestamp = 0;
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const ts = parseTimestamp(entry.timestamp);

      if (ts > 0) {
        if (firstTimestamp === 0 || ts < firstTimestamp) firstTimestamp = ts;
        if (ts > lastTimestamp) lastTimestamp = ts;
      }

      if (entry.type === "session") {
        id = entry.id || "";
        cwd = entry.cwd || "";
      } else if (entry.type === "session_info" && entry.name) {
        name = entry.name;
      } else if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        if (msg.role === "user") {
          userMessageCount++;
          if (!firstMessage) {
            firstMessage = extractText(msg.content);
          }
        } else if (msg.role === "assistant") {
          assistantMessageCount++;
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  const durationSeconds = firstTimestamp > 0 && lastTimestamp > 0 ? Math.round((lastTimestamp - firstTimestamp) / 1000) : 0;

  return {
    path: filePath,
    id,
    cwd,
    name,
    firstMessage: firstMessage.slice(0, 200),
    createdAt: firstTimestamp,
    lastActivityAt: lastTimestamp,
    durationSeconds,
    userMessageCount,
    assistantMessageCount,
    totalEntries: lines.length,
    fileSizeBytes: stat.size,
  };
}

/** Extract text content from message content field */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
  }
  return "";
}

/** Extract full conversation text (all user + assistant messages) from a JSONL file */
export function extractFullText(filePath: string): string {
  const raw = readFileSync(filePath, "utf-8");
  const lines = raw.split("\n").filter((l) => l.trim());
  const texts: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && entry.message) {
        const msg = entry.message;
        if (msg.role === "user" || msg.role === "assistant") {
          const text = extractText(msg.content);
          if (text.trim()) texts.push(text);
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return texts.join("\n\n");
}

/** Classify a session into delete/archive/keep */
export function classifySession(metrics: SessionMetrics): SessionCategory {
  const durationMinutes = metrics.durationSeconds / 60;

  // DELETE: trivial sessions (short AND few messages)
  if (durationMinutes < CONFIG.DELETE_MAX_DURATION_MINUTES && metrics.userMessageCount < CONFIG.DELETE_MAX_USER_MESSAGES) {
    return "delete";
  }

  // ARCHIVE: old sessions (last activity > threshold days ago)
  const ageMs = Date.now() - metrics.lastActivityAt;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays > CONFIG.ARCHIVE_MIN_AGE_DAYS) {
    return "archive";
  }

  // KEEP: everything else
  return "keep";
}

/** Scan all sessions across all project directories */
export function scanAllSessions(onProgress?: (current: number, total: number) => void): ClassifiedSession[] {
  const results: ClassifiedSession[] = [];
  const allFiles: string[] = [];

  // Collect all JSONL files
  try {
    const dirs = readdirSync(SESSIONS_DIR);
    for (const dir of dirs) {
      const dirPath = join(SESSIONS_DIR, dir);
      try {
        const files = readdirSync(dirPath);
        for (const file of files) {
          if (file.endsWith(".jsonl")) {
            allFiles.push(join(dirPath, file));
          }
        }
      } catch {
        // Not a directory or not readable
      }
    }
  } catch {
    return [];
  }

  // Scan each file
  for (let i = 0; i < allFiles.length; i++) {
    onProgress?.(i + 1, allFiles.length);
    try {
      const metrics = scanSession(allFiles[i]);
      const category = classifySession(metrics);
      results.push({ ...metrics, category });
    } catch {
      // Skip unreadable sessions
    }
  }

  return results;
}

/** Format bytes to human readable */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Format duration to human readable */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Extract short project name from CWD */
export function projectName(cwd: string): string {
  if (!cwd) return "???";
  const parts = cwd.split("/");
  return parts[parts.length - 1] || parts[parts.length - 2] || cwd;
}
