import { chmodSync, mkdtempSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	AssistantMessageEventStream,
	Model,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
} from "@earendil-works/pi-ai/compat";
import { catalogFromPicker, catalogModel, modelFromConfig, pinnedCatalog, toProviderModelConfig } from "../src/claude-code-model-catalog.js";
import { createTurnDirectory, type ClaudeCodeRuntime } from "../src/claude-code-runtime.js";

export const FAKE_CLAUDE = resolve(import.meta.dirname, "fixtures/fake-claude.mjs");
chmodSync(FAKE_CLAUDE, 0o755);

export interface FakeScenario {
	loggedOut?: boolean;
	banner?: string;
	rejectReplay?: boolean;
	ackDelayMs?: number;
	exitBeforeAck?: boolean;
	secondRequest?: boolean;
	hang?: boolean;
	extraResult?: boolean;
	handshakeRequest?: boolean;
	picker?: object[];
}

export interface TestRuntime extends ClaudeCodeRuntime {
	readonly root: string;
	readonly cwd: string;
	records(): any[];
}

export function testRuntime(options: {
	upstream?: URL;
	scenario?: FakeScenario;
	env?: Record<string, string | undefined>;
	command?: string;
	idleTimeoutMs?: number;
} = {}): TestRuntime {
	const root = mkdtempSync(join(tmpdir(), "pi-claude-code-test-"));
	const cwd = join(root, "cwd");
	mkdirSync(cwd);
	const scenarioPath = join(root, "scenario.json");
	const recordPath = join(root, "record.jsonl");
	writeFileSync(scenarioPath, JSON.stringify(options.scenario ?? {}));
	return {
		root,
		cwd,
		env: {
			PATH: process.env.PATH,
			HOME: root,
			FAKE_CLAUDE_SCENARIO: scenarioPath,
			FAKE_CLAUDE_RECORD: recordPath,
			...options.env,
		},
		command: options.command ?? FAKE_CLAUDE,
		upstream: options.upstream ?? new URL("http://127.0.0.1:9"),
		idleTimeoutMs: options.idleTimeoutMs ?? 10_000,
		processDirectory: async () => cwd,
		turnDirectory: createTurnDirectory,
		records: () =>
			existsSync(recordPath)
				? readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
				: [],
	};
}

export function testModel(id = "claude-sonnet-5"): Model<Api> {
	const catalog = [...pinnedCatalog(), ...catalogFromPicker([{ value: "sonnet[1m]", resolvedModel: "claude-sonnet-5[1m]", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true }])];
	const entry = catalog.find((model) => model.id === id) ?? catalogModel(id);
	return modelFromConfig(toProviderModelConfig(entry));
}

export function user(text: string): UserMessage {
	return { role: "user", content: text, timestamp: 1 };
}

export function assistant(
	content: AssistantMessage["content"],
	options: { provider?: string; model?: string; stopReason?: AssistantMessage["stopReason"] } = {},
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "claude-code-cli",
		provider: options.provider ?? "claude-code",
		model: options.model ?? "claude-sonnet-5",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: options.stopReason ?? "stop",
		timestamp: 2,
	};
}

export function toolCall(id: string, name: string, args: Record<string, unknown> = {}): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

export function thinking(text: string, signature?: string, redacted = false): ThinkingContent {
	return { type: "thinking", thinking: text, ...(signature ? { thinkingSignature: signature } : {}), ...(redacted ? { redacted } : {}) };
}

export function toolResult(toolCallId: string, text: string, toolName = "read", isError = false): ToolResultMessage {
	return { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text }], isError, timestamp: 3 };
}

export const readTool = {
	name: "read",
	description: "Read a file",
	parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
} as any;

export async function collect(stream: AssistantMessageEventStream): Promise<{ events: AssistantMessageEvent[]; message: AssistantMessage }> {
	const events: AssistantMessageEvent[] = [];
	for await (const event of stream) events.push(event);
	return { events, message: await stream.result() };
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
