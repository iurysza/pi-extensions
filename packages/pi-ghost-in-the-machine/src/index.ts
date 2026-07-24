import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type FaceState = "idle" | "thinking" | "working" | "done" | "error";

const EXTENSION_NAME = "ghost-in-the-machine";
const CONTROLLER = fileURLToPath(new URL("../scripts/ghost-state.sh", import.meta.url));
const MIN_STATE_MS = 2000;
const WORK_TOOLS = new Set(["bash", "edit", "write"]);
const FACE_STATES = new Set<FaceState>(["idle", "thinking", "working", "done", "error"]);

function normalizedToolName(name: string): string {
	return name.split(/[.:/]/).at(-1)?.toLowerCase() ?? name.toLowerCase();
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let desiredState: FaceState = "idle";
	let appliedState: FaceState | undefined;
	let queuedState: FaceState | undefined;
	let sending = false;
	let lastAppliedAt = 0;
	let runHadError = false;
	let controllerUnavailable = false;
	let queueWaiters: Array<() => void> = [];

	async function runController(...args: string[]): Promise<boolean> {
		try {
			const result = await pi.exec("bash", [CONTROLLER, ...args], { timeout: 2000 });
			return result.code === 0;
		} catch {
			return false;
		}
	}

	function resolveQueueWaiters(): void {
		for (const resolve of queueWaiters) resolve();
		queueWaiters = [];
	}

	function waitForStateQueue(): Promise<void> {
		if (!sending) return Promise.resolve();
		return new Promise((resolve) => queueWaiters.push(resolve));
	}

	function setState(state: FaceState): void {
		desiredState = state;
		if (!enabled || queuedState === state) return;
		if (!sending && appliedState === state) return;
		queuedState = state;
		if (!sending) void drainStateQueue();
	}

	async function drainStateQueue(): Promise<void> {
		if (sending) return;
		sending = true;
		try {
			while (queuedState) {
				const state = queuedState;
				queuedState = undefined;
				const waitMs = Math.max(0, lastAppliedAt + MIN_STATE_MS - Date.now());
				if (waitMs > 0) await sleep(waitMs);
				if (!enabled) continue;
				const ok = await runController("set", state);
				controllerUnavailable = !ok;
				if (ok) {
					appliedState = state;
					lastAppliedAt = Date.now();
				}
			}
		} finally {
			sending = false;
			resolveQueueWaiters();
			if (queuedState) void drainStateQueue();
		}
	}

	async function applyNow(state: FaceState): Promise<boolean> {
		queuedState = undefined;
		await waitForStateQueue();
		const ok = await runController("set", state);
		controllerUnavailable = !ok;
		if (ok) {
			desiredState = state;
			appliedState = state;
			lastAppliedAt = Date.now();
		}
		return ok;
	}

	pi.on("session_start", async (_event, ctx) => {
		desiredState = "idle";
		const watcherOk = process.env.HERDR_ENV !== "1" || await runController("watch-start");
		const stateOk = await applyNow("idle");
		if (!watcherOk || !stateOk) ctx.ui.setStatus(EXTENSION_NAME, "ghost controller unavailable");
		else ctx.ui.setStatus(EXTENSION_NAME, undefined);
	});

	pi.on("input", () => {
		runHadError = false;
		setState("thinking");
	});

	pi.on("agent_start", () => setState("thinking"));

	pi.on("tool_execution_start", (event) => {
		const tool = normalizedToolName(event.toolName);
		setState(WORK_TOOLS.has(tool) ? "working" : "thinking");
	});

	pi.on("tool_execution_end", (event) => {
		if (event.isError) {
			runHadError = true;
			setState("error");
		}
	});

	pi.on("agent_settled", () => setState(runHadError ? "error" : "done"));

	pi.on("session_shutdown", async () => {
		enabled = false;
		queuedState = undefined;
		await waitForStateQueue();
		await runController("clear");
	});

	for (const state of FACE_STATES) {
		pi.registerCommand(`ghost-${state}`, {
			description: `Set ghost-in-the-machine to ${state}.`,
			handler: async (_args, ctx) => {
				enabled = true;
				const ok = await applyNow(state);
				ctx.ui.notify(
					ok ? `ghost-in-the-machine: ${state}` : "ghost controller unavailable",
					ok ? "info" : "error",
				);
			},
		});
	}

	pi.registerCommand("ghost-status", {
		description: "Show ghost-in-the-machine status.",
		handler: async (_args, ctx) => {
			const result = await pi.exec("bash", [CONTROLLER, "status"], { timeout: 2000 });
			const active = result.stdout.trim() || "active=unknown";
			const suffix = controllerUnavailable ? ", controller=unavailable" : "";
			ctx.ui.notify(
				`ghost-in-the-machine: ${enabled ? "on" : "disabled"}, desired=${desiredState}, ${active}${suffix}`,
				"info",
			);
		},
	});

	pi.registerCommand("ghost-off", {
		description: "Hide the ghost until the next Pi event.",
		handler: async (_args, ctx) => {
			queuedState = undefined;
			await waitForStateQueue();
			const ok = await runController("set", "off");
			controllerUnavailable = !ok;
			appliedState = undefined;
			lastAppliedAt = Date.now();
			ctx.ui.notify(ok ? "ghost hidden until the next Pi event" : "ghost controller unavailable", ok ? "info" : "error");
		},
	});

	pi.registerCommand("ghost-disable", {
		description: "Disable the ghost for this Pi session.",
		handler: async (_args, ctx) => {
			enabled = false;
			queuedState = undefined;
			await waitForStateQueue();
			const ok = await runController("clear");
			controllerUnavailable = !ok;
			ctx.ui.notify(ok ? "ghost disabled for this Pi session" : "ghost controller unavailable", ok ? "info" : "error");
		},
	});

	pi.registerCommand("ghost-on", {
		description: "Enable the ghost and restore its desired state.",
		handler: async (_args, ctx) => {
			enabled = true;
			const ok = await applyNow(desiredState);
			ctx.ui.notify(ok ? "ghost-in-the-machine enabled" : "ghost controller unavailable", ok ? "info" : "error");
		},
	});
}
