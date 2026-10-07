import type { ExtensionAPI, ToolRendererResolver } from "@earendil-works/pi-coding-agent";
import { createTidyExtension } from "../../../extensions/tool-presentation/tidy/index.js";

export const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, "");
export const theme = { fg: (_key: string, text: string) => text, bg: (_key: string, text: string) => text } as any;

export async function rendererHarness({ enabled = true, chill = false } = {}) {
  const hooks = new Map<string, ((event: any, ctx: any) => unknown)[]>();
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  const resolvers: ToolRendererResolver[] = [];
  const pi = {
    events: {},
    on(name: string, handler: any) { hooks.set(name, [...hooks.get(name) ?? [], handler]); },
    registerTool(tool: any) { tools.set(tool.name, tool); },
    registerToolRenderer(resolver: ToolRendererResolver) { resolvers.push(resolver); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    registerShortcut() {}, registerMessageRenderer() {},
  };
  await createTidyExtension({
    cwd: process.cwd(), loadState: () => ({ enabled, source: "default" }),
    loadMode: () => "default", loadIcons: () => true, loadChill: () => chill,
    createIntegration: () => ({
      async initialize() { return { skipTidyTools: new Set(), commit() {} } as any; },
      async run() { throw new Error("not used"); },
    }),
  })(pi as unknown as ExtensionAPI);
  const emit = async (name: string, event: any = {}, ctx: any = {}) => {
    const results = [];
    for (const handler of hooks.get(name) ?? []) results.push(await handler(event, ctx));
    return results;
  };
  return { tools, commands, resolvers, emit };
}

export function context(id: string, args: any = {}, expanded = false) {
  return { toolCallId: id, args, state: {}, isPartial: false, isError: false, expanded, invalidate() {} } as any;
}
