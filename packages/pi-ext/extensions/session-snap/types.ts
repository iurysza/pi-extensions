/** Metrics computed by scanning a session JSONL file */
export interface SessionMetrics {
  /** Original session file path */
  path: string;
  /** Session UUID */
  id: string;
  /** Working directory */
  cwd: string;
  /** User-defined session name */
  name?: string;
  /** First user message text (for preview) */
  firstMessage: string;
  /** First entry timestamp (ms) */
  createdAt: number;
  /** Last entry timestamp (ms) */
  lastActivityAt: number;
  /** Duration in seconds */
  durationSeconds: number;
  /** Number of user messages */
  userMessageCount: number;
  /** Number of assistant messages */
  assistantMessageCount: number;
  /** Total JSONL entries */
  totalEntries: number;
  /** File size in bytes */
  fileSizeBytes: number;
}

/** Classification category for a session */
export type SessionCategory = "delete" | "archive" | "keep";

/** A session with its computed category */
export interface ClassifiedSession extends SessionMetrics {
  category: SessionCategory;
}

/** Archived session record stored in SQLite */
export interface ArchivedSession {
  id: string;
  originalPath: string;
  cwd: string;
  name: string | null;
  firstMessage: string;
  createdAt: number;
  lastActivityAt: number;
  durationSeconds: number;
  userMessageCount: number;
  assistantMessageCount: number;
  totalEntries: number;
  fileSizeBytes: number;
  archivedAt: number;
  fullText: string;
}

/** Configuration thresholds */
export const CONFIG = {
  /** Sessions shorter than this AND with fewer messages than DELETE_MAX_USER_MESSAGES → delete */
  DELETE_MAX_DURATION_MINUTES: 5,
  /** Sessions with fewer user messages than this AND shorter than DELETE_MAX_DURATION_MINUTES → delete */
  DELETE_MAX_USER_MESSAGES: 3,
  /** Sessions older than this (days since last activity) → archive */
  ARCHIVE_MIN_AGE_DAYS: 14,
  /** SQLite database path */
  DB_PATH: `${process.env.HOME}/.pi/agent/session-archive.db`,
} as const;
