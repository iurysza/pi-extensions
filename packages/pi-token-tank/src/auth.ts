import {
  readStoredCredential,
  type ModelRegistry,
} from "@earendil-works/pi-coding-agent";

export type ModelRegistryLike = Pick<
  ModelRegistry,
  "getApiKeyForProvider" | "getRegisteredProviderConfig"
>;

export interface CredentialSourceLike {
  getApiKey(providerId: string): Promise<string | undefined>;
  readCredential(providerId: string): unknown;
  refreshOAuthToken(providerId: string, currentKey: string): Promise<string | null>;
}

interface OAuthLikeCredential {
  type?: string;
  accountId?: string;
  access?: string;
  refresh?: string;
  expires?: number;
  [key: string]: unknown;
}

interface TransientCredential {
  baseAccess: string;
  value: OAuthLikeCredential;
}

function toOAuthLike(cred: unknown): OAuthLikeCredential | undefined {
  if (!cred || typeof cred !== "object" || Array.isArray(cred)) return undefined;
  return cred as OAuthLikeCredential;
}

export function createCredentialSource(
  modelRegistry: ModelRegistryLike,
  readCredential: (providerId: string) => unknown = readStoredCredential,
): CredentialSourceLike {
  const transient = new Map<string, TransientCredential>();

  function readCurrentCredential(providerId: string): unknown {
    const stored = toOAuthLike(readCredential(providerId));
    const cached = transient.get(providerId);
    if (stored?.type === "oauth" && cached && cached.baseAccess === stored.access) {
      return cached.value;
    }
    if (cached) transient.delete(providerId);
    return stored;
  }

  return {
    async getApiKey(providerId) {
      const stored = toOAuthLike(readCredential(providerId));
      const cached = transient.get(providerId);
      if (
        stored?.type === "oauth" &&
        cached &&
        cached.baseAccess === stored.access &&
        cached.value.access
      ) {
        return cached.value.access;
      }
      if (cached) transient.delete(providerId);
      return modelRegistry.getApiKeyForProvider(providerId);
    },

    readCredential: readCurrentCredential,

    async refreshOAuthToken(providerId, currentKey) {
      const stored = toOAuthLike(readCredential(providerId));
      if (stored?.type !== "oauth") return null;
      if (stored.access && stored.access !== currentKey && stored.expires && Date.now() < stored.expires) {
        return stored.access;
      }
      if (!stored.refresh) return null;

      const oauth = modelRegistry.getRegisteredProviderConfig(providerId)?.oauth;
      if (!oauth) return null;

      try {
        const refreshed = await oauth.refreshToken({
          ...stored,
          access: stored.access ?? currentKey,
          refresh: stored.refresh,
          expires: stored.expires ?? 0,
        });
        const access = oauth.getApiKey(refreshed);
        if (!access || access === currentKey || !refreshed.refresh || !Number.isFinite(refreshed.expires)) {
          return null;
        }
        transient.set(providerId, {
          baseAccess: stored.access ?? currentKey,
          value: { ...stored, ...refreshed, type: "oauth" },
        });
        return access;
      } catch {
        return null;
      }
    },
  };
}

function extractAccountId(cred: unknown): string | undefined {
  const o = toOAuthLike(cred);
  if (o?.accountId && typeof o.accountId === "string" && o.accountId.length > 0) {
    return o.accountId;
  }
  return undefined;
}

function extractAccountIdFromJwt(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    const auth = payload["https://api.openai.com/auth"];
    const accountId = auth?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

export type CodexAuthResult =
  | { token: string; accountId: string }
  | { error: string };

export async function getCodexAuth(
  credentials: CredentialSourceLike,
): Promise<CodexAuthResult> {
  const token = await credentials.getApiKey("openai-codex");
  if (!token) {
    return { error: "Codex credentials missing. Run /login openai-codex." };
  }
  const cred = credentials.readCredential("openai-codex");
  let accountId = extractAccountId(cred);
  if (!accountId) {
    accountId = extractAccountIdFromJwt(token);
  }
  if (!accountId) {
    return { error: "Codex account id missing. Run /login openai-codex again." };
  }
  return { token, accountId };
}

export type GitHubCopilotAuthResult =
  | { authenticated: true }
  | { error: string };

function isGitHubDotCom(value: string): boolean {
  try {
    const trimmed = value.trim();
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    return url.hostname.toLowerCase() === "github.com";
  } catch {
    return false;
  }
}

export async function withGitHubCopilotAuth(
  credentials: CredentialSourceLike,
  fetchQuota: (token: string) => Promise<void>,
): Promise<GitHubCopilotAuthResult> {
  const credential = toOAuthLike(credentials.readCredential("github-copilot"));
  if (
    typeof credential?.enterpriseUrl === "string" &&
    credential.enterpriseUrl.trim() &&
    !isGitHubDotCom(credential.enterpriseUrl)
  ) {
    return { error: "GitHub Copilot quota supports GitHub.com only; custom enterprise domains are unsupported." };
  }
  const token = credential?.type === "oauth" && typeof credential.refresh === "string"
    ? credential.refresh.trim()
    : "";
  if (!token) {
    return { error: "GitHub Copilot credentials missing. Run /login github-copilot." };
  }
  await fetchQuota(token);
  return { authenticated: true };
}

export type KimiCredentialType = "oauth" | "api_key";

export type KimiAuthResult =
  | { token: string; type: KimiCredentialType }
  | { error: string };

export async function getKimiAuth(
  credentials: CredentialSourceLike,
): Promise<KimiAuthResult> {
  const token = await credentials.getApiKey("kimi-coding");
  if (!token) {
    const envKey = process.env.KIMI_API_KEY?.trim();
    if (envKey) {
      return { token: envKey, type: "api_key" };
    }
    return { error: "Kimi credentials missing. Run /login kimi-coding or set KIMI_API_KEY." };
  }
  const cred = credentials.readCredential("kimi-coding");
  return { token, type: toOAuthLike(cred)?.type === "oauth" ? "oauth" : "api_key" };
}
