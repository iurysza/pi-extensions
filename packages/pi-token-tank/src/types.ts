import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CredentialSourceLike } from "./auth.js";

export type ProviderId = string;
export type QuotaState = "live" | "stale" | "missing" | "error";

export interface QuotaWindow {
  id: string;
  shortLabel: string;
  longLabel: string;
  resetStyle: "time" | "weekday-time";
  usedPercent: number;
  used?: number;
  limit?: number;
  resetsAt?: number;
}

export interface ProviderQuota {
  provider: ProviderId;
  state: QuotaState;
  fetchedAt?: number;
  plan?: string;
  windows: QuotaWindow[];
  error?: string;
}

export type QuotaSnapshot = Record<ProviderId, ProviderQuota>;

export interface QuotaProvider {
  id: ProviderId;
  label: string;
  matchesModel(model: ExtensionContext["model"]): boolean;
  fetch(credentials: CredentialSourceLike): Promise<ProviderQuota>;
  credentialsHint: string;
  footerWindows: {
    minimal: string[];
    full: string[];
  };
}
