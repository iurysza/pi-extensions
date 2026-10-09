export const COMMAND_MENU_COLLECT = "command-menu:collect:v1";

type Item =
  | { key: string; label: string; command: { name: string; args?: string } }
  | { key: string; label: string; items: Item[] };

export interface CursorMenu { id: string; key: string; label: string; items: Item[] }

const cmd = (key: string, label: string, name: string, args?: string): Item =>
  ({ key, label, command: args ? { name, args } : { name } });

/** Leader Key drops a group if any command is missing, so only include loaded commands. */
function keep(items: Item[], has: (name: string) => boolean): Item[] {
  return items.flatMap((item): Item[] => {
    if ("command" in item) return has(item.command.name) ? [item] : [];
    const children = keep(item.items, has);
    return children.length ? [{ ...item, items: children }] : [];
  });
}

export function cursorMenu(has: (name: string) => boolean): CursorMenu | undefined {
  const items = keep([
    cmd("s", "Spawn cloud agent…", "cloud", "spawn"),
    cmd("l", "List cloud agents", "cloud", "list"),
    cmd("f", "Follow up…", "cloud", "send"),
    cmd("o", "Open in browser…", "cloud", "open"),
    cmd("p", "Plan mode", "cursor-mode", "plan"),
    cmd("a", "Agent mode", "cursor-mode", "agent"),
    { key: "r", label: "Runtime", items: [
      cmd("l", "Local", "cursor-runtime", "local"),
      cmd("c", "Cloud", "cursor-runtime", "cloud"),
    ] },
    cmd("q", "Toggle fast", "cursor-fast"),
    { key: "z", label: "More", items: [
      cmd("c", "Cancel cloud run…", "cloud", "cancel"),
      cmd("d", "Delete cloud agent…", "cloud", "delete"),
      cmd("h", "Recorded cloud runs", "cursor-cloud", "list"),
      { key: "x", label: "Maintenance", items: [
        cmd("m", "Refresh models", "cursor-refresh-models"),
        cmd("c", "Refresh config", "cursor-refresh-config"),
        cmd("h", "Toggle HTTP/1.1", "cursor-http"),
        cmd("r", "Clean local resumes", "cursor-local-resume-cleanup"),
        cmd("t", "Show tools", "cursor-tools"),
      ] },
    ] },
  ], has);
  return items.length ? { id: "cursor", key: "c", label: "Cursor", items } : undefined;
}
