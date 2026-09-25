import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";

export interface RecordedRequest {
	method: string;
	url: string;
	headers: IncomingHttpHeaders;
	body: any;
}

export interface ScriptedResponse {
	status?: number;
	events?: object[];
	errorBody?: object;
	/** Number of events to send before dropping the connection. */
	cutAfter?: number;
}

export interface FakeUpstream {
	url: URL;
	requests: RecordedRequest[];
	messages(): RecordedRequest[];
	close(): Promise<void>;
}

const frame = (event: object) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`;

function messageStart(usage: object = {}) {
	return {
		type: "message_start",
		message: {
			id: "msg_fake",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-5",
			content: [],
			stop_reason: null,
			usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage },
		},
	};
}

function messageEnd(stopReason: string, outputTokens = 5) {
	return [
		{ type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } },
		{ type: "message_stop" },
	];
}

export const sse = {
	text(text: string, options: { stopReason?: string; usage?: object } = {}): ScriptedResponse {
		return {
			events: [
				messageStart(options.usage),
				{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
				{ type: "content_block_stop", index: 0 },
				...messageEnd(options.stopReason ?? "end_turn"),
			],
		};
	},
	tool(id: string, name: string, input: object, text?: string): ScriptedResponse {
		const json = JSON.stringify(input);
		const offset = text ? 1 : 0;
		return {
			events: [
				messageStart(),
				...(text
					? [
							{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
							{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
							{ type: "content_block_stop", index: 0 },
						]
					: []),
				{ type: "content_block_start", index: offset, content_block: { type: "tool_use", id, name, input: {} } },
				{ type: "content_block_delta", index: offset, delta: { type: "input_json_delta", partial_json: json.slice(0, 5) } },
				{ type: "content_block_delta", index: offset, delta: { type: "input_json_delta", partial_json: json.slice(5) } },
				{ type: "content_block_stop", index: offset },
				...messageEnd("tool_use"),
			],
		};
	},
	thinking(thinking: string, signature: string, text: string): ScriptedResponse {
		return {
			events: [
				messageStart(),
				{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
				{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } },
				{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature } },
				{ type: "content_block_stop", index: 0 },
				{ type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "REDACTED_blob" } },
				{ type: "content_block_stop", index: 1 },
				{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
				{ type: "content_block_delta", index: 2, delta: { type: "text_delta", text } },
				{ type: "content_block_stop", index: 2 },
				...messageEnd("end_turn"),
			],
		};
	},
	error(status: number, message: string, type = "invalid_request_error"): ScriptedResponse {
		return { status, errorBody: { type: "error", error: { type, message } } };
	},
};

export async function startFakeUpstream(script: ScriptedResponse[] = []): Promise<FakeUpstream> {
	const requests: RecordedRequest[] = [];
	const sockets = new Set<Socket>();
	let next = 0;
	const server: Server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			let body: unknown = raw;
			try {
				body = raw ? JSON.parse(raw) : undefined;
			} catch {
				// Recorded as text.
			}
			requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body });
			if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
				res.writeHead(404).end();
				return;
			}
			const response = script[next++] ?? sse.text("hello from fake upstream");
			if (response.errorBody || (response.status && response.status !== 200)) {
				res.writeHead(response.status ?? 400, { "content-type": "application/json", "request-id": "req_fake_error" });
				res.end(JSON.stringify(response.errorBody ?? {}));
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_fake" });
			const events = response.events ?? [];
			const count = response.cutAfter ?? events.length;
			for (const event of events.slice(0, count)) res.write(frame(event));
			if (response.cutAfter !== undefined) {
				setTimeout(() => res.socket?.destroy(), 20);
				return;
			}
			res.end();
		});
	});
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
	const { port } = server.address() as AddressInfo;
	return {
		url: new URL(`http://127.0.0.1:${port}`),
		requests,
		messages: () => requests.filter((request) => request.method === "POST" && request.url.startsWith("/v1/messages")),
		close: async () => {
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}
