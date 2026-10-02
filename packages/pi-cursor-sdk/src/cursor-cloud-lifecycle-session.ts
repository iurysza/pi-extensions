import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";

// Startup-light session capture for the cloud lifecycle ledger. Kept dependency-free so the
// extension entry can wire these handlers without loading the full ledger/command module.
export type CloudLifecycleApi = Pick<ExtensionAPI, "appendEntry" | "on">;
export type CloudLifecycleSessionContext = Pick<ExtensionContext, "sessionManager">;

export interface CloudLifecycleSessionState {
	sessionFile?: string;
	sessionId?: string;
	getBranch?: () => SessionEntry[];
}

export const cloudLifecycleState: { api: CloudLifecycleApi | undefined; session: CloudLifecycleSessionState } = {
	api: undefined,
	session: {},
};

export function captureCloudLifecycleSession(ctx: CloudLifecycleSessionContext): void {
	cloudLifecycleState.session = {
		sessionFile: ctx.sessionManager.getSessionFile?.() ?? undefined,
		sessionId: ctx.sessionManager.getSessionId?.() ?? undefined,
		getBranch: () => ctx.sessionManager.getBranch(),
	};
}

export function registerCursorCloudLifecycleSessionCapture(pi: CloudLifecycleApi): void {
	cloudLifecycleState.api = pi;
	pi.on("session_start", (_event, ctx) => captureCloudLifecycleSession(ctx));
	pi.on("before_agent_start", (_event, ctx) => captureCloudLifecycleSession(ctx));
	pi.on("session_tree", (_event, ctx) => captureCloudLifecycleSession(ctx));
}
