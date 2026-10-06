import { CYAN, YELLOW } from "../../tidy/render.js";
import { count, detailsError, firstLine, joinFacts, rawExpanded, resultText, shortUrl, type CardArgs, type CardResult, type CardSpec } from "../spec.js";
function parsed(r: CardResult): any { try { return JSON.parse(resultText(r)); } catch { return undefined; } }
export function mcpSummary(r: CardResult): string {
  const text = resultText(r).trim();
  if (r.details?.fullOutputPath) return `${text ? text.split("\n").length : 0} lines · saved`;
  const value = parsed(r);
  if (Array.isArray(value)) return `${value.length} items`;
  if (value && typeof value === "object") {
    const arrays = Object.entries(value).filter(([, v]) => Array.isArray(v));
    if (arrays.length === 1) return `${(arrays[0][1] as any[]).length} ${arrays[0][0]}`;
    if (typeof value.title === "string" || typeof value.name === "string") return `"${value.title ?? value.name}"`;
    return `${Object.keys(value).length} fields`;
  }
  if (text) return text.includes("\n") ? `${text.split("\n").length} lines` : firstLine(r);
  return `${r.content?.filter((c) => c.type === "image").length ?? 0} images`;
}
function identity(a: CardArgs): string {
  for (const k of ["query", "id", "page_id", "url", "uri", "name", "title", "scriptName", "sql"]) if (typeof a[k] === "string" && a[k]) return k === "query" ? `"${a[k]}"` : shortUrl(a[k]);
  return Object.values(a).find((v) => typeof v === "string" && v.length < 120) ?? "";
}
export function mcpSpec(tool: { name: string; label?: string; title?: string; annotations?: { readOnlyHint?: boolean } }): CardSpec {
  const match = tool.name.match(/^mcp__(.+?)__(.+)$/);
  const server = match?.[1] ?? "mcp";
  const name = match?.[2] ?? tool.name;
  const label = server.replace(/^cloudflare/, "cf").replaceAll("_", " ");
  return {
    icon: server === "notion" ? "\ue848" : server.startsWith("cloudflare") ? "\ue792" : "󰚥", color: tool.annotations?.readOnlyHint ? CYAN : YELLOW,
    label: label.slice(0, 8), headline: () => tool.title ?? tool.label ?? name.replace(new RegExp(`^${server}_`), "").replaceAll("_", " "),
    target: (a) => joinFacts(label, identity(a)), summary: mcpSummary, failed: (r) => !!r.isError || detailsError(r),
    expanded: (r, a) => [...Object.entries(a).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`), "", ...rawExpanded(r)],
  };
}
export const resourceSpecs: Record<string, CardSpec> = Object.fromEntries([
  ["list_mcp_resources", "󰉹", "list MCP resources", "resources"],
  ["list_mcp_resource_templates", "󰠲", "list MCP resource templates", "resourceTemplates"],
  ["read_mcp_resource", "󰷊", "read MCP resource", "contents"],
].map(([name, icon, headline, key]) => [name, {
  icon, color: CYAN, label: "resource", headline: () => headline,
  target: (a: CardArgs) => joinFacts(a.server ?? "all servers", a.uri, a.cursor ? "page 2" : ""), failed: detailsError,
  summary: (r: CardResult) => {
    const value = parsed(r);
    if (name === "read_mcp_resource") return r.content?.some((c) => c.type === "image") ? "image" : `${resultText(r).length} chars`;
    return joinFacts(count(value?.[key]?.length, key === "resourceTemplates" ? "templates" : "resources"), value?.errors?.length ? `${value.errors.length} server failed` : "");
  }, expanded: (r: CardResult) => {
    const value = parsed(r);
    return name !== "read_mcp_resource" && Array.isArray(value?.[key]) ? value[key].map((v: any) => `${v.name} · ${v.uri ?? v.uriTemplate}`) : rawExpanded(r);
  },
}]));
