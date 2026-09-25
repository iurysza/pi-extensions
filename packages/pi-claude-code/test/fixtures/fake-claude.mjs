#!/usr/bin/env node
// Imitates Claude Code 2.1.282 as observed against a loopback upstream. The contract lane runs the
// same scenarios against the real binary to keep this imitation honest.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const scenario = process.env.FAKE_CLAUDE_SCENARIO ? JSON.parse(readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8")) : {};
const record = (entry) => {
	if (process.env.FAKE_CLAUDE_RECORD) appendFileSync(process.env.FAKE_CLAUDE_RECORD, `${JSON.stringify(entry)}\n`);
};
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const exit = (code) => process.stdout.write("", () => process.exit(code));
const flag = (name) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_PICKER = [
	{ value: "default", resolvedModel: "claude-sonnet-5", displayName: "Default (recommended)", description: "Sonnet 5 · Efficient for routine tasks", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true },
	{ value: "sonnet", resolvedModel: "claude-sonnet-5", displayName: "Sonnet", description: "Sonnet 5 · Efficient for routine tasks", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true },
	{ value: "sonnet[1m]", resolvedModel: "claude-sonnet-5[1m]", displayName: "Sonnet 5 (1M context)", description: "Sonnet 5 for long sessions", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true },
	{ value: "opus[1m]", resolvedModel: "claude-opus-5-5[1m]", displayName: "Opus (1M context)", description: "Opus 5.5 with 1M context · Draws from usage credits · $4/$20 per Mtok", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"], supportsAdaptiveThinking: true },
	{ value: "haiku", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku", description: "Haiku 4.5 · Fastest for quick answers" },
];

if (args[0] === "--version") {
	console.log("2.1.282 (Claude Code)");
	process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
	console.log(JSON.stringify({ loggedIn: !scenario.loggedOut, authMethod: scenario.loggedOut ? "none" : "claude.ai", apiProvider: "firstParty" }, null, 2));
	process.exit(scenario.loggedOut ? 1 : 0);
}

const base = process.env.ANTHROPIC_BASE_URL;
record({
	kind: "start",
	args,
	cwd: process.cwd(),
	env: Object.fromEntries(
		["ANTHROPIC_BASE_URL", "CLAUDE_CODE_MAX_RETRIES", "CLAUDE_CODE_TOTAL_TOKENS_REMINDER", "ENABLE_TOOL_SEARCH", "DISABLE_COMPACT"].map((name) => [name, process.env[name]]),
	),
});
await fetch(`${base}/api/hello`, { method: "HEAD" }).catch(() => undefined);
if (scenario.banner) process.stdout.write(`${scenario.banner}\n`);
if (scenario.hang) {
	const grandchild = spawn(process.execPath, ["-e", "setTimeout(() => {}, 1e9)"], { stdio: "ignore" });
	record({ kind: "grandchild", pid: grandchild.pid });
	setInterval(() => {}, 1e9);
}

const route = flag("--model") ?? "claude-sonnet-5";
const upstreamModel = route.replace(/\[1m\]$/, "");
const settingsPath = flag("--settings");
const extra = settingsPath ? JSON.parse(JSON.parse(readFileSync(settingsPath, "utf8")).env.CLAUDE_CODE_EXTRA_BODY) : {};
const systemPromptPath = flag("--system-prompt-file");
const systemPrompt = systemPromptPath ? readFileSync(systemPromptPath, "utf8") : "";
out({ type: "system", subtype: "init", cwd: process.cwd(), tools: [], mcp_servers: [], model: route, claude_code_version: "2.1.282" });

const history = [];
function commit(role, content) {
	const last = history.at(-1);
	if (role === "user" && last?.role === "user") {
		const previous = last.content.at(-1);
		if (previous?.type === "text") previous.text += "\n";
		last.content.push(...structuredClone(content));
	} else {
		history.push({ role, content: structuredClone(content) });
	}
}

function requestBody() {
	const [first, ...rest] = history;
	const messages = [
		first,
		{ role: "system", content: `<system-reminder>\n# Environment\n - Primary working directory: ${process.cwd()}\n - Model: ${route}\n</system-reminder>` },
		...rest,
		{ role: "system", content: [{ type: "text", text: "<system-reminder>\nToday's date is 2026-09-25.\n</system-reminder>", cache_control: { type: "ephemeral", ttl: "1h" } }] },
	].filter(Boolean);
	return {
		model: upstreamModel,
		messages,
		system: [
			{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.282; cc_entrypoint=sdk-cli;" },
			{ type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.", cache_control: { type: "ephemeral", ttl: "1h" } },
			{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral", ttl: "1h" } },
		],
		tools: extra.tools ?? [],
		max_tokens: extra.max_tokens ?? 64000,
		thinking: extra.thinking ?? { type: "adaptive" },
		...(extra.context_management ? { context_management: extra.context_management } : { context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] } }),
		output_config: extra.output_config ?? { effort: "high" },
		stream: true,
	};
}

async function post(body) {
	return fetch(`${base}/v1/messages?beta=true`, {
		method: "POST",
		headers: { authorization: "Bearer sk-ant-oat01-fake", "content-type": "application/json", "user-agent": "claude-cli/2.1.282 (external, sdk-cli)" },
		body: JSON.stringify(body),
	});
}

async function readMessage(response) {
	const text = await response.text();
	const blocks = [];
	let stopReason;
	for (const raw of text.split("\n\n")) {
		const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
		if (!data) continue;
		const event = JSON.parse(data);
		if (event.type === "content_block_start") blocks[event.index] = { ...event.content_block, partial: "" };
		if (event.type === "content_block_delta") {
			const block = blocks[event.index];
			if (event.delta.type === "text_delta") block.text += event.delta.text;
			if (event.delta.type === "input_json_delta") block.partial += event.delta.partial_json;
		}
		if (event.type === "message_delta") stopReason = event.delta.stop_reason;
	}
	const content = blocks.filter(Boolean).map(({ partial, ...block }) => (block.type === "tool_use" && partial ? { ...block, input: JSON.parse(partial) } : block));
	return { content, stopReason };
}

async function query(frame) {
	commit("user", frame.message.content);
	if (scenario.loggedOut) {
		out({ type: "assistant", error: "authentication_failed", message: { role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }] } });
		out({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: "Not logged in · Please run /login" });
		return exit(1);
	}
	if (scenario.hang) return;
	const response = await post(requestBody());
	if (!response.ok) {
		const text = await response.text();
		out({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: `API Error: ${response.status} ${text}` }] } });
		out({ type: "result", subtype: "success", is_error: true, num_turns: 1, result: `API Error: ${response.status} ${text}` });
		return exit(1);
	}
	const message = await readMessage(response);
	out({ type: "assistant", message: { role: "assistant", content: message.content } });
	if (scenario.secondRequest) {
		const second = await post(requestBody());
		record({ kind: "second-request", status: second.status });
		await second.text();
	}
	if (message.stopReason === "tool_use") {
		for (const block of message.content.filter((candidate) => candidate.type === "tool_use")) {
			out({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: block.id, is_error: true, content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>` }] } });
		}
		out({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 2, stop_reason: "tool_use", errors: ["Reached maximum number of turns (1)"] });
		return exit(1);
	}
	const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
	out({ type: "result", subtype: "success", is_error: !!scenario.secondRequest, num_turns: 1, result: text });
	if (scenario.extraResult) out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: "" });
	return exit(0);
}

let chain = Promise.resolve();
let queried = false;
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	if (!line.trim()) return;
	const frame = JSON.parse(line);
	record({ kind: "frame", frame });
	if (frame.type === "control_request" && frame.request?.subtype === "initialize") {
		chain = chain.then(async () => {
			if (scenario.handshakeRequest) {
				const response = await post({ model: "claude-sonnet-5", messages: [] });
				record({ kind: "handshake-request", status: response.status });
				await response.text();
			}
			out({ type: "control_response", response: { subtype: "success", request_id: frame.request_id, response: { models: scenario.picker ?? DEFAULT_PICKER } } });
		});
		return;
	}
	if (frame.type === "assistant") {
		const keepThinking = frame.message.model?.replace(/\[1m\]$/, "") === upstreamModel;
		commit("assistant", frame.message.content.filter((block) => keepThinking || (block.type !== "thinking" && block.type !== "redacted_thinking")));
		return;
	}
	if (frame.type === "user" && frame.shouldQuery === false) {
		if (scenario.exitBeforeAck) return exit(1);
		chain = chain.then(async () => {
			await delay(scenario.ackDelayMs ?? 5);
			if (scenario.rejectReplay) {
				out({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, result: "replay rejected" });
				return;
			}
			commit("user", frame.message.content);
			out({ type: "result", subtype: "success", is_error: false, num_turns: 0, result: "" });
		});
		return;
	}
	if (frame.type === "user") {
		queried = true;
		chain = chain.then(() => query(frame));
	}
});
input.on("close", () => {
	chain = chain.then(() => {
		if (!queried && !scenario.hang) exit(0);
	});
});
