// Read-only access to memo's on-disk format (pinned 1fb164c). Never writes:
// every change goes through memo itself.
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const LOG_REC = 320;
export const TREE_REC = 288;
export const RAW_MAX = 16;
export const ENTRY_BYTES = 280;

export type Memory = { readonly id: number; readonly date: string; readonly text: string };
export type Block = { readonly lo: number; readonly hi: number };

function size(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function logPath(dir: string): string {
  return join(dir, "LOG.txt");
}

export function treePath(dir: string, blockSize: number): string {
  return join(dir, "TREE", String(blockSize));
}

export function logLength(dir: string): number {
  return Math.floor(size(logPath(dir)) / LOG_REC);
}

function readBytes(path: string, offset: number, length: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = readSync(fd, buffer, 0, length, offset);
    return buffer.subarray(0, read);
  } finally {
    closeSync(fd);
  }
}

/** `#<id> <date> <text>` padded to LOG_REC. */
export function parseLogRecord(record: Buffer): Memory {
  const line = record.toString("utf8").trimEnd();
  const match = /^#(\d+) (\S+) ?(.*)$/s.exec(line);
  if (!match) throw new Error(`bad log record: ${JSON.stringify(line.slice(0, 40))}`);
  return { id: Number(match[1]), date: match[2]!, text: match[3]! };
}

/** Memories [lo, hi). */
export function readMemories(dir: string, lo: number, hi: number): Memory[] {
  if (hi <= lo) return [];
  const buffer = readBytes(logPath(dir), lo * LOG_REC, (hi - lo) * LOG_REC);
  const out: Memory[] = [];
  for (let i = 0; i + LOG_REC <= buffer.length; i += LOG_REC) out.push(parseLogRecord(buffer.subarray(i, i + LOG_REC)));
  return out;
}

/** Summary of block [lo, hi), or undefined when not built. */
export function readSummary(dir: string, block: Block): string | undefined {
  const blockSize = block.hi - block.lo;
  const path = treePath(dir, blockSize);
  const index = block.lo / blockSize;
  if (size(path) < (index + 1) * TREE_REC) return undefined;
  const text = readBytes(path, index * TREE_REC, TREE_REC).toString("utf8").trimEnd();
  return text || undefined;
}

/** Same order as memo's `pending()`: level by level, smallest first. */
export function pendingBlocks(dir: string, total = logLength(dir)): Block[] {
  const todo: Block[] = [];
  for (let blockSize = 2; blockSize <= total; blockSize *= 2) {
    const have = Math.floor(size(treePath(dir, blockSize)) / TREE_REC);
    for (let k = have; k < Math.floor(total / blockSize); k++) todo.push({ lo: k * blockSize, hi: (k + 1) * blockSize });
  }
  return todo;
}

/**
 * Blocks that can be summarised now: raw-input blocks (size <= RAW_MAX) at
 * any level, and larger blocks whose two halves are already built.
 */
export function readyBlocks(dir: string, total = logLength(dir)): Block[] {
  return pendingBlocks(dir, total).filter((block) => {
    if (block.hi - block.lo <= RAW_MAX) return true;
    const mid = (block.lo + block.hi) / 2;
    return readSummary(dir, { lo: block.lo, hi: mid }) !== undefined && readSummary(dir, { lo: mid, hi: block.hi }) !== undefined;
  });
}

/** The text memo would show the model for this block. */
export function blockInput(dir: string, block: Block): string[] {
  if (block.hi - block.lo <= RAW_MAX) return readMemories(dir, block.lo, block.hi).map((m) => `#${m.id} ${m.date} ${m.text}`);
  const mid = (block.lo + block.hi) / 2;
  return [
    { lo: block.lo, hi: mid },
    { lo: mid, hi: block.hi },
  ].map((half) => `#${half.lo}-${half.hi - 1} ${readSummary(dir, half) ?? "(missing)"}`);
}

export type StoreStats = {
  readonly exists: boolean;
  readonly count: number;
  readonly first?: string;
  readonly last?: string;
  readonly pending: number;
  readonly bytes: number;
};

function dirBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? dirBytes(path) : size(path);
  }
  return total;
}

export function storeStats(dir: string): StoreStats {
  let exists = false;
  try {
    exists = statSync(dir).isDirectory();
  } catch {
    exists = false;
  }
  if (!exists) return { exists, count: 0, pending: 0, bytes: 0 };
  const count = logLength(dir);
  const first = count ? readMemories(dir, 0, 1)[0]?.date : undefined;
  const last = count ? readMemories(dir, count - 1, count)[0]?.date : undefined;
  return { exists, count, first, last, pending: pendingBlocks(dir, count).length, bytes: dirBytes(dir) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
