import assert from "node:assert/strict";
import test from "node:test";

import { registerSecretEnv } from "../src/index.ts";

test("blocks protected calls and redacts final results", async () => {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      handlers.set(name, handler);
    },
  };
  const key = `PI_SECRET_ENV_TEST_${process.pid}`;
  const value = "inline-fake-secret-value";
  const ctx = { hasUI: false };

  try {
    registerSecretEnv(pi, { [key]: value });

    const toolCall = handlers.get("tool_call");
    const toolResult = handlers.get("tool_result");
    assert.equal(typeof toolCall, "function");
    assert.equal(typeof toolResult, "function");
    assert.equal(process.env[key], value);

    const pathBlock = await toolCall(
      { toolName: "read", input: { path: "~/.config/ai/secrets.env" } },
      ctx,
    );
    assert.equal(pathBlock?.block, true);
    assert.equal(JSON.stringify(pathBlock).includes("secrets.env"), false);

    const envBlock = await toolCall(
      { toolName: "bash", input: { command: "printenv" } },
      ctx,
    );
    assert.equal(envBlock?.block, true);

    const safeCall = await toolCall(
      { toolName: "bash", input: { command: "printf safe" } },
      ctx,
    );
    assert.equal(safeCall, undefined);

    const redacted = await toolResult({
      content: [{ type: "text", text: `${value}\n${key}=${value}` }],
    });
    const text = redacted.content[0].text;
    assert.equal(text.includes(value), false);
    assert.equal(text.includes(`${key}=`), true);
    assert.match(text, /\[REDACTED\]/);
  } finally {
    delete process.env[key];
  }
});
