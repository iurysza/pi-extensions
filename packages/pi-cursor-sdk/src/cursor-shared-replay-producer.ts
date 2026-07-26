import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { BUILTIN_NATIVE_CURSOR_TOOL_NAMES } from "./cursor-native-tool-names.js";
import {
  clearSharedCursorReplayToolNames,
  consumeCursorNativeToolDisplay,
  setSharedCursorReplayToolNames,
} from "./cursor-native-tool-display-state.js";

const PROTOCOL_VERSION = 1 as const;
const HOST_READY = "@iurysza/pi-ext/cursor-replay/ready/v1";
const PRODUCER_REGISTER = "@iurysza/pi-ext/cursor-replay/register/v1";
const CONSUME = "@iurysza/pi-ext/cursor-replay/consume/v1";
const BUILTIN_NAMES = new Set<string>(BUILTIN_NATIVE_CURSOR_TOOL_NAMES);

interface ConsumeRequest {
  protocolVersion: typeof PROTOCOL_VERSION;
  toolCallId: string;
  toolName: string;
  accept(delivery: unknown): void;
}

function parseConsumeRequest(data: unknown): ConsumeRequest | undefined {
  if (!data || typeof data !== "object") return undefined;
  const request = data as Partial<ConsumeRequest>;
  if (
    request.protocolVersion !== PROTOCOL_VERSION
    || typeof request.toolCallId !== "string"
    || typeof request.toolName !== "string"
    || !BUILTIN_NAMES.has(request.toolName)
    || typeof request.accept !== "function"
  ) return undefined;
  return request as ConsumeRequest;
}

export function createCursorSharedReplayProducer(events: ExtensionAPI["events"]) {
  const register = () => events.emit(PRODUCER_REGISTER, {
    protocolVersion: PROTOCOL_VERSION,
    producer: "@iurysza/pi-cursor-sdk",
  });
  const disposeReady = events.on(HOST_READY, (data) => {
    if (!data || typeof data !== "object") return;
    const ready = data as { protocolVersion?: unknown; toolNames?: unknown };
    if (ready.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(ready.toolNames)) return;
    setSharedCursorReplayToolNames(ready.toolNames.filter(
      (toolName): toolName is string => typeof toolName === "string" && BUILTIN_NAMES.has(toolName),
    ));
  });
  const disposeConsume = events.on(CONSUME, (data) => {
    const request = parseConsumeRequest(data);
    if (!request) return;
    const item = consumeCursorNativeToolDisplay(request.toolCallId);
    if (!item) return;
    const mismatchedTool = item.toolName !== request.toolName;
    request.accept({
      protocolVersion: PROTOCOL_VERSION,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      isError: mismatchedTool || item.isError,
      result: mismatchedTool
        ? {
            content: [{
              type: "text",
              text: `Recorded Cursor replay expected ${request.toolName} but contained ${item.toolName}.`,
            }],
          }
        : {
            content: item.result.content,
            details: item.result.details,
            terminate: item.terminate ?? true,
          },
    });
  });
  register();

  return {
    register,
    dispose() {
      disposeReady();
      disposeConsume();
      clearSharedCursorReplayToolNames();
    },
  };
}
