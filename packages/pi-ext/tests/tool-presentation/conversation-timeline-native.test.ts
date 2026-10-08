import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nextTick } from "node:timers/promises";
import test from "node:test";
import {
  createAgentSessionFromServices, createAgentSessionServices, ModelRuntime, SessionManager, SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { createToolPresentation } from "../../extensions/tool-presentation/index.js";
import { CONVERSATION_TIMELINE_ENTRY } from "../../extensions/tool-presentation/conversation-timeline.js";

const model: Model<"openai-completions"> = {
  id: "timeline-fixture", name: "Timeline fixture", provider: "timeline-fixture", api: "openai-completions",
  baseUrl: "http://fixture.invalid", reasoning: false, input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 100_000, maxTokens: 1_000,
};
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

test("real Pi lifecycle persists ordered clock markers and one final total without feeding them to the model", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-conversation-timeline-"));
  let session: AgentSession | undefined;
  const initial = new Date(2026, 8, 24, 14, 32).getTime();
  let now = initial;
  let calls = 0;
  const contexts: string[] = [];
  const errors: unknown[] = [];
  const publicEvents: string[] = [];
  try {
    await writeFile(join(root, "input.txt"), "fixture\n");
    const modelRuntime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(), modelsPath: null,
      modelsStorePath: join(root, "models-store.json"), allowModelNetwork: false,
    });
    const services = await createAgentSessionServices({
      cwd: root, agentDir: join(root, "agent"), modelRuntime,
      settingsManager: SettingsManager.inMemory({ packages: [], compaction: { enabled: false }, retry: { enabled: false } }),
      resourceLoaderOptions: {
        noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
        systemPrompt: "Offline timeline test.",
        extensionFactories: [
          createToolPresentation({
            cwd: root, loadState: () => ({ enabled: true, source: "default" }), loadMode: () => "default", loadIcons: () => true,
            createIntegration: () => ({
              async initialize() { return { skipTidyTools: new Set(), commit() {} } as any; },
              async run() { throw new Error("not used"); },
            }),
          }),
          (pi) => pi.registerProvider(model.provider, {
            baseUrl: model.baseUrl, api: model.api, apiKey: "fixture-not-a-secret", models: [model],
            streamSimple(_model, context) {
              contexts.push(JSON.stringify(context.messages));
              const invocation = calls++;
              const stream = createAssistantMessageEventStream();
              const partial: AssistantMessage = {
                role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
                usage, stopReason: invocation === 0 ? "toolUse" : "stop", timestamp: now,
              };
              void (async () => {
                stream.push({ type: "start", partial });
                await nextTick();
                now += 600_000;
                if (invocation === 0) {
                  partial.content.push({ type: "toolCall", id: "fixture-read", name: "read", arguments: { path: join(root, "input.txt"), reasoning: "inspect fixture" } });
                  stream.push({ type: "toolcall_start", contentIndex: 0, partial });
                } else {
                  partial.content.push({ type: "text", text: "Fixture checked." });
                  stream.push({ type: "text_start", contentIndex: 0, partial });
                  stream.push({ type: "text_delta", contentIndex: 0, delta: "Fixture checked.", partial });
                }
                await nextTick();
                stream.push({ type: "done", reason: invocation === 0 ? "toolUse" : "stop", message: partial });
                stream.end();
              })().catch((error) => {
                stream.push({ type: "error", reason: "error", error: { ...partial, stopReason: "error", errorMessage: String(error) } });
                stream.end();
              });
              return stream;
            },
          }),
        ],
      },
    });
    const manager = SessionManager.inMemory(root);
    ({ session } = await createAgentSessionFromServices({ services, sessionManager: manager, model, tools: ["read"] }));
    await session.bindExtensions({ mode: "json", onError: (error) => errors.push(error) });
    t.mock.method(Date, "now", () => now);
    session.subscribe((event: any) => {
      if (event.type === "entry_appended" && event.entry.customType === CONVERSATION_TIMELINE_ENTRY) publicEvents.push(event.entry.data.kind);
      if (event.type === "message_start" || event.type === "message_update") publicEvents.push(`${event.type}:${event.message.role}`);
    });
    await session.prompt("Check input.txt");
    await session.waitForIdle();
    assert.deepEqual(errors, []);
    assert.equal(calls, 2);
    const entries = manager.getBranch();
    const meaningful = entries.filter((entry) => entry.type === "message" || entry.type === "custom");
    assert.deepEqual(meaningful.map((entry: any) => entry.type === "custom" ? entry.data.kind : entry.message.role), [
      "system", "minute", "user", "minute", "assistant", "toolResult", "minute", "assistant", "run-end",
    ]);
    const markers = entries.filter((entry: any) => entry.customType === CONVERSATION_TIMELINE_ENTRY).map((entry: any) => entry.data);
    assert.deepEqual(markers.slice(0, 3).map((entry) => entry.at), [initial, initial + 600_000, initial + 1_200_000]);
    assert.deepEqual(markers.at(-1), { kind: "run-end", startedAt: initial, at: initial + 1_200_000, elapsedMs: 1_200_000, outcome: "completed" });
    assert.ok(publicEvents.indexOf("minute") < publicEvents.indexOf("message_start:user"));
    assert.ok(publicEvents.indexOf("minute", 1) < publicEvents.indexOf("message_update:assistant"));
    for (const context of contexts) {
      assert.ok(JSON.parse(context).every((message: any) => ["system", "user", "assistant", "toolResult"].includes(message.role)));
      assert.doesNotMatch(context, /"customType":"pi-conversation-timeline"|"kind":"run-end"|Completed in|"kind":"minute"/);
    }
    const result = entries.find((entry: any) => entry.message?.role === "toolResult") as any;
    assert.equal(result.message.details.piTidyShowTimestamp, false);
    assert.equal(result.message.details.piTidyElapsedMs, 0);
  } finally {
    session?.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
