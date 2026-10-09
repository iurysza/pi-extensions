import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { renderWidget } from "./render.js";
import { isActive, visibleAgents, type State } from "./state.js";

export function createWidget(getState: () => State, now: () => number) {
  let ui: ExtensionContext["ui"] | undefined;
  let tui: { requestRender(): void } | undefined;
  let registered = false;
  let frame = 0;
  let status: string | undefined;
  let animation: ReturnType<typeof setInterval> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;

  function update() {
    if (!ui) return;
    const state = getState();
    const running = state.filter(isActive).length;
    if (running && !animation) {
      animation = setInterval(() => { frame++; update(); }, 150);
      animation.unref();
    } else if (!running && animation) {
      clearInterval(animation);
      animation = undefined;
    }
    if (expiry) clearTimeout(expiry);
    expiry = undefined;
    const visible = visibleAgents(state, now());
    const ends = visible.flatMap(a => "endedAt" in a.status ? [a.status.endedAt + 60_000] : []);
    if (ends.length) {
      expiry = setTimeout(update, Math.max(1, Math.min(...ends) - now()));
      expiry.unref();
    }
    const nextStatus = running ? `󰅟 ${running} running` : undefined;
    if (status !== nextStatus) { ui.setStatus("cursor-cloud", nextStatus); status = nextStatus; }
    if (!visible.length) {
      if (registered) ui.setWidget("cursor-cloud", undefined);
      registered = false;
      tui = undefined;
    } else if (!registered) {
      registered = true;
      ui.setWidget("cursor-cloud", (host, theme) => {
        tui = host;
        return {
          render: width => renderWidget(getState(), theme, width, frame, now()),
          invalidate: () => {
            registered = false;
            queueMicrotask(update);
          },
        };
      }, { placement: "aboveEditor" });
    } else tui?.requestRender();
  }

  function dispose() {
    if (animation) clearInterval(animation);
    if (expiry) clearTimeout(expiry);
    animation = expiry = undefined;
    ui?.setWidget("cursor-cloud", undefined);
    ui?.setStatus("cursor-cloud", undefined);
    registered = false;
    status = undefined;
    tui = undefined;
    ui = undefined;
  }

  return {
    update,
    attach(ctx: ExtensionContext) {
      if (ctx.mode !== "tui") return;
      if (ctx.ui !== ui) { dispose(); ui = ctx.ui; }
      update();
    },
    dispose,
  };
}
