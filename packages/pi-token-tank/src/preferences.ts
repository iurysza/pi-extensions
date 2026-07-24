import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type FooterMode = "minimal" | "full";

export function preferencePath(agentDir = getAgentDir()): string {
  return join(agentDir, "pi-token-tank.json");
}

export async function loadFooterMode(path = preferencePath()): Promise<FooterMode> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { footerMode?: unknown };
    return value.footerMode === "full" ? "full" : "minimal";
  } catch {
    return "minimal";
  }
}

export async function saveFooterMode(mode: FooterMode, path = preferencePath()): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify({ footerMode: mode })}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
