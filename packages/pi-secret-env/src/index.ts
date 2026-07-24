import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const SECRETS_PATH = path.join(homedir(), ".config", "ai", "secrets.env");
const OLD_SECRETS_PATH = path.join(homedir(), ".config", "opencode", "secrets.env");
const SECRETS_DIR = path.dirname(SECRETS_PATH);

const BLOCKED_PATHS = [
  SECRETS_PATH,
  SECRETS_DIR,
  OLD_SECRETS_PATH,
  "~/.config/ai/secrets.env",
  "~/.config/ai",
  "~/.config/opencode/secrets.env",
];
const BLOCKED_MARKERS = [".config/ai", "secrets.env"];

export function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) env[key] = value;
    }
  } catch {
    // ignore missing or unreadable file
  }
  return env;
}

export function isSecretsPath(str: string): boolean {
  if (!str || typeof str !== "string") return false;
  const home = homedir();
  const normalized = str.replace(/(^|[\s"'=(:])~(?=\/|$)/g, `$1${home}`);
  return (
    BLOCKED_PATHS.some((p) => str.includes(p) || normalized.includes(p)) ||
    BLOCKED_MARKERS.some((p) => str.includes(p) || normalized.includes(p))
  );
}

export function isEnvDumpCommand(command: string): boolean {
  const trimmed = command.trim();
  const exact = ["env", "printenv", "export -p", "set"];
  if (exact.includes(trimmed)) return true;
  if (/^\s*env\s*\|/.test(trimmed)) return true;
  if (/^\s*printenv\s*\|/.test(trimmed)) return true;
  return false;
}

export function redactSecrets(text: string, secrets: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(secrets)) {
    if (value && value.length >= 3) {
      try {
        const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        out = out.replace(new RegExp(escaped, "g"), "[REDACTED]");
      } catch {
        // ignore regex errors
      }
    }
    try {
      const keyEscaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(
        new RegExp(`(^|\\s)${keyEscaped}=\\S+`, "gm"),
        (_match, prefix) => `${prefix}${key}=[REDACTED]`
      );
    } catch {
      // ignore regex errors
    }
  }
  return out;
}

export function registerSecretEnv(pi: ExtensionAPI, secrets: Record<string, string>) {
  // Inject into process.env so Pi providers and other extensions can use keys
  Object.assign(process.env, secrets);

  // Block tool calls that touch secret files or dump env
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const cmd = (event.input as { command: string }).command;
      if (isEnvDumpCommand(cmd)) {
        if (ctx.hasUI) ctx.ui.notify("Blocked env dump command", "warning");
        return { block: true, reason: "Env dump blocked for security" };
      }
      if (isSecretsPath(cmd)) {
        if (ctx.hasUI) ctx.ui.notify("Blocked secret file access", "warning");
        return { block: true, reason: "Access to secrets file blocked" };
      }
    }

    if (["read", "grep", "find", "ls", "write", "edit"].includes(event.toolName)) {
      const input = event.input as Record<string, unknown>;
      const target =
        (input.path as string) ||
        (input.pattern as string) ||
        (input.filePath as string) ||
        "";
      if (isSecretsPath(target)) {
        if (ctx.hasUI) ctx.ui.notify("Blocked secret file access", "warning");
        return { block: true, reason: "Access to secrets file blocked" };
      }
    }
  });

  // Redact secret values from final tool results without owning any tools.
  pi.on("tool_result", async (event) => {
    let changed = false;
    const content = event.content.map((item: any) => {
      if (item?.type !== "text" || typeof item.text !== "string") return item;
      const text = redactSecrets(item.text, secrets);
      if (text === item.text) return item;
      changed = true;
      return { ...item, text };
    });

    return changed ? { content } : undefined;
  });

  // Inject secrets into user ! / !! commands
  pi.on("user_bash", (_event) => {
    const local = createLocalBashOperations();
    return {
      operations: {
        exec(command, cwd, options) {
          return local.exec(command, cwd, {
            ...options,
            env: { ...options?.env, ...secrets },
          });
        },
      },
    };
  });
}

export default function secretEnvExtension(pi: ExtensionAPI) {
  registerSecretEnv(pi, parseEnvFile(SECRETS_PATH));
}
