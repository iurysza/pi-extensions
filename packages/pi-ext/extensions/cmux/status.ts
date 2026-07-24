/**
 * Sidebar status pill manager for cmux.
 *
 * Displays only the agent running/idle state in the cmux workspace sidebar.
 *
 * Uses v1 raw text commands over the socket (v2 doesn't expose set_status yet).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { CmuxClient } from "./cmux-client.js";

const STATUS_KEYS = ["pi_state"] as const;

export function wireStatus(pi: ExtensionAPI, client: CmuxClient): void {
  const workspaceId = process.env.CMUX_WORKSPACE_ID;

  async function setStatus(
    key: string,
    value: string,
    icon: string,
    color: string,
  ): Promise<void> {
    const tab = workspaceId ? ` --tab=${workspaceId}` : "";
    await client.v1(`set_status ${key} ${value} --icon=${icon} --color=${color}${tab}`);
  }

  async function clearStatus(key: string): Promise<void> {
    const tab = workspaceId ? ` --tab=${workspaceId}` : "";
    await client.v1(`clear_status ${key}${tab}`);
  }

  async function clearAllStatus(): Promise<void> {
    for (const key of STATUS_KEYS) {
      await clearStatus(key);
    }
  }

  // Note: No isConnected() guards — v1() handles auto-reconnection internally.

  pi.on("session_start", async () => {
    await setStatus("pi_state", "Idle", "checkmark", "#A6E3A1");
  });

  pi.on("agent_start", async () => {
    await setStatus("pi_state", "Running", "bolt.fill", "#F38BA8");
  });

  pi.on("agent_end", async () => {
    await setStatus("pi_state", "Idle", "checkmark", "#A6E3A1");
  });

  pi.on("session_shutdown", async () => {
    await clearAllStatus();
  });
}
