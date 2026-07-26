import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionContext,
	ExtensionHandler,
	SessionStartEvent,
	TurnStartEvent,
} from "@earendil-works/pi-coding-agent";

export type CursorModelLifecycleContext = ExtensionContext;

type CursorModelSelectEvent = { model: ExtensionContext["model"] };

type CursorModelLifecycleSyncHandler = (ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelSessionStartHandler = ExtensionHandler<SessionStartEvent>;
type CursorModelSelectHandler = (event: CursorModelSelectEvent, ctx: CursorModelLifecycleContext) => Promise<void> | void;
type CursorModelTurnStartHandler = ExtensionHandler<TurnStartEvent>;
type CursorModelBeforeAgentStartHandler = ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;

export interface CursorModelLifecycleExtensionApi {
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(event: "before_agent_start", handler: CursorModelBeforeAgentStartHandler): void;
	on(event: "model_select", handler: (event: CursorModelSelectEvent, ctx: ExtensionContext) => Promise<void> | void): void;
	on(event: "turn_start", handler: ExtensionHandler<TurnStartEvent>): void;
}

export interface CursorModelLifecycleHandlers {
	sessionStart?: CursorModelSessionStartHandler;
	modelSelect?: CursorModelSelectHandler;
	turnStart?: CursorModelTurnStartHandler;
	sync?: CursorModelLifecycleSyncHandler;
	beforeAgentStart?: CursorModelBeforeAgentStartHandler;
}

function normalizeLifecycleHandlers(
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): CursorModelLifecycleHandlers {
	return typeof handlerOrHandlers === "function" ? { sync: handlerOrHandlers } : handlerOrHandlers;
}

export function registerCursorModelLifecycle(
	pi: CursorModelLifecycleExtensionApi,
	handlerOrHandlers: CursorModelLifecycleSyncHandler | CursorModelLifecycleHandlers,
): void {
	const handlers = normalizeLifecycleHandlers(handlerOrHandlers);
	const sync = handlers.sync;
	if (handlers.sessionStart || sync) {
		pi.on("session_start", async (event, ctx) => {
			await handlers.sessionStart?.(event, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.modelSelect || sync) {
		pi.on("model_select", async (event, ctx) => {
			const effectiveCtx = { ...ctx, model: event.model };
			await handlers.modelSelect?.(event, effectiveCtx);
			await sync?.(effectiveCtx);
		});
	}
	if (handlers.turnStart || sync) {
		pi.on("turn_start", async (event, ctx) => {
			await handlers.turnStart?.(event, ctx);
			await sync?.(ctx);
		});
	}
	if (handlers.beforeAgentStart || sync) {
		pi.on("before_agent_start", async (event, ctx) => {
			await sync?.(ctx);
			return await handlers.beforeAgentStart?.(event, ctx);
		});
	}
}
