import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCursorReplayBroker } from "./cursor-replay-broker.js";
import { registerConversationTimeline } from "./conversation-timeline.js";
import { ToolTimeline } from "./tidy/timeline.js";
import {
  createTidyExtension,
  type TidyExtensionDependencies,
} from "./tidy/index.js";
import type { SourceToolDefinition } from "./tidy/tool-composition.js";

const BUILT_INS = new Set(["read", "write", "edit", "bash", "grep", "find", "ls"]);

type ReplayConsumer = (toolCallId: string, toolName: string) => unknown;

export function wrapSourceForCursorReplay(
  source: SourceToolDefinition,
  consume: ReplayConsumer,
): SourceToolDefinition {
  return {
    ...source,
    execute(this: SourceToolDefinition, toolCallId: string, ...args: any[]) {
      const recorded = consume(toolCallId, source.name);
      if (recorded) return recorded;
      return source.execute.call(source, toolCallId, ...args);
    },
  };
}

export function createToolPresentation(dependencies: TidyExtensionDependencies = {}) {
  return async (pi: ExtensionAPI): Promise<void> => {
    const replay = createCursorReplayBroker(pi.events);
    const timeline = dependencies.timeline ?? new ToolTimeline();
    let enabled = false;
    const tidy = createTidyExtension({
      ...dependencies,
      timeline,
      isReplayCall(toolCallId) {
        return replay.isReplayCall(toolCallId) || dependencies.isReplayCall?.(toolCallId) === true;
      },
      decorateSource(source: SourceToolDefinition) {
        const decorated = dependencies.decorateSource?.(source) ?? source;
        return wrapSourceForCursorReplay(decorated, (toolCallId, toolName) =>
          replay.consume(toolCallId, toolName));
      },
      onToolsReady() {
        enabled = true;
        dependencies.onToolsReady?.();
        replay.activate();
      },
    });

    pi.on("session_start", (_event, ctx) => {
      replay.announceHost();
      const externalTidyTools = pi.getAllTools().filter((tool) =>
        BUILT_INS.has(tool.name)
          && /(?:@mobrienv\/)?pi-tidy-tools/i.test(`${tool.sourceInfo.source} ${tool.sourceInfo.path}`),
      );
      if (externalTidyTools.length > 0) {
        ctx.ui.notify(
          "Remove the separate @mobrienv/pi-tidy-tools package; pi-ext now owns compact built-in tool cards.",
          "warning",
        );
      }
    });
    pi.on("session_shutdown", () => replay.dispose());
    await tidy(pi);
    if (enabled) registerConversationTimeline(pi, timeline);
  };
}

export default createToolPresentation();
