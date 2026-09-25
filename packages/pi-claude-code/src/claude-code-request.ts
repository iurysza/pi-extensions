import { createHash } from "node:crypto";
import type {
	Api,
	AssistantMessage,
	Context,
	ImageContent,
	Message,
	Model,
	SimpleStreamOptions,
	TextContent,
	Tool,
} from "@earendil-works/pi-ai/compat";
import {
	CLAUDE_CODE_PROVIDER_ID,
	turnModelSettings,
	upstreamModelId,
	type ClaudeEffort,
	type TurnModelSettings,
} from "./claude-code-model-catalog.js";

export const NATIVE_TOOL_PREFIX = "mcp__pi__";
const NATIVE_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const TOOL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const INCOMPLETE_TOOL_RESULT = "Tool call was not completed.";

export type NativeToolName = `${typeof NATIVE_TOOL_PREFIX}${string}`;
export type TextBlock = { type: "text"; text: string };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };

export type NativeBlock =
	| TextBlock
	| ImageBlock
	| { type: "thinking"; thinking: string; signature: string }
	| { type: "redacted_thinking"; data: string }
	| { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
	| { type: "tool_result"; tool_use_id: string; content: Array<TextBlock | ImageBlock>; is_error?: boolean };

export type UserFrame = { type: "user"; message: { role: "user"; content: NativeBlock[] } };
export type AssistantFrame = { type: "assistant"; message: { role: "assistant"; model: string; content: NativeBlock[] } };
export type InputFrame = UserFrame | AssistantFrame;

export interface InventoryTool {
	readonly name: NativeToolName;
	readonly description: string;
	readonly input_schema: Record<string, unknown>;
}

export interface ToolInventory {
	readonly tools: readonly InventoryTool[];
	/** Native Tool Name to Host Tool name. */
	readonly hostNames: ReadonlyMap<string, string>;
	readonly skipped: readonly string[];
}

export interface ExtraBody {
	tools: readonly InventoryTool[];
	thinking?: { type: "adaptive" } | { type: "disabled" };
	context_management?: { edits: [] };
	output_config?: { effort: ClaudeEffort };
	max_tokens?: number;
}

export interface TurnRequest {
	readonly route: string;
	readonly upstreamId: string;
	readonly systemPrompt: string;
	readonly replayed: readonly InputFrame[];
	readonly query: UserFrame;
	readonly inventory: ToolInventory;
	readonly extraBody: ExtraBody;
}

export type TurnRequestError = { type: "EndsWithAssistant" } | { type: "EmptyQueryFrame" };

export type BuildTurnRequestResult =
	| { ok: true; request: TurnRequest }
	| { ok: false; error: TurnRequestError; inventory: ToolInventory };

interface NativeMessage {
	role: "user" | "assistant";
	model?: string;
	content: NativeBlock[];
}

export function nativeToolName(hostName: string): NativeToolName {
	return `${NATIVE_TOOL_PREFIX}${hostName}`;
}

/** Historical calls to tools that are no longer valid still need an acceptable name. */
function replayToolName(hostName: string): string {
	const name = nativeToolName(hostName);
	return NATIVE_NAME_PATTERN.test(name) ? name : name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function nativeToolId(id: string): string {
	if (TOOL_ID_PATTERN.test(id)) return id;
	return `toolu_pi_${createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

function normalizeSchema(parameters: unknown): Record<string, unknown> {
	const schema: Record<string, unknown> =
		parameters && typeof parameters === "object" ? JSON.parse(JSON.stringify(parameters)) : {};
	delete schema.oneOf;
	delete schema.allOf;
	delete schema.anyOf;
	schema.type = "object";
	return schema;
}

export function toToolInventory(tools: readonly Tool[]): ToolInventory {
	const inventory: InventoryTool[] = [];
	const hostNames = new Map<string, string>();
	const skipped: string[] = [];
	for (const tool of tools) {
		const name = nativeToolName(tool.name);
		if (!NATIVE_NAME_PATTERN.test(name) || hostNames.has(name)) {
			skipped.push(tool.name);
			continue;
		}
		hostNames.set(name, tool.name);
		inventory.push({ name, description: tool.description, input_schema: normalizeSchema(tool.parameters) });
	}
	return { tools: inventory, hostNames, skipped };
}

function imageBlock(image: ImageContent): ImageBlock {
	return { type: "image", source: { type: "base64", media_type: image.mimeType, data: image.data } };
}

function userBlocks(content: string | (TextContent | ImageContent)[]): NativeBlock[] {
	const parts = typeof content === "string" ? [{ type: "text" as const, text: content }] : content;
	const blocks: NativeBlock[] = [];
	for (const part of parts) {
		if (part.type === "image") blocks.push(imageBlock(part));
		else if (part.text) blocks.push({ type: "text", text: part.text });
	}
	return blocks;
}

function assistantBlocks(message: AssistantMessage, sameRoute: boolean): NativeBlock[] {
	const blocks: NativeBlock[] = [];
	for (const part of message.content) {
		if (part.type === "text") {
			if (part.text) blocks.push({ type: "text", text: part.text });
		} else if (part.type === "thinking") {
			if (sameRoute && part.redacted && part.thinkingSignature) {
				blocks.push({ type: "redacted_thinking", data: part.thinkingSignature });
			} else if (sameRoute && part.thinkingSignature) {
				blocks.push({ type: "thinking", thinking: part.thinking, signature: part.thinkingSignature });
			} else if (!part.redacted && part.thinking) {
				blocks.push({ type: "text", text: part.thinking });
			}
		} else if (part.type === "toolCall") {
			blocks.push({ type: "tool_use", id: nativeToolId(part.id), name: replayToolName(part.name), input: part.arguments ?? {} });
		}
	}
	return blocks;
}

function toolResultBlock(toolCallId: string, content: (TextContent | ImageContent)[], isError: boolean): NativeBlock {
	const blocks: Array<TextBlock | ImageBlock> = [];
	for (const part of content) {
		if (part.type === "image") blocks.push(imageBlock(part));
		else if (part.text) blocks.push({ type: "text", text: part.text });
	}
	return { type: "tool_result", tool_use_id: nativeToolId(toolCallId), content: blocks, ...(isError ? { is_error: true } : {}) };
}

function replayable(message: Message): boolean {
	return !(message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted"));
}

/**
 * Rewrites pi history as native messages. Every tool_use gets exactly one tool_result in the next
 * user message; results whose call was dropped are dropped too, because Anthropic rejects both.
 */
function nativeMessages(messages: readonly Message[], currentUpstreamId: string): NativeMessage[] {
	const out: NativeMessage[] = [];
	let pending: string[] = [];
	let results: NativeBlock[] = [];

	const flushResults = () => {
		const missing = pending.map((id): NativeBlock => ({
			type: "tool_result",
			tool_use_id: id,
			content: [{ type: "text", text: INCOMPLETE_TOOL_RESULT }],
			is_error: true,
		}));
		if (results.length || missing.length) out.push({ role: "user", content: [...results, ...missing] });
		pending = [];
		results = [];
	};

	for (const message of messages) {
		if (!replayable(message)) continue;
		if (message.role === "toolResult") {
			const id = nativeToolId(message.toolCallId);
			if (!pending.includes(id)) continue;
			pending = pending.filter((candidate) => candidate !== id);
			results.push(toolResultBlock(message.toolCallId, message.content, message.isError));
			continue;
		}
		flushResults();
		if (message.role === "user") {
			out.push({ role: "user", content: userBlocks(message.content) });
			continue;
		}
		const sameRoute = message.provider === CLAUDE_CODE_PROVIDER_ID;
		const content = assistantBlocks(message, sameRoute);
		if (!content.length) continue;
		out.push({ role: "assistant", model: sameRoute ? upstreamModelId(message.model) : currentUpstreamId, content });
		pending = content.flatMap((block) => (block.type === "tool_use" ? [block.id] : []));
	}
	if (pending.length || results.length) flushResults();
	return out;
}

function mergeSameRole(messages: readonly NativeMessage[]): NativeMessage[] {
	const merged: NativeMessage[] = [];
	for (const message of messages) {
		const previous = merged.at(-1);
		if (previous && previous.role === message.role) {
			previous.content = [...previous.content, ...message.content];
		} else {
			merged.push({ ...message, content: [...message.content] });
		}
	}
	return merged.filter((message) => message.content.length > 0 || message === merged.at(-1));
}

function extraBody(settings: TurnModelSettings, inventory: ToolInventory): ExtraBody {
	return {
		tools: inventory.tools,
		...(settings.thinking ? { thinking: settings.thinking } : {}),
		...(settings.thinking?.type === "disabled" ? { context_management: { edits: [] as [] } } : {}),
		...(settings.effort ? { output_config: { effort: settings.effort } } : {}),
		...(settings.maxTokens ? { max_tokens: settings.maxTokens } : {}),
	};
}

function systemPrompt(base: string | undefined, inventory: ToolInventory): string {
	const prompt = base ?? "";
	if (!inventory.tools.length) return prompt;
	const note = `Tools are exposed to you with the prefix \`${NATIVE_TOOL_PREFIX}\`: the tool \`read\` is called \`${NATIVE_TOOL_PREFIX}read\`. Instructions that mention a tool by its plain name refer to the prefixed tool.`;
	return prompt ? `${prompt}\n\n${note}` : note;
}

function frame(message: NativeMessage, upstreamId: string): InputFrame {
	return message.role === "user"
		? { type: "user", message: { role: "user", content: message.content } }
		: { type: "assistant", message: { role: "assistant", model: message.model ?? upstreamId, content: message.content } };
}

export function buildTurnRequest(model: Model<Api>, context: Context, options?: SimpleStreamOptions): BuildTurnRequestResult {
	const settings = turnModelSettings(model, options?.reasoning, options?.maxTokens);
	const inventory = toToolInventory(context.tools ?? []);
	const messages = mergeSameRole(nativeMessages(context.messages, settings.upstreamId));
	const last = messages.at(-1);
	if (!last || last.role !== "user") {
		return { ok: false, error: last ? { type: "EndsWithAssistant" } : { type: "EmptyQueryFrame" }, inventory };
	}
	if (!last.content.length) return { ok: false, error: { type: "EmptyQueryFrame" }, inventory };
	return {
		ok: true,
		request: {
			route: settings.route,
			upstreamId: settings.upstreamId,
			systemPrompt: systemPrompt(context.systemPrompt, inventory),
			replayed: messages.slice(0, -1).map((message) => frame(message, settings.upstreamId)),
			query: { type: "user", message: { role: "user", content: last.content } },
			inventory,
			extraBody: extraBody(settings, inventory),
		},
	};
}
