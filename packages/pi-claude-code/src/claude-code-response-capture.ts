import type { NativeBlock } from "./claude-code-request.js";

export interface NativeUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
	cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
}

export type BlockDelta =
	| { type: "text_delta"; text: string }
	| { type: "thinking_delta"; thinking: string }
	| { type: "signature_delta"; signature: string }
	| { type: "input_json_delta"; partial_json: string }
	| { type: string; [key: string]: unknown };

export type SseEvent =
	| { type: "message_start"; message: { id?: string; model?: string; usage?: NativeUsage } }
	| { type: "content_block_start"; index: number; content_block: { type: string; [key: string]: unknown } }
	| { type: "content_block_delta"; index: number; delta: BlockDelta }
	| { type: "content_block_stop"; index: number }
	| { type: "message_delta"; delta: { stop_reason?: string | null }; usage?: NativeUsage }
	| { type: "message_stop" }
	| { type: "ping" }
	| { type: "error"; error: { type?: string; message?: string } };

export interface CapturedResponse {
	id?: string;
	model?: string;
	content: NativeBlock[];
	stopReason?: string;
	usage: NativeUsage;
	complete: boolean;
	streamError?: string;
}

interface OpenBlock {
	block: { type: string; [key: string]: unknown };
	partialJson: string;
}

const KNOWN_EVENTS = new Set([
	"message_start",
	"content_block_start",
	"content_block_delta",
	"content_block_stop",
	"message_delta",
	"message_stop",
	"ping",
	"error",
]);

function mergeUsage(target: NativeUsage, update: NativeUsage | undefined): void {
	if (!update) return;
	for (const [key, value] of Object.entries(update)) {
		if (value === null || value === undefined) continue;
		(target as Record<string, unknown>)[key] = value;
	}
}

/** Reassembles the Admission's SSE stream. Pure apart from the listener it calls per event. */
export class ResponseCapture {
	private readonly decoder = new TextDecoder();
	private buffer = "";
	private readonly open = new Map<number, OpenBlock>();
	private readonly blocks = new Map<number, NativeBlock>();
	private sawStop = false;
	private readonly captured: CapturedResponse = { content: [], usage: {}, complete: false };

	constructor(private readonly onEvent: (event: SseEvent) => void = () => {}) {}

	feed(chunk: Uint8Array | string): void {
		this.buffer += typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
		this.buffer = this.buffer.replace(/\r\n/g, "\n");
		let boundary = this.buffer.indexOf("\n\n");
		while (boundary >= 0) {
			const raw = this.buffer.slice(0, boundary);
			this.buffer = this.buffer.slice(boundary + 2);
			this.parseEvent(raw);
			boundary = this.buffer.indexOf("\n\n");
		}
	}

	end(): void {
		if (this.buffer.trim()) this.parseEvent(this.buffer);
		this.buffer = "";
	}

	snapshot(): CapturedResponse {
		const content = [...this.blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => block);
		return {
			...this.captured,
			content,
			usage: { ...this.captured.usage },
			complete: this.sawStop && !!this.captured.stopReason && this.open.size === 0 && !this.captured.streamError,
		};
	}

	private parseEvent(raw: string): void {
		const data = raw
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).replace(/^ /, ""))
			.join("\n");
		if (!data) return;
		let event: SseEvent;
		try {
			event = JSON.parse(data) as SseEvent;
		} catch {
			return;
		}
		if (!event || typeof event !== "object" || !KNOWN_EVENTS.has(event.type)) return;
		this.apply(event);
		this.onEvent(event);
	}

	private apply(event: SseEvent): void {
		switch (event.type) {
			case "message_start":
				this.captured.id = event.message?.id;
				this.captured.model = event.message?.model;
				mergeUsage(this.captured.usage, event.message?.usage);
				return;
			case "content_block_start":
				this.open.set(event.index, { block: { ...event.content_block }, partialJson: "" });
				return;
			case "content_block_delta": {
				const open = this.open.get(event.index);
				if (!open) return;
				const delta = event.delta as Record<string, unknown>;
				if (delta.type === "text_delta") open.block.text = `${open.block.text ?? ""}${delta.text ?? ""}`;
				else if (delta.type === "thinking_delta") open.block.thinking = `${open.block.thinking ?? ""}${delta.thinking ?? ""}`;
				else if (delta.type === "signature_delta") open.block.signature = `${open.block.signature ?? ""}${delta.signature ?? ""}`;
				else if (delta.type === "input_json_delta") open.partialJson += String(delta.partial_json ?? "");
				return;
			}
			case "content_block_stop": {
				const open = this.open.get(event.index);
				if (!open) return;
				this.open.delete(event.index);
				if (open.block.type === "tool_use" && open.partialJson) {
					try {
						open.block.input = JSON.parse(open.partialJson);
					} catch {
						open.block.input = {};
					}
				}
				this.blocks.set(event.index, open.block as NativeBlock);
				return;
			}
			case "message_delta":
				if (event.delta?.stop_reason) this.captured.stopReason = event.delta.stop_reason;
				mergeUsage(this.captured.usage, event.usage);
				return;
			case "message_stop":
				this.sawStop = true;
				return;
			case "error":
				this.captured.streamError = event.error?.message ?? event.error?.type ?? "stream error";
				return;
			case "ping":
				return;
		}
	}
}
