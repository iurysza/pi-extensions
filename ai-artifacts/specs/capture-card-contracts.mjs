// Model-free constructor fixtures for tools absent from session history.
// No real cmux connection, MCP server, memory CLI, or plan is touched.
import fs from "node:fs";
import { wireTools } from "../../packages/pi-ext/extensions/cmux/tools.ts";
const host = process.argv[2];
if (!host) throw new Error("Pass the tested Pi 1.0.0 package root");
const { createMcpResourceToolDefinitions } = await import(`${host}/dist/extensions/mcp/resources.js`);
const fixtures = [];
const registered = [];
wireTools({ events: {}, on() {}, registerTool: (tool) => registered.push(tool) }, { request: async () => "Example response", parallel: async () => [], circuitBreakerOpen: false });
for (const tool of registered) {
  const args = tool.name === "cmux_browser" ? { action: "back" } : tool.name === "cmux_workspace" ? { action: "list" } : { title: "Example" };
  fixtures.push({ name: tool.name, state: "success", source: { constructor: "cmux/tools.ts:wireTools", transport: "local stub, not a live socket" }, args, result: await tool.execute("fixture", args) });
}
const server = { name: "example", allResources: async () => [], allResourceTemplates: async () => [], readResource: async (uri) => ({ contents: [{ uri, text: "Example resource" }] }) };
for (const tool of createMcpResourceToolDefinitions({ servers: () => [server], exposure: "direct" })) {
  const args = tool.name === "read_mcp_resource" ? { server: "example", uri: "example://resource" } : {};
  const result = await tool.execute("fixture", args);
  fixtures.push({ name: tool.name, state: "success", source: { constructor: `Pi 1.0.0 resources.js:createMcpResourceToolDefinitions`, transport: "local stub, not a live MCP server" }, args, result: { content: result.content, details: result.details } });
}
fixtures.push({ name: "plannotator_mark_done", state: "error", source: { returnContract: "@plannotator/pi-extension 0.27.25 index.ts:1202-1206, no approved plan branch; copied, not executed" }, args: { step: 1 }, result: { content: [{ type: "text", text: "Error: No approved plan is executing." }], details: { completed: false } } });
fs.writeFileSync(new URL("../../packages/pi-ext/tests/tool-presentation/card-contract-fixtures.json", import.meta.url), JSON.stringify(fixtures, null, 2) + "\n");
console.log(`Saved ${fixtures.length} source-contract fixtures`);
