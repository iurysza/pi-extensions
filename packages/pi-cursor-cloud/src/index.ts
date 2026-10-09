import { getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, getCapabilities, Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createCloudClient, type CloudClient, type CloudHandle, type CloudRun } from "./cloud-client.js";
import { agentUrl, cleanText, completionHeader, formatCompletion, formatList, renderCommandView, singleLine, summarize, type AgentSummary, type CommandView } from "./render.js";
import { resolveRepo } from "./repo.js";
import { COMMAND_MENU_COLLECT, cursorMenu } from "./menu.js";
import { elapsedMs, isActive, reduce, shortId, type CloudAgent, type Event, type State } from "./state.js";
import { createWidget } from "./widget.js";

const MESSAGE_TYPE = "cursor-cloud-completion";
const COMMAND_TYPE = "cursor-cloud-command";
const COLLAPSED_LINES = 12;
const DEFAULT_MODEL = "composer-2-5";
const promptSchema = Type.String({ minLength: 1, description: "Task for the cloud agent" });
const idSchema = Type.String({ minLength: 1, description: "Short cloud agent ID or unique prefix" });
const spawnSchema = Type.Object({
  prompt: promptSchema,
  repo: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
});
type Spawn = { prompt: string; repo?: string; ref?: string; model?: string; name?: string };
interface Job { ready: Promise<CloudRun> }
export interface Dependencies {
  client?: CloudClient;
  now?: () => number;
  repo?: typeof resolveRepo;
}

/** Leading flags (--repo, --ref, --model, --name) then the prompt. */
export function parseSpawnArgs(input: string): Spawn {
  const params: Spawn = { prompt: "" };
  let rest = input.trimStart();
  for (;;) {
    const flag = /^--(repo|ref|model|name)(?:=|\s+)(\S+)\s*/.exec(rest);
    if (!flag) break;
    params[flag[1] as "repo" | "ref" | "model" | "name"] = flag[2];
    rest = rest.slice(flag[0].length);
  }
  params.prompt = rest;
  return params;
}

/** The extension owns only agents it creates. SDK handles never enter state or tool results. */
export function registerCloudExtension(pi: ExtensionAPI, dependencies: Dependencies = {}) {
  const client = dependencies.client ?? createCloudClient();
  const now = dependencies.now ?? Date.now;
  const repoDefaults = dependencies.repo ?? resolveRepo;
  let state: State = [];
  let stopped = false;
  const handles = new Map<string, CloudHandle>();
  const jobs = new Map<string, Job>();
  const deleting = new Set<string>();
  const widget = createWidget(() => state, now);

  function dispatch(event: Event) {
    if (stopped) return;
    state = reduce(state, event);
    widget.update();
  }

  function find(id: string): CloudAgent {
    const prefix = id.trim().replace(/^bc-/, "");
    if (!prefix) throw new Error("A cloud agent ID is required.");
    const matches = state.filter(a => a.id.replace(/^bc-/, "").startsWith(prefix));
    if (matches.length !== 1) throw new Error(matches.length ? "Ambiguous cloud agent ID. Use a longer prefix." : "Unknown cloud agent. Only agents started in this process are available.");
    return matches[0];
  }

  function checkSession(ctx: ExtensionContext) {
    if (stopped) throw new Error("This cloud extension session has shut down.");
    widget.attach(ctx);
  }

  function requirePrompt(prompt: string) {
    if (!prompt.trim()) throw new Error("A non-empty prompt is required.");
  }

  function notifyCompletion(id: string) {
    if (stopped) return;
    const agent = state.find(a => a.id === id);
    if (!agent) return;
    pi.sendMessage({ customType: MESSAGE_TYPE, content: formatCompletion(agent), display: true,
      details: { ...summarize(agent, now()), text: "result" in agent.status ? cleanText(agent.status.result.text) : "",
        error: agent.status.type === "failed" ? cleanText(agent.status.error) : undefined } },
    { deliverAs: "followUp", triggerTurn: true });
  }

  function startRun(agent: CloudAgent, handle: CloudHandle, prompt: string) {
    // Send is reserved in the reducer before awaiting the SDK, so concurrent follow-ups cannot race.
    const job: Job = { ready: Promise.resolve().then(() => handle.send(prompt, event => {
      if (jobs.get(agent.id) === job) dispatch({ ...event, id: agent.id });
    })) };
    jobs.set(agent.id, job);
    void (async () => {
      try {
        const run = await job.ready;
        if (stopped || jobs.get(agent.id) !== job) return;
        dispatch({ type: "running", id: agent.id, runId: run.id });
        const completion = await run.wait();
        if (stopped || jobs.get(agent.id) !== job) return;
        const current = find(agent.id);
        const result = { ...completion.result,
          durationMs: completion.result.durationMs || elapsedMs(current, now()),
          text: completion.result.text || current.text };
        dispatch({ ...completion, result, id: agent.id, now: now() });
      } catch (error) {
        if (stopped || jobs.get(agent.id) !== job) return;
        // The client translates SDK failures into credential-free messages.
        const current = find(agent.id);
        dispatch({ type: "error", id: agent.id, now: now(),
          error: error instanceof Error ? error.message : "Cursor Cloud run failed.",
          result: { text: current.text, durationMs: elapsedMs(current, now()), branches: [] } });
      }
      if (!stopped) {
        try { notifyCompletion(agent.id); }
        catch { /* State and result remain available through cursor_cloud_status. */ }
      }
    })();
  }

  async function spawn(params: Spawn, ctx: ExtensionContext): Promise<string> {
    checkSession(ctx);
    requirePrompt(params.prompt);
    const { repo, ref } = await repoDefaults(ctx.cwd, params.repo, params.ref);
    const model = params.model?.trim() || DEFAULT_MODEL;
    const name = singleLine(params.name?.trim() || `cloud-${state.length + 1}`);
    const handle = await client.create({ repo, ref, model, name });
    if (stopped) { handle.close(); throw new Error("Session shut down while creating the cloud agent. No prompt was sent."); }
    handles.set(handle.id, handle);
    const agent: CloudAgent = { id: handle.id, name, description: params.prompt, repo, ref, model,
      startedAt: now(), status: { type: "starting" }, activity: "starting…", text: "", tools: 0, toolCallIds: [] };
    dispatch({ type: "spawned", agent });
    startRun(agent, handle, params.prompt);
    return `Cloud agent ${shortId(handle.id)} (${name}) runs in the background. Results arrive later as a follow-up message. It sees ${repo} at ${ref}, not local uncommitted files. Open: ${agentUrl(handle.id)}`;
  }

  function send(id: string, prompt: string, ctx: ExtensionContext): string {
    checkSession(ctx);
    requirePrompt(prompt);
    const agent = find(id);
    if (deleting.has(agent.id)) throw new Error("Cloud agent deletion is in progress. Start a new agent instead.");
    if (isActive(agent)) throw new Error("Agent already has an active run. Wait until it is idle before sending a follow-up.");
    const handle = handles.get(agent.id);
    if (!handle) throw new Error("Cloud agent handle is unavailable. Start a new agent.");
    dispatch({ type: "followUp", id: agent.id, prompt, now: now() });
    startRun(find(agent.id), handle, prompt);
    return `Follow-up sent to ${shortId(agent.id)} in the background. Results arrive later.`;
  }

  async function cancel(id: string, ctx: ExtensionContext): Promise<string> {
    checkSession(ctx);
    const agent = find(id);
    if (!isActive(agent)) return `Cloud agent ${shortId(agent.id)} is already ${agent.status.type}.`;
    const job = jobs.get(agent.id);
    if (!job) throw new Error("No active cloud run is available to cancel.");
    const run = await job.ready;
    if (stopped) throw new Error("Session shut down. Cloud run was not cancelled.");
    await run.cancel();
    return `Cancellation requested for ${shortId(agent.id)}. Its final result arrives later.`;
  }

  async function remove(id: string, ctx: ExtensionContext): Promise<string> {
    checkSession(ctx);
    const agent = find(id);
    if (isActive(agent)) throw new Error("Cancel the active run and wait for completion before deleting this agent.");
    if (deleting.has(agent.id)) throw new Error("Cloud agent deletion is already in progress.");
    deleting.add(agent.id);
    try {
      await client.delete(agent.id);
      try { handles.get(agent.id)?.close(); } catch { /* Remote deletion succeeded; local close is best-effort. */ }
      handles.delete(agent.id);
      jobs.delete(agent.id);
      dispatch({ type: "removed", id: agent.id });
      return `Deleted cloud agent ${shortId(agent.id)}.`;
    } finally { deleting.delete(agent.id); }
  }

  const textResult = (text: string, details?: unknown) => ({ content: [{ type: "text" as const, text }], details });
  const agentDetails = (id: string) => { try { return { agent: summarize(find(id), now()) }; } catch { return undefined; } };
  pi.registerTool({
    name: "cursor_cloud_spawn", label: "Spawn cloud subagent",
    description: "Run a Cursor Cloud subagent in the BACKGROUND. Returns immediately after creating the agent; results arrive later as a follow-up message. Cloud agents cannot see local uncommitted files. Each run costs real money at Cursor Max Mode pricing. Defaults to the current GitHub origin and an origin-tracked current branch, otherwise main.",
    parameters: spawnSchema, executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) { const text = await spawn(params, ctx); return textResult(text, { agent: summarize(state.at(-1)!, now()) }); },
  });
  pi.registerTool({
    name: "cursor_cloud_send", label: "Send cloud follow-up",
    description: "Send a follow-up to an idle cloud subagent in the background. Not live steering: sending during an active run is rejected. Results arrive later. Each follow-up costs money.",
    parameters: Type.Object({ id: idSchema, prompt: promptSchema }), executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) { return textResult(send(params.id, params.prompt, ctx), agentDetails(params.id)); },
  });
  pi.registerTool({
    name: "cursor_cloud_cancel", label: "Cancel cloud run",
    description: "Cancel an active cloud subagent run started by this process. Does not delete the agent.",
    parameters: Type.Object({ id: idSchema }), executionMode: "sequential",
    async execute(_id, params, _signal, _update, ctx) { return textResult(await cancel(params.id, ctx), agentDetails(params.id)); },
  });
  pi.registerTool({
    name: "cursor_cloud_status", label: "Cloud subagent status",
    description: "Read current state, last activity, and result text for cloud subagents started in this process. Omit id to list all.",
    parameters: Type.Object({ id: Type.Optional(idSchema) }),
    async execute(_id, params) {
      const agents = params.id ? [find(params.id)] : state;
      const rows = agents.map(a => ({ id: shortId(a.id), url: agentUrl(a.id), name: a.name, status: a.status.type, repo: a.repo,
        ref: a.ref, model: a.model, elapsedMs: elapsedMs(a, now()), tools: a.tools, activity: cleanText(a.activity),
        text: "result" in a.status ? a.status.result.text : a.text,
        error: a.status.type === "failed" ? a.status.error : undefined,
        branches: "result" in a.status ? a.status.result.branches : [] }));
      return textResult(JSON.stringify(rows, null, 2), { agents: agents.map(a => ({ ...summarize(a, now()),
        text: cleanText("result" in a.status ? a.status.result.text : a.text) })) });
    },
  });

  class Cancelled extends Error {}

  /** Menu entries run commands without arguments, so ask for whatever is missing. */
  async function ask(ctx: ExtensionContext, title: string): Promise<string> {
    if (!ctx.hasUI) throw new Error("This /cloud command needs arguments outside the interactive UI.");
    const text = (await ctx.ui.input(title))?.trim();
    if (!text) throw new Cancelled("Cancelled.");
    return text;
  }
  async function pick(ctx: ExtensionContext, title: string, fits: (agent: CloudAgent) => boolean): Promise<string> {
    if (!ctx.hasUI) throw new Error("This /cloud command needs an agent id outside the interactive UI.");
    const options = state.filter(fits).map(a => ({ id: a.id, label: `${shortId(a.id)}  ${a.name}  · ${a.status.type}` }));
    if (!options.length) throw new Error("No cloud agents fit this action.");
    const label = await ctx.ui.select(title, options.map(o => o.label));
    const chosen = options.find(o => o.label === label);
    if (!chosen) throw new Cancelled("Cancelled.");
    return chosen.id;
  }

  pi.events?.on(COMMAND_MENU_COLLECT, (data: unknown) => {
    if (!data || typeof data !== "object" || (data as { version?: unknown }).version !== 1) return;
    const names = new Set(pi.getCommands().filter(c => c.source === "extension").map(c => c.name));
    const menu = cursorMenu(name => names.has(name));
    if (menu) (data as { add(group: unknown): void }).add(menu);
  });

  pi.registerCommand("cloud", {
    description: "Cloud subagents: list, spawn [--repo <url>] [--ref <ref>] [--model <id>] [--name <n>] <prompt>, send <id> <prompt>, cancel <id>, delete <id>, open <id>",
    async handler(args, ctx) {
      try {
        const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(args.trim());
        const action = match?.[1] ?? "list";
        const rest = match?.[2] ?? "";
        let text: string;
        let view: CommandView | undefined;
        if (action === "list" && !rest) { text = formatList(state, now()); view = { kind: "list", agents: state.map(a => summarize(a, now())) }; }
        else if (action === "spawn") {
          const params = parseSpawnArgs(rest);
          if (!params.prompt.trim()) params.prompt = await ask(ctx, "Cloud agent prompt");
          text = await spawn(params, ctx);
          view = { kind: "spawn", agent: summarize(state.at(-1)!, now()) };
        } else if (action === "send") {
          const parts = /^(\S+)(?:\s+([\s\S]+))?$/.exec(rest);
          const id = parts?.[1] ?? await pick(ctx, "Follow up which cloud agent?", a => !isActive(a));
          text = send(id, parts?.[2] ?? await ask(ctx, `Follow-up for ${shortId(find(id).id)}`), ctx);
        } else if (action === "cancel" && !/\s/.test(rest)) text = await cancel(rest || await pick(ctx, "Cancel which cloud run?", isActive), ctx);
        else if (action === "delete" && !/\s/.test(rest)) text = await remove(rest || await pick(ctx, "Delete which cloud agent?", a => !isActive(a)), ctx);
        else if (action === "open" && !/\s/.test(rest)) {
          const url = agentUrl(find(rest || await pick(ctx, "Open which cloud agent?", () => true)).id);
          const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
          const result = await pi.exec(opener, [url]);
          if (result.code !== 0 && opener !== "explorer") throw new Error(`Could not open ${url}`);
          ctx.ui.notify(`Opened ${url}`, "info");
          return;
        }
        else throw new Error("Usage: /cloud [list | spawn [--repo <url>] [--ref <ref>] [--model <id>] [--name <n>] <prompt> | send <id> <prompt> | cancel <id> | delete <id> | open <id>]");
        if (!stopped) pi.sendMessage({ customType: COMMAND_TYPE, content: text, display: true, details: view });
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Cloud command failed.", error instanceof Cancelled ? "info" : "error"); }
    },
  });
  const clickable = () => getCapabilities().hyperlinks;
  pi.registerMessageRenderer(MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as (AgentSummary & { text?: string; error?: string }) | undefined;
    // Older sessions stored plain text only.
    if (!details?.url) {
      const text = typeof message.content === "string" ? cleanText(message.content) : "Cloud agent completed.";
      const [header, ...body] = text.split("\n");
      return new Text(theme.fg("accent", theme.bold(header)) + "\n" + (expanded ? body.join("\n") : body.join("\n").slice(0, 1200)), 0, 0);
    }
    const box = new Container();
    box.addChild(new Text(completionHeader(details, theme, clickable()).join("\n"), 0, 0));
    if (details.error) box.addChild(new Text(theme.fg("error", `Error: ${details.error}`), 0, 0));
    const body = details.text?.trim() || "No result text.";
    const lines = body.split("\n");
    const shown = expanded || lines.length <= COLLAPSED_LINES ? body : lines.slice(0, COLLAPSED_LINES).join("\n");
    box.addChild(new Markdown(shown, 0, 1, getMarkdownTheme()));
    if (!expanded && lines.length > COLLAPSED_LINES) box.addChild(new Text(theme.fg("dim", `… ${lines.length - COLLAPSED_LINES} more lines, ctrl+o to expand`), 0, 0));
    return box;
  });
  pi.registerMessageRenderer(COMMAND_TYPE, (message, _options, theme) => {
    const view = message.details as CommandView | undefined;
    if (view?.kind) return new Text(renderCommandView(view, theme, clickable()).join("\n"), 0, 0);
    return new Text(typeof message.content === "string" ? cleanText(message.content) : "", 0, 0);
  });
  pi.on("session_start", (_event, ctx) => { widget.attach(ctx); });
  pi.on("session_shutdown", () => {
    stopped = true;
    widget.dispose();
    // Closing detaches listeners. Never cancel work on Cursor's infrastructure during shutdown.
    for (const handle of handles.values()) { try { handle.close(); } catch { /* Best-effort local cleanup. */ } }
    handles.clear();
    jobs.clear();
  });
}

export default function cursorCloudExtension(pi: ExtensionAPI) { registerCloudExtension(pi); }
