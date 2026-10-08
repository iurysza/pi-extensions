import {
	parseStreamingJson,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type StopReason,
	type ThinkingContent,
	type ToolCall,
	type Usage,
} from "@earendil-works/pi-ai/compat";
import { NATIVE_TOOL_PREFIX, type ToolInventory } from "./claude-code-request.js";
import type { NativeUsage, SseEvent } from "./claude-code-response-capture.js";
import type { TurnOutcome } from "./claude-code-turn-outcome.js";

export interface TurnSink {
	apply(event: SseEvent): void;
}

type OpenContent =
	| { kind: "text"; contentIndex: number }
	| { kind: "thinking"; contentIndex: number }
	| { kind: "tool"; contentIndex: number; partialJson: string };

export function emptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function projectUsage(native: NativeUsage): Usage {
	const usage = emptyUsage();
	usage.input = native.input_tokens ?? 0;
	usage.output = native.output_tokens ?? 0;
	usage.cacheRead = native.cache_read_input_tokens ?? 0;
	usage.cacheWrite = native.cache_creation_input_tokens ?? 0;
	const oneHour = native.cache_creation?.ephemeral_1h_input_tokens;
	if (oneHour !== undefined) usage.cacheWrite1h = oneHour;
	usage.totalTokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return usage;
}

export function piStopReason(stopReason: string | undefined): Extract<StopReason, "stop" | "length" | "toolUse"> {
	if (stopReason === "tool_use") return "toolUse";
	if (stopReason === "max_tokens" || stopReason === "model_context_window_exceeded") return "length";
	return "stop";
}

/** Streams the Captured Response into pi as it arrives; `finish` ends the stream exactly once. */
export class TurnEmitter implements TurnSink {
	private readonly open = new Map<number, OpenContent>();
	private readonly usage: NativeUsage = {};
	private started = false;
	private finished = false;

	constructor(
		private readonly stream: AssistantMessageEventStream,
		private readonly output: AssistantMessage,
		private readonly inventory: ToolInventory,
	) {}

	apply(event: SseEvent): void {
		if (this.finished) return;
		switch (event.type) {
			case "message_start":
				this.output.responseId = event.message?.id;
				this.output.responseModel = event.message?.model;
				this.mergeUsage(event.message?.usage);
				this.start();
				return;
			case "content_block_start":
				this.start();
				this.openBlock(event.index, event.content_block);
				return;
			case "content_block_delta":
				this.delta(event.index, event.delta as Record<string, unknown>);
				return;
			case "content_block_stop":
				this.closeBlock(event.index);
				return;
			case "message_delta":
				this.mergeUsage(event.usage);
				return;
			default:
				return;
		}
	}

	finish(outcome: TurnOutcome, failureText?: string): void {
		if (this.finished) return;
		this.finished = true;
		if (outcome.kind === "completed") {
			this.output.stopReason = outcome.stopReason;
			this.stream.push({ type: "done", reason: outcome.stopReason, message: this.output });
		} else {
			const reason = outcome.failure.type === "Aborted" ? "aborted" : "error";
			this.output.stopReason = reason;
			this.output.errorMessage = failureText ?? outcome.failure.type;
			this.stream.push({ type: "error", reason, error: this.output });
		}
		this.stream.end(this.output);
	}

	private start(): void {
		if (this.started) return;
		this.started = true;
		this.stream.push({ type: "start", partial: this.output });
	}

	private mergeUsage(update: NativeUsage | undefined): void {
		if (!update) return;
		for (const [key, value] of Object.entries(update)) {
			if (value !== null && value !== undefined) (this.usage as Record<string, unknown>)[key] = value;
		}
		this.output.usage = projectUsage(this.usage);
	}

	private hostToolName(name: string): string {
		return this.inventory.hostNames.get(name) ?? (name.startsWith(NATIVE_TOOL_PREFIX) ? name.slice(NATIVE_TOOL_PREFIX.length) : name);
	}

	private openBlock(index: number, block: { type: string; [key: string]: unknown }): void {
		const contentIndex = this.output.content.length;
		if (block.type === "text") {
			this.output.content.push({ type: "text", text: typeof block.text === "string" ? block.text : "" });
			this.open.set(index, { kind: "text", contentIndex });
			this.stream.push({ type: "text_start", contentIndex, partial: this.output });
		} else if (block.type === "thinking") {
			this.output.content.push({ type: "thinking", thinking: typeof block.thinking === "string" ? block.thinking : "", thinkingSignature: "" });
			this.open.set(index, { kind: "thinking", contentIndex });
			this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
		} else if (block.type === "redacted_thinking") {
			this.output.content.push({ type: "thinking", thinking: "", thinkingSignature: String(block.data ?? ""), redacted: true });
			this.open.set(index, { kind: "thinking", contentIndex });
			this.stream.push({ type: "thinking_start", contentIndex, partial: this.output });
		} else if (block.type === "tool_use") {
			this.output.content.push({
				type: "toolCall",
				id: String(block.id ?? ""),
				name: this.hostToolName(String(block.name ?? "")),
				arguments: {},
			});
			this.open.set(index, { kind: "tool", contentIndex, partialJson: "" });
			this.stream.push({ type: "toolcall_start", contentIndex, partial: this.output });
		}
	}

	private delta(index: number, delta: Record<string, unknown>): void {
		const open = this.open.get(index);
		if (!open) return;
		const content = this.output.content[open.contentIndex];
		if (!content) return;
		if (open.kind === "text" && content.type === "text" && delta.type === "text_delta") {
			const text = String(delta.text ?? "");
			content.text += text;
			this.stream.push({ type: "text_delta", contentIndex: open.contentIndex, delta: text, partial: this.output });
		} else if (open.kind === "thinking" && content.type === "thinking") {
			if (delta.type === "thinking_delta") {
				const thinking = String(delta.thinking ?? "");
				content.thinking += thinking;
				this.stream.push({ type: "thinking_delta", contentIndex: open.contentIndex, delta: thinking, partial: this.output });
			} else if (delta.type === "signature_delta") {
				content.thinkingSignature = `${content.thinkingSignature ?? ""}${String(delta.signature ?? "")}`;
			}
		} else if (open.kind === "tool" && content.type === "toolCall" && delta.type === "input_json_delta") {
			const partial = String(delta.partial_json ?? "");
			open.partialJson += partial;
			content.arguments = parseStreamingJson(open.partialJson);
			this.stream.push({ type: "toolcall_delta", contentIndex: open.contentIndex, delta: partial, partial: this.output });
		}
	}

	private closeBlock(index: number): void {
		const open = this.open.get(index);
		if (!open) return;
		this.open.delete(index);
		const content = this.output.content[open.contentIndex];
		if (!content) return;
		if (content.type === "text") {
			this.stream.push({ type: "text_end", contentIndex: open.contentIndex, content: content.text, partial: this.output });
		} else if (content.type === "thinking") {
			const thinking = content as ThinkingContent;
			this.stream.push({ type: "thinking_end", contentIndex: open.contentIndex, content: thinking.thinking, partial: this.output });
		} else if (content.type === "toolCall" && open.kind === "tool") {
			const toolCall = content as ToolCall;
			toolCall.arguments = open.partialJson ? parseStreamingJson(open.partialJson) : {};
			this.stream.push({ type: "toolcall_end", contentIndex: open.contentIndex, toolCall, partial: this.output });
		}
	}
}
