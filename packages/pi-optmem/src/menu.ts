// Leader-key contribution (command-menu:collect:v1). Items can only run slash
// commands, so every item runs a `/memory <subcommand>`.

export const COMMAND_MENU_COLLECT = "command-menu:collect:v1";
export const MENU_ID = "pi-optmem";
export const MENU_KEY = "b";

type Item =
  | { key: string; label: string; command: { name: string; args?: string } }
  | { key: string; label: string; items: Item[] };

const run = (key: string, label: string, args: string): Item => ({ key, label, command: { name: "memory", args } });

export const MENU_GROUP = {
  id: MENU_ID,
  key: MENU_KEY,
  label: "Memory",
  items: [
    {
      key: "s",
      label: "This session",
      items: [run("o", "On", "on"), run("r", "Read-only", "read"), run("f", "Off", "off"), run("s", "Status", "status")],
    },
    {
      key: "b",
      label: "Browse",
      items: [run("w", "Wake view", "view"), run("s", "Search", "search"), run("z", "Zoom", "zoom"), run("l", "Open log", "log")],
    },
    {
      key: "f",
      label: "Files",
      items: [run("r", "Reveal memory folder", "reveal"), run("e", "Edit config", "config"), run("p", "Paths and memo version", "paths")],
    },
    {
      key: "d",
      label: "Defaults",
      items: [
        run("d", "Default mode for new sessions", "default"),
        run("f", "Rule for this folder", "rule"),
        run("m", "Model for generation and naps", "model"),
      ],
    },
    {
      key: "m",
      label: "Maintenance",
      items: [run("s", "Stats", "stats"), run("n", "Run pending naps", "naps"), run("f", "Forget range", "forget")],
    },
    {
      key: "g",
      label: "Generate",
      items: [
        run("g", "Generate or rebuild from sessions", "generate"),
        run("c", "Catch up", "catchup"),
        run("j", "Job status", "job"),
        run("x", "Cancel job", "cancel"),
      ],
    },
  ] satisfies Item[],
};

type Events = { on(channel: string, handler: (data: unknown) => void): () => void };

export function subscribeMenu(events: Events): () => void {
  return events.on(COMMAND_MENU_COLLECT, (value) => {
    const request = value as { version?: unknown; add?: unknown } | undefined;
    if (!request || request.version !== 1 || typeof request.add !== "function") return;
    (request.add as (group: unknown) => void)(MENU_GROUP);
  });
}

/** Every `/memory` subcommand the menu uses, for the command's own validation. */
export function menuSubcommands(): string[] {
  const out: string[] = [];
  const walk = (items: readonly Item[]) => {
    for (const item of items) {
      if ("items" in item) walk(item.items);
      else if (item.command.args) out.push(item.command.args);
    }
  };
  walk(MENU_GROUP.items);
  return out;
}
