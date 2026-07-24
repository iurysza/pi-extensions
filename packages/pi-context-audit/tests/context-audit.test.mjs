import assert from "node:assert/strict";
import test from "node:test";

import contextAuditExtension, { buildAudit, renderMarkdown } from "../src/index.ts";

function mockPi() {
  const commands = new Map();
  const events = new Map();
  return {
    commands,
    events,
    getActiveTools: () => ["read"],
    getAllTools: () => [
      {
        name: "read",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        promptGuidelines: [],
        sourceInfo: { source: "core" },
      },
    ],
    on(name, handler) {
      events.set(name, handler);
    },
    registerCommand(name, command) {
      commands.set(name, command);
    },
  };
}

test("registers the context-audit command", () => {
  const pi = mockPi();
  contextAuditExtension(pi);

  assert.equal(pi.commands.get("context-audit")?.description.length > 0, true);
  assert.equal(typeof pi.events.get("before_provider_request"), "function");
  assert.equal(typeof pi.events.get("session_shutdown"), "function");
});

test("builds a Markdown audit from isolated runtime data", async () => {
  const pi = mockPi();
  const ctx = {
    cwd: "/tmp/project",
    model: {
      provider: "test",
      id: "test-model",
      name: "Test Model",
      contextWindow: 1000,
    },
    getContextUsage: () => ({ tokens: 100, contextWindow: 1000, percent: 10 }),
    getSystemPrompt: () => "Test system prompt",
    getSystemPromptOptions: () => ({
      cwd: "/tmp/project",
      selectedTools: ["read"],
      toolSnippets: { read: "Read a file" },
      promptGuidelines: [],
      contextFiles: [],
      skills: [],
    }),
  };

  const audit = await buildAudit(pi, ctx);
  const markdown = renderMarkdown(audit);

  assert.equal(audit.tools.activeCount, 1);
  assert.match(markdown, /^# Pi Context Audit/m);
  assert.match(markdown, /Active tools: \*\*1\*\* \/ 1/);
  assert.match(markdown, /test\/test-model/);
});
