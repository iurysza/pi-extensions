import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse, type ClientRequest, type Server } from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo, Socket } from "node:net";
import { pinCacheBreakpoint } from "./claude-code-cache-breakpoint.js";
import { ResponseCapture, type SseEvent } from "./claude-code-response-capture.js";
import type { RelaySnapshot } from "./claude-code-turn-outcome.js";

export const ADMISSION_CONSUMED = "PI_MODEL_ADMISSION_CONSUMED";
const MAX_ERROR_BYTES = 64 * 1024;
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"proxy-connection",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
	"accept-encoding",
]);

export interface AdmissionRelayOptions {
	upstream: URL;
	/** False refuses every Messages request; used for the Picker handshake. */
	admit: boolean;
	onEvent?: (event: SseEvent) => void;
	onActivity?: () => void;
}

function forwardHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
	const out: Record<string, string | string[]> = {};
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined || HOP_BY_HOP.has(name.toLowerCase())) continue;
		out[name] = value;
	}
	return out;
}

function sendJson(res: ServerResponse, status: number, type: string, message: string): void {
	const body = JSON.stringify({ type: "error", error: { type, message } });
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
	res.end(body);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function errorMessage(body: string): string {
	try {
		const parsed = JSON.parse(body) as { error?: { message?: unknown } };
		if (typeof parsed.error?.message === "string") return parsed.error.message;
	} catch {
		// Non-JSON error bodies are reported as text.
	}
	return body.trim();
}

/**
 * Loopback Anthropic base URL for one Turn. Forwards the first Messages request (the Admission)
 * and refuses every later one without contacting Anthropic. Never logs headers or bodies.
 */
export class AdmissionRelay {
	private readonly token = randomBytes(32).toString("base64url");
	private readonly sockets = new Set<Socket>();
	private readonly capture: ResponseCapture;
	private upstreamRequest?: ClientRequest;
	private state: RelaySnapshot = { admitted: false, denied: 0 };
	private closed = false;

	private constructor(private readonly server: Server, private readonly options: AdmissionRelayOptions) {
		this.capture = new ResponseCapture(options.onEvent);
		server.on("request", (req, res) => void this.handle(req, res));
		server.on("connection", (socket) => {
			this.sockets.add(socket);
			socket.on("close", () => this.sockets.delete(socket));
		});
	}

	static async start(options: AdmissionRelayOptions): Promise<AdmissionRelay> {
		const server = createServer();
		const relay = new AdmissionRelay(server, options);
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		return relay;
	}

	get url(): string {
		const { port } = this.server.address() as AddressInfo;
		return `http://127.0.0.1:${port}/admit/${this.token}`;
	}

	snapshot(): RelaySnapshot {
		return { ...this.state, ...(this.state.admitted && this.state.status === 200 ? { captured: this.capture.snapshot() } : {}) };
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.upstreamRequest?.destroy();
		for (const socket of this.sockets) socket.destroy();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const prefix = `/admit/${this.token}`;
		const url = req.url ?? "";
		if (url !== prefix && !url.startsWith(`${prefix}/`) && !url.startsWith(`${prefix}?`)) {
			sendJson(res, 404, "not_found_error", "PI_RELAY_UNSUPPORTED");
			return;
		}
		const rest = url.slice(prefix.length) || "/";
		const pathname = rest.split("?")[0];
		if (req.method === "HEAD" && pathname === "/api/hello") {
			res.writeHead(200);
			res.end();
			return;
		}
		if (req.method !== "POST" || pathname !== "/v1/messages") {
			req.resume();
			sendJson(res, 404, "not_found_error", "PI_RELAY_UNSUPPORTED");
			return;
		}
		if (this.state.admitted || !this.options.admit) {
			req.resume();
			this.state.denied += 1;
			sendJson(res, 400, "invalid_request_error", ADMISSION_CONSUMED);
			return;
		}
		this.state.admitted = true;
		let body: Buffer;
		try {
			body = pinCacheBreakpoint(await readBody(req));
		} catch (error) {
			this.state.transportFailure = (error as NodeJS.ErrnoException).code ?? (error as Error).name;
			sendJson(res, 502, "api_error", "PI_RELAY_REQUEST_FAILED");
			return;
		}
		this.forward(req, res, rest, body);
	}

	private forward(req: IncomingMessage, res: ServerResponse, rest: string, body: Buffer): void {
		const target = new URL(rest.replace(/^\//, ""), this.options.upstream.href.endsWith("/") ? this.options.upstream.href : `${this.options.upstream.href}/`);
		const send = target.protocol === "https:" ? httpsRequest : httpRequest;
		const upstream = send(target, {
			method: "POST",
			headers: { ...forwardHeaders(req.headers), "content-length": body.length },
		});
		this.upstreamRequest = upstream;
		upstream.on("response", (response) => {
			const status = response.statusCode ?? 502;
			this.state.status = status;
			const requestId = response.headers["request-id"];
			if (typeof requestId === "string") this.state.requestId = requestId;
			res.writeHead(status, forwardHeaders(response.headers));
			const errorChunks: Buffer[] = [];
			let errorBytes = 0;
			response.on("data", (chunk: Buffer) => {
				this.options.onActivity?.();
				if (status === 200) {
					this.capture.feed(chunk);
				} else if (errorBytes < MAX_ERROR_BYTES) {
					const slice = chunk.subarray(0, MAX_ERROR_BYTES - errorBytes);
					errorChunks.push(slice);
					errorBytes += slice.length;
				}
				res.write(chunk);
			});
			response.on("end", () => {
				if (status === 200) this.capture.end();
				else this.state.errorText = errorMessage(Buffer.concat(errorChunks).toString("utf8"));
				res.end();
			});
			response.on("error", (error: NodeJS.ErrnoException) => {
				this.state.transportFailure = error.code ?? error.name;
				res.destroy();
			});
		});
		upstream.on("error", (error: NodeJS.ErrnoException) => {
			this.state.transportFailure = error.code ?? error.name;
			if (!res.headersSent) sendJson(res, 502, "api_error", "PI_RELAY_UPSTREAM_FAILED");
			else res.destroy();
		});
		upstream.end(body);
	}
}
