import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { CursorLiveRun } from "./cursor-live-run-coordinator.js";
import { cursorLiveRuns } from "./cursor-provider-live-run-drain.js";
import { CursorPartialContentEmitter } from "./cursor-partial-content-emitter.js";
import type { CursorSdkEventDebugRecorder } from "./cursor-sdk-event-debug.js";
import {
	CURSOR_TOOL_LIFECYCLE_DEFER_MS,
	formatCursorToolLifecycleProgressText,
	isCursorToolLifecycleEligible,
} from "./cursor-tool-lifecycle.js";
import { getNormalizedCursorToolName } from "./cursor-tool-visibility.js";
import { getStartedToolCallFingerprint } from "./cursor-provider-turn-tool-ledger.js";

export interface CursorToolLifecycleEmitterOptions {
	liveRun?: CursorLiveRun;
	resolvedApiKey?: string;
	contentEmitter: CursorPartialContentEmitter;
	debugRecorder?: CursorSdkEventDebugRecorder;
	hasStartedToolCall: (callId: string) => boolean;
	isBridgeMcpToolCall: (toolCall: unknown) => boolean;
}

export class CursorToolLifecycleEmitter {
	private readonly liveRun?: CursorLiveRun;
	private readonly resolvedApiKey?: string;
	private readonly contentEmitter: CursorPartialContentEmitter;
	private readonly debugRecorder?: CursorSdkEventDebugRecorder;
	private readonly hasStartedToolCall: (callId: string) => boolean;
	private readonly isBridgeMcpToolCall: (toolCall: unknown) => boolean;
	private readonly emittedLifecycleCallIds = new Set<string>();
	private readonly lifecycleTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly activeLifecycleFingerprintOwners = new Map<string, string>();
	private readonly lifecycleFingerprintByCallId = new Map<string, string>();
	private readonly activeLifecycleProgressTextOwners = new Map<string, string>();
	private readonly lifecycleProgressTextByCallId = new Map<string, string>();

	constructor(options: CursorToolLifecycleEmitterOptions) {
		this.liveRun = options.liveRun;
		this.resolvedApiKey = options.resolvedApiKey;
		this.contentEmitter = options.contentEmitter;
		this.debugRecorder = options.debugRecorder;
		this.hasStartedToolCall = options.hasStartedToolCall;
		this.isBridgeMcpToolCall = options.isBridgeMcpToolCall;
	}

	maybeSchedule(callId: unknown, toolCall: unknown): void {
		if (typeof callId !== "string" || this.emittedLifecycleCallIds.has(callId)) return;
		if (this.isBridgeMcpToolCall(toolCall)) return;
		if (!isCursorToolLifecycleEligible(toolCall)) return;

		const progressText = formatCursorToolLifecycleProgressText(toolCall, this.resolvedApiKey);
		if (!progressText) return;

		const fingerprint = getStartedToolCallFingerprint(toolCall);
		const existingOwner = this.activeLifecycleFingerprintOwners.get(fingerprint);
		if (existingOwner && existingOwner !== callId) {
			this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle_skip", {
				callId,
				ownerCallId: existingOwner,
				toolName: getNormalizedCursorToolName(toolCall),
				reason: "duplicate-active-fingerprint",
			});
			return;
		}

		this.cancel(callId);
		this.activeLifecycleFingerprintOwners.set(fingerprint, callId);
		this.lifecycleFingerprintByCallId.set(callId, fingerprint);
		if (!this.activeLifecycleProgressTextOwners.has(progressText)) {
			this.activeLifecycleProgressTextOwners.set(progressText, callId);
		}
		this.lifecycleProgressTextByCallId.set(callId, progressText);
		const timer = setTimeout(() => {
			this.lifecycleTimers.delete(callId);
			if (!this.hasStartedToolCall(callId)) {
				this.clearLifecycleIdentity(callId);
				return;
			}
			if (this.emittedLifecycleCallIds.has(callId)) return;
			const progressOwner = this.activeLifecycleProgressTextOwners.get(progressText);
			if (progressOwner && progressOwner !== callId && this.hasStartedToolCall(progressOwner)) {
				this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle_skip", {
					callId,
					ownerCallId: progressOwner,
					toolName: getNormalizedCursorToolName(toolCall),
					reason: "duplicate-active-progress-text",
				});
				return;
			}
			this.activeLifecycleProgressTextOwners.set(progressText, callId);
			this.emit(callId, toolCall, progressText);
		}, CURSOR_TOOL_LIFECYCLE_DEFER_MS);
		timer.unref?.();
		this.lifecycleTimers.set(callId, timer);
	}

	cancel(callId: string): void {
		const timer = this.lifecycleTimers.get(callId);
		if (timer) {
			clearTimeout(timer);
			this.lifecycleTimers.delete(callId);
		}
		this.clearLifecycleIdentity(callId);
	}

	clear(): void {
		this.emittedLifecycleCallIds.clear();
		for (const timer of this.lifecycleTimers.values()) clearTimeout(timer);
		this.lifecycleTimers.clear();
		this.activeLifecycleFingerprintOwners.clear();
		this.lifecycleFingerprintByCallId.clear();
		this.activeLifecycleProgressTextOwners.clear();
		this.lifecycleProgressTextByCallId.clear();
	}

	private clearLifecycleIdentity(callId: string): void {
		const fingerprint = this.lifecycleFingerprintByCallId.get(callId);
		if (fingerprint && this.activeLifecycleFingerprintOwners.get(fingerprint) === callId) {
			this.activeLifecycleFingerprintOwners.delete(fingerprint);
		}
		this.lifecycleFingerprintByCallId.delete(callId);
		const progressText = this.lifecycleProgressTextByCallId.get(callId);
		if (progressText && this.activeLifecycleProgressTextOwners.get(progressText) === callId) {
			this.activeLifecycleProgressTextOwners.delete(progressText);
		}
		this.lifecycleProgressTextByCallId.delete(callId);
	}

	private emit(callId: string, toolCall: unknown, progressText: string): void {
		this.emittedLifecycleCallIds.add(callId);
		this.debugRecorder?.recordCoordinatorEvent("tool_lifecycle", {
			callId,
			toolName: getNormalizedCursorToolName(toolCall),
			progressText,
			liveRun: this.liveRun !== undefined,
		});
		if (this.liveRun) {
			cursorLiveRuns.queueEvent(this.liveRun, { type: "thinking-delta", text: progressText });
			return;
		}
		this.contentEmitter.appendThinkingDelta(progressText);
	}
}

export function createTurnCoordinatorContentEmitter(
	stream: AssistantMessageEventStream,
	partial: AssistantMessage,
): CursorPartialContentEmitter {
	return new CursorPartialContentEmitter(stream, partial, undefined, false);
}
