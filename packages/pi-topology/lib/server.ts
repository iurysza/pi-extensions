import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, buildModel, type Edit } from "./parse.js";
import { ConflictError, scaffold, Store, type WorkflowRef } from "./store.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const MAX_BODY = 2_000_000;

export interface RunningServer {
	url: string;
	close(): Promise<void>;
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json"): void {
	res.writeHead(status, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
	res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY) throw new Error("Request too large");
		chunks.push(chunk as Buffer);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function ref(input: Record<string, unknown>): WorkflowRef {
	return { scope: String(input.scope) as WorkflowRef["scope"], name: String(input.name) };
}

function tokenOk(given: string | undefined, token: string): boolean {
	if (!given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(token);
	return a.length === b.length && timingSafeEqual(a, b);
}

export function createHandler(store: Store, token: string, getHost: () => string) {
	const view = (r: WorkflowRef, source: string, hash: string) => ({
		...r,
		source,
		hash,
		model: buildModel(source),
	});

	return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			// DNS-rebinding guard: only answer to our own host name.
			if (req.headers.host !== getHost()) return send(res, 403, { error: "Bad host" });

			if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
				return send(res, 200, readFileSync(join(PUBLIC_DIR, "index.html"), "utf8"), "text/html");
			}
			if (!url.pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });

			const given = req.headers["x-topology-token"];
			if (!tokenOk(Array.isArray(given) ? given[0] : given, token)) return send(res, 401, { error: "Missing or wrong token" });
			if (req.method !== "GET") {
				const origin = req.headers.origin;
				if (origin && origin !== `http://${getHost()}`) return send(res, 403, { error: "Bad origin" });
			}

			if (req.method === "GET" && url.pathname === "/api/workflows") {
				return send(res, 200, {
					cwd: store.cwd,
					roots: store.roots(),
					workflows: store.list(),
					agentTypes: store.agentTypes(),
				});
			}
			if (req.method === "GET" && url.pathname === "/api/workflow") {
				const r = ref(Object.fromEntries(url.searchParams));
				const { source, hash } = store.read(r);
				return send(res, 200, view(r, source, hash));
			}

			const body = await readJson(req);
			const r = ref(body);

			if (req.method === "POST" && url.pathname === "/api/edit") {
				const { source, hash } = store.read(r);
				if (hash !== body.hash) throw new ConflictError();
				const next = applyEdits(source, body.edits as Edit[]);
				const written = store.write(r, next, hash);
				return send(res, 200, view(r, next, written.hash));
			}
			if (req.method === "POST" && url.pathname === "/api/save") {
				const next = String(body.source ?? "");
				const written = store.write(r, next, String(body.hash));
				return send(res, 200, view(r, next, written.hash));
			}
			if (req.method === "POST" && url.pathname === "/api/create") {
				const source = typeof body.source === "string" && body.source ? body.source : scaffold(r.name);
				const written = store.write(r, source, null);
				return send(res, 200, view(r, source, written.hash));
			}
			if (req.method === "POST" && url.pathname === "/api/delete") {
				store.remove(r);
				return send(res, 200, { ok: true });
			}
			return send(res, 404, { error: "Not found" });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return send(res, error instanceof ConflictError ? 409 : 400, { error: message });
		}
	};
}

export async function startServer(cwd: string): Promise<RunningServer> {
	const token = randomBytes(18).toString("base64url");
	const store = new Store(cwd);
	let host = "";
	const server: Server = createServer(createHandler(store, token, () => host));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address() as AddressInfo;
	host = `127.0.0.1:${port}`;
	return {
		url: `http://${host}/#token=${token}`,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
