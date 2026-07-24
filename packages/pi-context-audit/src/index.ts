import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  ExtensionCommandContext,
  ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { formatSkillsForPrompt, getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_DIR = join(getAgentDir(), "cache", "context-audit");

type Metric = { chars: number; bytes: number; tokens: number };

type ToolAudit = {
  name: string;
  active: boolean;
  sourceInfo: unknown;
  description: Metric;
  promptSnippet: Metric;
  promptGuidelines: Metric;
  parametersJson: Metric;
  llmSchemaJson: Metric;
  fullAuditJson: Metric;
};

type ProviderPayloadSummary = {
  capturedAt: string;
  totalJson: Metric;
  topLevel: Array<{ key: string; size: Metric }>;
  tools?: { count: number; json: Metric };
  messages?: { count: number; json: Metric };
  input?: Metric;
  system?: Metric;
  instructions?: Metric;
  systemInstruction?: Metric;
};

let lastProviderPayload: ProviderPayloadSummary | undefined;

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function metric(text: string): Metric {
  return {
    chars: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    tokens: estimateTokens(text.length),
  };
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, item) => {
        if (typeof item === "bigint") return item.toString();
        if (typeof item === "function") return `[Function ${item.name || "anonymous"}]`;
        if (typeof item === "symbol") return item.toString();
        if (item && typeof item === "object") {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      }) ?? ""
    );
  } catch (error) {
    return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
  }
}

function measureJson(value: unknown): Metric {
  return metric(safeJson(value));
}

function currentDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sum(items: Metric[]): Metric {
  return items.reduce(
    (acc, item) => ({
      chars: acc.chars + item.chars,
      bytes: acc.bytes + item.bytes,
      tokens: acc.tokens + item.tokens,
    }),
    { chars: 0, bytes: 0, tokens: 0 },
  );
}

function metricText(m: Metric): string {
  return `${m.chars.toLocaleString()} chars / ~${m.tokens.toLocaleString()} tok`;
}

function parseArgs(args: string): { format: "md" | "json"; open: boolean; copy: boolean; help: boolean } {
  const parts = args
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const flags = new Set(parts);
  return {
    format: flags.has("json") ? "json" : "md",
    open: flags.has("open"),
    copy: flags.has("copy"),
    help: flags.has("help") || flags.has("--help") || flags.has("-h"),
  };
}

function auditTools(pi: ExtensionAPI) {
  const activeNames = new Set(pi.getActiveTools());
  const tools = pi.getAllTools().map((tool: ToolInfo) => {
    const raw = tool as ToolInfo & { promptSnippet?: string };
    const item: ToolAudit = {
      name: tool.name,
      active: activeNames.has(tool.name),
      sourceInfo: tool.sourceInfo,
      description: metric(tool.description ?? ""),
      promptSnippet: metric(raw.promptSnippet ?? ""),
      promptGuidelines: measureJson(tool.promptGuidelines ?? []),
      parametersJson: measureJson(tool.parameters),
      llmSchemaJson: measureJson({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }),
      fullAuditJson: measureJson({
        name: tool.name,
        sourceInfo: tool.sourceInfo,
        description: tool.description,
        promptSnippet: raw.promptSnippet,
        promptGuidelines: tool.promptGuidelines,
        parameters: tool.parameters,
      }),
    };
    return item;
  });

  const bySource = new Map<
    string,
    { count: number; activeCount: number; llmSchemaJson: Metric; parametersJson: Metric; fullAuditJson: Metric }
  >();

  for (const tool of tools) {
    const info = tool.sourceInfo as { source?: string; path?: string } | undefined;
    const key = `${info?.source ?? "unknown"}${info?.path ? ` (${info.path})` : ""}`;
    const entry = bySource.get(key) ?? {
      count: 0,
      activeCount: 0,
      llmSchemaJson: { chars: 0, bytes: 0, tokens: 0 },
      parametersJson: { chars: 0, bytes: 0, tokens: 0 },
      fullAuditJson: { chars: 0, bytes: 0, tokens: 0 },
    };
    entry.count += 1;
    if (tool.active) entry.activeCount += 1;
    entry.llmSchemaJson = sum([entry.llmSchemaJson, tool.llmSchemaJson]);
    entry.parametersJson = sum([entry.parametersJson, tool.parametersJson]);
    entry.fullAuditJson = sum([entry.fullAuditJson, tool.fullAuditJson]);
    bySource.set(key, entry);
  }

  const activeTools = tools.filter((tool) => tool.active);
  return {
    allCount: tools.length,
    activeCount: activeTools.length,
    inactiveCount: tools.length - activeTools.length,
    totals: {
      allLlmSchemaJson: sum(tools.map((tool) => tool.llmSchemaJson)),
      activeLlmSchemaJson: sum(activeTools.map((tool) => tool.llmSchemaJson)),
      allParametersJson: sum(tools.map((tool) => tool.parametersJson)),
      activeParametersJson: sum(activeTools.map((tool) => tool.parametersJson)),
      allFullAuditJson: sum(tools.map((tool) => tool.fullAuditJson)),
      activeFullAuditJson: sum(activeTools.map((tool) => tool.fullAuditJson)),
    },
    bySource: Array.from(bySource.entries())
      .map(([source, value]) => ({ source, ...value }))
      .sort((a, b) => b.llmSchemaJson.chars - a.llmSchemaJson.chars),
    items: tools.sort((a, b) => b.llmSchemaJson.chars - a.llmSchemaJson.chars),
  };
}

function renderedGuidelines(options: BuildSystemPromptOptions): string {
  const tools = options.selectedTools || ["read", "bash", "edit", "write"];
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    guidelines.push(trimmed);
  };

  if (tools.includes("bash") && !tools.includes("grep") && !tools.includes("find") && !tools.includes("ls")) {
    add("Use bash for file operations like ls, rg, find");
  }
  for (const guideline of options.promptGuidelines ?? []) add(guideline);
  add("Be concise in your responses");
  add("Show file paths clearly when working with files");

  return guidelines.map((guideline) => `- ${guideline}`).join("\n");
}

function renderedToolList(options: BuildSystemPromptOptions): string {
  const tools = options.selectedTools || ["read", "bash", "edit", "write"];
  const visible = tools.filter((name) => Boolean(options.toolSnippets?.[name]));
  if (visible.length === 0) return "(none)";
  return visible.map((name) => `- ${name}: ${options.toolSnippets?.[name]}`).join("\n");
}

function renderedContextFiles(options: BuildSystemPromptOptions): string {
  const files = options.contextFiles ?? [];
  if (files.length === 0) return "";
  let text = "\n\n<project_context>\n\n";
  text += "Project-specific instructions and guidelines:\n\n";
  for (const file of files) {
    text += `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`;
  }
  text += "</project_context>\n";
  return text;
}

function auditSystemPrompt(ctx: ExtensionCommandContext) {
  const options = ctx.getSystemPromptOptions();
  const prompt = ctx.getSystemPrompt();
  const hasRead = !options.selectedTools || options.selectedTools.includes("read");
  const appendSection = options.appendSystemPrompt ? `\n\n${options.appendSystemPrompt}` : "";
  const contextFilesSection = renderedContextFiles(options);
  const skillsSection = hasRead && options.skills?.length ? formatSkillsForPrompt(options.skills) : "";
  const cwdDateSection = `\nCurrent date: ${currentDate()}\nCurrent working directory: ${options.cwd.replace(/\\/g, "/")}`;
  const toolList = options.customPrompt ? "" : renderedToolList(options);
  const guidelines = options.customPrompt ? "" : renderedGuidelines(options);

  const knownSections = [
    metric(options.customPrompt ?? ""),
    metric(appendSection),
    metric(contextFilesSection),
    metric(skillsSection),
    metric(cwdDateSection),
    metric(toolList),
    metric(guidelines),
  ];
  const known = sum(knownSections);
  const total = metric(prompt);
  const residualChars = Math.max(0, total.chars - known.chars);

  return {
    total,
    optionsJson: measureJson(options),
    selectedTools: options.selectedTools ?? [],
    cwd: options.cwd,
    date: currentDate(),
    sections: {
      basePromptResidual: metric("x".repeat(residualChars)),
      customPrompt: metric(options.customPrompt ?? ""),
      appendSystemPrompt: metric(appendSection),
      toolSnippetsRendered: metric(toolList),
      promptGuidelinesRendered: metric(guidelines),
      contextFilesRendered: metric(contextFilesSection),
      skillsRendered: metric(skillsSection),
      cwdDateRendered: metric(cwdDateSection),
    },
    contextFiles: (options.contextFiles ?? []).map((file) => ({
      path: file.path,
      content: metric(file.content),
      rendered: metric(`<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>\n\n`),
    })),
    skills: (options.skills ?? []).map((skill) => ({
      name: skill.name,
      description: metric(skill.description ?? ""),
      filePath: skill.filePath,
      sourceInfo: skill.sourceInfo,
      disableModelInvocation: skill.disableModelInvocation,
    })),
    toolSnippets: Object.entries(options.toolSnippets ?? {}).map(([name, snippet]) => ({
      name,
      snippet: metric(snippet),
      rendered: metric(`- ${name}: ${snippet}`),
      active: options.selectedTools?.includes(name) ?? false,
    })),
    promptGuidelines: (options.promptGuidelines ?? []).map((guideline) => ({
      text: guideline,
      size: metric(guideline),
    })),
  };
}

async function auditMcpCache() {
  const path = join(getAgentDir(), "mcp-cache.json");
  try {
    const text = await readFile(path, "utf8");
    const data = JSON.parse(text) as { servers?: Record<string, { tools?: unknown[] }> };
    const servers = Object.entries(data.servers ?? {});
    const tools = servers.flatMap(([server, value]) =>
      (Array.isArray(value?.tools) ? value.tools : []).map((tool: any) => ({
        server,
        name: String(tool?.name ?? "unknown"),
        description: metric(String(tool?.description ?? "")),
        inputSchemaJson: measureJson(tool?.inputSchema ?? {}),
        fullJson: measureJson(tool),
      })),
    );

    return {
      path,
      exists: true,
      file: metric(text),
      serverCount: servers.length,
      toolCount: tools.length,
      totals: {
        description: sum(tools.map((tool) => tool.description)),
        inputSchemaJson: sum(tools.map((tool) => tool.inputSchemaJson)),
        fullJson: sum(tools.map((tool) => tool.fullJson)),
      },
      servers: servers.map(([name, value]) => ({
        name,
        toolCount: Array.isArray(value?.tools) ? value.tools.length : 0,
      })),
      tools: tools.sort((a, b) => b.fullJson.chars - a.fullJson.chars),
    };
  } catch (error) {
    return {
      path,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function summarizeProviderPayload(payload: unknown): ProviderPayloadSummary {
  const raw = safeJson(payload);
  const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const tools = Array.isArray(object.tools) ? object.tools : undefined;
  const messages = Array.isArray(object.messages) ? object.messages : undefined;

  return {
    capturedAt: new Date().toISOString(),
    totalJson: metric(raw),
    topLevel: Object.keys(object)
      .map((key) => ({ key, size: measureJson(object[key]) }))
      .sort((a, b) => b.size.chars - a.size.chars),
    tools: tools ? { count: tools.length, json: measureJson(tools) } : undefined,
    messages: messages ? { count: messages.length, json: measureJson(messages) } : undefined,
    input: object.input !== undefined ? measureJson(object.input) : undefined,
    system: object.system !== undefined ? measureJson(object.system) : undefined,
    instructions: object.instructions !== undefined ? measureJson(object.instructions) : undefined,
    systemInstruction: object.system_instruction !== undefined ? measureJson(object.system_instruction) : undefined,
  };
}

export async function buildAudit(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
  const usage = ctx.getContextUsage();
  return {
    generatedAt: new Date().toISOString(),
    cwd: ctx.cwd,
    model: ctx.model
      ? {
          provider: ctx.model.provider,
          id: ctx.model.id,
          name: ctx.model.name,
          contextWindow: ctx.model.contextWindow,
        }
      : undefined,
    contextUsage: usage,
    tools: auditTools(pi),
    systemPrompt: auditSystemPrompt(ctx),
    mcpCache: await auditMcpCache(),
    lastProviderPayload,
  };
}

function renderMetricTable(rows: Array<[string, Metric]>): string {
  return [
    "| Item | Chars | Est. tokens |",
    "|---|---:|---:|",
    ...rows.map(([name, value]) => `| ${name} | ${value.chars.toLocaleString()} | ${value.tokens.toLocaleString()} |`),
  ].join("\n");
}

export function renderMarkdown(audit: Awaited<ReturnType<typeof buildAudit>>): string {
  const topTools = audit.tools.items.slice(0, 20);
  const mcp = audit.mcpCache as any;
  const payload = audit.lastProviderPayload;

  return `# Pi Context Audit

Generated: ${audit.generatedAt}<br>
CWD: \`${audit.cwd}\`<br>
Model: ${audit.model ? `\`${audit.model.provider}/${audit.model.id}\`` : "unknown"}

## Summary

${renderMetricTable([
  ["System prompt", audit.systemPrompt.total],
  ["Active tool LLM schemas", audit.tools.totals.activeLlmSchemaJson],
  ["All tool LLM schemas", audit.tools.totals.allLlmSchemaJson],
  ["Active tool parameter JSON", audit.tools.totals.activeParametersJson],
  ["MCP cache full JSON", mcp.exists ? mcp.totals.fullJson : metric("")],
  ["Last provider payload", payload?.totalJson ?? metric("")],
])}

Context usage: ${audit.contextUsage ? `${audit.contextUsage.tokens?.toLocaleString() ?? "unknown"} / ${audit.contextUsage.contextWindow.toLocaleString()} tokens (${audit.contextUsage.percent ?? "?"}%)` : "unavailable"}

## Tools

Active tools: **${audit.tools.activeCount}** / ${audit.tools.allCount}.<br>
Inactive tools: **${audit.tools.inactiveCount}**.

### By source

| Source | Tools | Active | LLM schema chars | Est. tokens | Params chars |
|---|---:|---:|---:|---:|---:|
${audit.tools.bySource
  .map(
    (row) =>
      `| ${row.source.replace(/\|/g, "\\|")} | ${row.count} | ${row.activeCount} | ${row.llmSchemaJson.chars.toLocaleString()} | ${row.llmSchemaJson.tokens.toLocaleString()} | ${row.parametersJson.chars.toLocaleString()} |`,
  )
  .join("\n")}

### Largest tools

| Tool | Active | Source | LLM schema | Params JSON | Description | Guidelines |
|---|---:|---|---:|---:|---:|---:|
${topTools
  .map((tool) => {
    const source = (tool.sourceInfo as any)?.source ?? "unknown";
    return `| ${tool.name} | ${tool.active ? "yes" : "no"} | ${String(source).replace(/\|/g, "\\|")} | ${tool.llmSchemaJson.chars.toLocaleString()} | ${tool.parametersJson.chars.toLocaleString()} | ${tool.description.chars.toLocaleString()} | ${tool.promptGuidelines.chars.toLocaleString()} |`;
  })
  .join("\n")}

## System prompt

${renderMetricTable([
  ["Base/static residual + wrappers", audit.systemPrompt.sections.basePromptResidual],
  ["Custom prompt", audit.systemPrompt.sections.customPrompt],
  ["Append system prompt", audit.systemPrompt.sections.appendSystemPrompt],
  ["Rendered tool snippets", audit.systemPrompt.sections.toolSnippetsRendered],
  ["Rendered prompt guidelines", audit.systemPrompt.sections.promptGuidelinesRendered],
  ["Rendered context files", audit.systemPrompt.sections.contextFilesRendered],
  ["Rendered skills block", audit.systemPrompt.sections.skillsRendered],
  ["Rendered cwd/date", audit.systemPrompt.sections.cwdDateRendered],
])}

### Context files

| Path | Content chars | Est. tokens |
|---|---:|---:|
${audit.systemPrompt.contextFiles
  .map((file) => `| \`${file.path}\` | ${file.content.chars.toLocaleString()} | ${file.content.tokens.toLocaleString()} |`)
  .join("\n") || "| _(none)_ | 0 | 0 |"}

### Skills

| Skill | Description chars | Path |
|---|---:|---|
${audit.systemPrompt.skills
  .map((skill) => `| ${skill.name} | ${skill.description.chars.toLocaleString()} | \`${skill.filePath}\` |`)
  .join("\n") || "| _(none)_ | 0 | |"}

## MCP cache

${mcp.exists ? `Path: \`${mcp.path}\`<br>
Servers: **${mcp.serverCount}**<br>
Tools: **${mcp.toolCount}**<br>
Input schemas: ${metricText(mcp.totals.inputSchemaJson)}<br>
Full MCP tool JSON: ${metricText(mcp.totals.fullJson)}

| MCP tool | Server | Full JSON chars | Input schema chars | Description chars |
|---|---|---:|---:|---:|
${mcp.tools
  .slice(0, 20)
  .map(
    (tool: any) =>
      `| ${tool.name} | ${tool.server} | ${tool.fullJson.chars.toLocaleString()} | ${tool.inputSchemaJson.chars.toLocaleString()} | ${tool.description.chars.toLocaleString()} |`,
  )
  .join("\n")}` : `No MCP cache found at \`${mcp.path}\` (${mcp.error}).`}

## Last provider payload

${payload ? `${renderMetricTable([
  ["Full provider payload JSON", payload.totalJson],
  ["Provider tools", payload.tools?.json ?? metric("")],
  ["Provider messages", payload.messages?.json ?? metric("")],
  ["Provider input", payload.input ?? metric("")],
  ["Provider system", payload.system ?? metric("")],
  ["Provider instructions", payload.instructions ?? metric("")],
  ["Provider system_instruction", payload.systemInstruction ?? metric("")],
])}

| Payload key | Chars | Est. tokens |
|---|---:|---:|
${payload.topLevel.map((row) => `| ${row.key} | ${row.size.chars.toLocaleString()} | ${row.size.tokens.toLocaleString()} |`).join("\n")}` : "No provider payload captured yet. Run one model turn after loading this extension, then rerun `/context-audit`."}
`;
}

export default function contextAuditExtension(pi: ExtensionAPI) {
  pi.on("before_provider_request", (event) => {
    lastProviderPayload = summarizeProviderPayload(event.payload);
  });

  pi.registerCommand("context-audit", {
    description: "Audit current pi system prompt, tool schema, context usage, and MCP overhead",
    handler: async (args, ctx) => {
      const parsed = parseArgs(args);
      if (parsed.help) {
        ctx.ui.notify("Usage: /context-audit [md|json] [open] [copy]", "info");
        return;
      }

      const audit = await buildAudit(pi, ctx);
      await mkdir(CACHE_DIR, { recursive: true });
      const ext = parsed.format === "json" ? "json" : "md";
      const outputPath = join(CACHE_DIR, `${stamp()}.${ext}`);
      const content = parsed.format === "json" ? `${JSON.stringify(audit, null, 2)}\n` : renderMarkdown(audit);
      await writeFile(outputPath, content, "utf8");

      if (parsed.copy) {
        await pi.exec("sh", ["-lc", `pbcopy < ${shellQuote(outputPath)}`], { timeout: 5000 });
      }
      if (parsed.open) {
        await pi.exec("open", [outputPath], { timeout: 5000 });
      }

      const summary = `Context audit saved: ${outputPath} | system ~${audit.systemPrompt.total.tokens.toLocaleString()} tok, active tools ~${audit.tools.totals.activeLlmSchemaJson.tokens.toLocaleString()} tok`;
      ctx.ui.notify(parsed.copy ? `${summary} (copied)` : summary, "info");
      ctx.ui.setStatus("context-audit", `audit: ${audit.tools.activeCount}/${audit.tools.allCount} tools`);
    },
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus("context-audit", undefined);
  });
}
