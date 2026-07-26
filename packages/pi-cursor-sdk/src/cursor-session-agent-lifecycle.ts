import type {
	ExtensionHandler,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";

export interface CursorSessionAgentLifecycleExtensionApi {
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent>): void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
	on(event: "model_select", handler: () => Promise<void> | void): void;
}

export function registerCursorSessionAgentLifecycle(pi: CursorSessionAgentLifecycleExtensionApi): void {
	onCursorSessionScopeKeyChange(async (previousScopeKey) => {
		const { disposeSessionCursorAgent } = await import("./cursor-session-agent.js");
		await disposeSessionCursorAgent(previousScopeKey);
	});
	pi.on("session_shutdown", async (event) => {
		const { disposeSessionCursorAgent, resetSessionCursorAgent } = await import("./cursor-session-agent.js");
		try {
			if (event.reason === "reload") {
				await resetSessionCursorAgent();
				return;
			}
			await disposeSessionCursorAgent();
		} finally {
			clearCursorSdkHttp1();
		}
	});
	pi.on("session_compact", async () => {
		const { invalidateSessionAgent } = await import("./cursor-session-agent.js");
		invalidateSessionAgent();
	});
	pi.on("session_before_tree", async () => {
		const { invalidateSessionAgent } = await import("./cursor-session-agent.js");
		invalidateSessionAgent();
	});
	pi.on("session_tree", async () => {
		const { resetSessionCursorAgent } = await import("./cursor-session-agent.js");
		await resetSessionCursorAgent();
	});
	pi.on("model_select", async () => {
		const { invalidateSessionAgent } = await import("./cursor-session-agent.js");
		invalidateSessionAgent();
	});
}
