import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CURSOR_REPLAY_PROTOCOL_VERSION = 1 as const;
export const CURSOR_REPLAY_HOST_READY = "@iurysza/pi-ext/cursor-replay/ready/v1";
export const CURSOR_REPLAY_PRODUCER_REGISTER = "@iurysza/pi-ext/cursor-replay/register/v1";
export const CURSOR_REPLAY_CONSUME = "@iurysza/pi-ext/cursor-replay/consume/v1";
export const CURSOR_REPLAY_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;

const REPLAY_TOOL_NAMES = new Set<string>(CURSOR_REPLAY_TOOL_NAMES);
const REPLAY_ID_PREFIX = "cursor-replay-";

export interface CursorReplayResult {
  content: Array<Record<string, unknown>>;
  details?: unknown;
  terminate?: boolean;
}

interface CursorReplayDelivery {
  protocolVersion: typeof CURSOR_REPLAY_PROTOCOL_VERSION;
  toolCallId: string;
  toolName: string;
  isError: boolean;
  result: CursorReplayResult;
}

function parseDelivery(
  value: unknown,
  toolCallId: string,
  toolName: string,
): CursorReplayDelivery | undefined {
  if (!value || typeof value !== "object") return undefined;
  const delivery = value as Partial<CursorReplayDelivery>;
  if (
    delivery.protocolVersion !== CURSOR_REPLAY_PROTOCOL_VERSION
    || delivery.toolCallId !== toolCallId
    || delivery.toolName !== toolName
    || typeof delivery.isError !== "boolean"
    || !delivery.result
    || typeof delivery.result !== "object"
    || !Array.isArray(delivery.result.content)
  ) return undefined;
  return delivery as CursorReplayDelivery;
}

function replayErrorMessage(delivery: CursorReplayDelivery): string {
  for (const entry of delivery.result.content) {
    if (entry.type === "text" && typeof entry.text === "string" && entry.text.trim()) return entry.text.trim();
  }
  return `Recorded Cursor ${delivery.toolName} replay failed`;
}

export function isCursorReplayCall(toolCallId: string): boolean {
  return toolCallId.startsWith(REPLAY_ID_PREFIX);
}

export function createCursorReplayBroker(events: ExtensionAPI["events"]) {
  let producerRegistered = false;
  let active = false;
  const announceHost = () => {
    if (!active) return;
    events.emit(CURSOR_REPLAY_HOST_READY, {
      protocolVersion: CURSOR_REPLAY_PROTOCOL_VERSION,
      toolNames: CURSOR_REPLAY_TOOL_NAMES,
    });
  };
  const disposeProducer = events.on(CURSOR_REPLAY_PRODUCER_REGISTER, (data) => {
    if (
      !data
      || typeof data !== "object"
      || (data as { protocolVersion?: unknown }).protocolVersion !== CURSOR_REPLAY_PROTOCOL_VERSION
    ) return;
    producerRegistered = true;
    announceHost();
  });

  return {
    activate() {
      active = true;
      announceHost();
    },
    announceHost,
    isProducerRegistered: () => producerRegistered,
    isReplayCall: isCursorReplayCall,
    consume(toolCallId: string, toolName: string): CursorReplayResult | undefined {
      if (!isCursorReplayCall(toolCallId)) return undefined;
      if (!REPLAY_TOOL_NAMES.has(toolName)) {
        throw new Error(`Cursor replay cannot target unsupported tool ${toolName}.`);
      }

      let delivery: CursorReplayDelivery | undefined;
      events.emit(CURSOR_REPLAY_CONSUME, {
        protocolVersion: CURSOR_REPLAY_PROTOCOL_VERSION,
        toolCallId,
        toolName,
        accept(value: unknown) {
          if (delivery) return;
          delivery = parseDelivery(value, toolCallId, toolName);
        },
      });
      if (!delivery) {
        throw new Error(`No recorded Cursor ${toolName} result was available. This replay-only call never executes the underlying tool.`);
      }
      if (delivery.isError) throw new Error(replayErrorMessage(delivery));
      return {
        content: delivery.result.content,
        details: delivery.result.details,
        terminate: delivery.result.terminate ?? true,
      };
    },
    dispose() {
      disposeProducer();
      producerRegistered = false;
      active = false;
    },
  };
}
