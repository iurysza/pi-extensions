import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { ProviderId, ProviderQuota } from "./types.js";

/** A claim older than this belongs to a crashed or hung session. Fetches time out after 10s. */
const CLAIM_TTL_MS = 30_000;

/** What every Pi session on this machine shares about one provider. Never holds credentials. */
export interface StoredQuota {
  quota?: ProviderQuota;
  /** No session may call the provider before this time. Set after a 429. */
  cooldownUntil?: number;
  /** Last cooldown length, doubled on each consecutive 429. */
  backoffMs?: number;
}

export type ReleaseClaim = () => Promise<void>;

export interface QuotaStore {
  read(providerId: ProviderId): Promise<StoredQuota>;
  write(providerId: ProviderId, entry: StoredQuota): Promise<void>;
  /** Returns a release function, or undefined when another session is already fetching. */
  claim(providerId: ProviderId): Promise<ReleaseClaim | undefined>;
}

export function quotaStoreDir(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-token-tank");
}

/** One JSON file per provider, so sessions refreshing different providers never overwrite each other. */
export function createFileQuotaStore(dir: () => string = () => quotaStoreDir()): QuotaStore {
  function path(providerId: ProviderId, extension: "json" | "lock"): string {
    if (!/^[a-z0-9-]+$/i.test(providerId)) throw new Error(`Invalid quota provider id: ${providerId}`);
    return join(dir(), `${providerId}.${extension}`);
  }

  async function tryCreateLock(lockPath: string): Promise<boolean> {
    try {
      await (await open(lockPath, "wx", 0o600)).close();
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  }

  return {
    async read(providerId) {
      try {
        const value = JSON.parse(await readFile(path(providerId, "json"), "utf8")) as StoredQuota;
        if (!value || typeof value !== "object") return {};
        const quota = value.quota && Array.isArray(value.quota.windows) ? value.quota : undefined;
        return {
          quota,
          cooldownUntil: typeof value.cooldownUntil === "number" ? value.cooldownUntil : undefined,
          backoffMs: typeof value.backoffMs === "number" ? value.backoffMs : undefined,
        };
      } catch {
        return {};
      }
    },

    async write(providerId, entry) {
      const target = path(providerId, "json");
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await mkdir(dir(), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
        await rename(temporary, target);
      } catch {
        await rm(temporary, { force: true }).catch(() => {});
      }
    },

    async claim(providerId) {
      const lockPath = path(providerId, "lock");
      const release: ReleaseClaim = () => rm(lockPath, { force: true }).catch(() => {});
      try {
        await mkdir(dir(), { recursive: true });
        if (await tryCreateLock(lockPath)) return release;
        const age = Date.now() - (await stat(lockPath)).mtimeMs;
        if (age < CLAIM_TTL_MS) return undefined;
        await rm(lockPath, { force: true });
        return (await tryCreateLock(lockPath)) ? release : undefined;
      } catch {
        // An unwritable store must not stop quota refreshes; fall back to per-session fetching.
        return async () => {};
      }
    },
  };
}
