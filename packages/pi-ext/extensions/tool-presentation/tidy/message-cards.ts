import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { cardRenderers } from "./cards/index.js";
import { cursorCloudSpecs } from "./cards/specs/cursor-cloud.js";
import { ChillState, chillComponent, completionId, CLOUD_COMPLETION_TYPE } from "./chill.js";
import type { TidyMode } from "./config.js";

type Message = { customType: string; content: string | readonly any[]; details?: any; timestamp?: number | string };
type Request = { version: 1; customType: string; message: Message; expanded: boolean; theme: Theme; component?: Component };
const messageSpecs = { [CLOUD_COMPLETION_TYPE]: cursorCloudSpecs.cursor_cloud_completion };

/** Sync event-bus protocol, keyed by customType. Owners emit; tidy fills component. */
export function registerMessageCards(pi: ExtensionAPI, chill: ChillState, settings: { mode: TidyMode; icons: boolean; expandedMaxLines: number }): void {
  let redraw = () => {};
  // Message renderers have no invalidate callback. An empty widget supplies the host redraw handle.
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    ctx.ui.setWidget("tidy-message-cards", tui => {
      redraw = () => tui.requestRender();
      return { render: () => [], invalidate() {} };
    });
  });
  pi.on("session_shutdown", () => { redraw = () => {}; });
  pi.events?.on?.("tidy:message-card:v1", (data: unknown) => {
    if (!data || typeof data !== "object") return;
    const request = data as Request;
    if (request.version !== 1 || !Object.hasOwn(messageSpecs, request.customType)) return;
    const spec = messageSpecs[request.customType as keyof typeof messageSpecs];
    const { message, expanded, theme } = request;
    chill.completeMessage(message);
    const id = completionId(message);
    const result = { content: typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content, details: message.details };
    const context = { toolCallId: id, args: { prompt: message.details?.prompt }, invalidate: () => redraw() };
    const component = cardRenderers(spec, undefined, undefined, settings).renderResult(result, { expanded, isPartial: false }, theme, context);
    request.component = chillComponent(component, chill, context, "message", expanded);
  });
}
