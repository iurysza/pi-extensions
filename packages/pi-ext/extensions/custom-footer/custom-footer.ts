/**
 * Two-line custom footer.
 *
 * Line 1 owns core session state. Line 2 packs extension statuses registered
 * through the optional footer-slot metadata protocol; ordinary setStatus()
 * values remain visible as legacy priority-zero slots.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { PermissionMode } from "../permissions/permissions.js";
import {
  buildPathString,
  fmtTokens,
  modePillWidth,
  renderContextUsage,
  renderModelInfo,
  renderModePill,
  renderPath,
} from "./renderers.js";
import { createFooterSlotRegistry, packFooterStatuses } from "./footer-slots.js";

type FooterData = {
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getGitBranch(): string | undefined;
  onBranchChange(callback: () => void): () => void;
};

type FooterTheme = {
  fg(role: any, text: string): string;
  bold(text: string): string;
  inverse(text: string): string;
  bg(role: any, text: string): string;
};

export function formatResponseTime(endedAt: number): string {
  const time = new Date(endedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).toLowerCase();
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - endedAt) / 1000));
  if (elapsedSeconds < 60) return `◷ ended ${time} · ${elapsedSeconds}s ago`;

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return `◷ ended ${time} · ${elapsedMinutes}m ${elapsedSeconds % 60}s ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `◷ ended ${time} · ${elapsedHours}h ${elapsedMinutes % 60}m ago`;
  return `◷ ended ${time} · ${Math.floor(elapsedHours / 24)}d ${elapsedHours % 24}h ago`;
}

export default function customFooter(pi: ExtensionAPI) {
  const slots = createFooterSlotRegistry(pi.events);
  let currentMode: PermissionMode = "safe";
  let tuiRef: { requestRender(): void } | null = null;
  let footerDataRef: FooterData | null = null;
  let responseEndedAt: number | null = null;
  let responseAgeTimer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (responseAgeTimer) clearInterval(responseAgeTimer);
    responseAgeTimer = undefined;
  };

  pi.events.on("mode:change", (data: unknown) => {
    currentMode = data as PermissionMode;
    tuiRef?.requestRender();
  });

  pi.on("session_start", async (_event, ctx) => {
    clearTimer();
    responseAgeTimer = setInterval(() => {
      if (responseEndedAt !== null) tuiRef?.requestRender();
    }, 1000);
    responseAgeTimer.unref?.();

    ctx.ui.setFooter((_footerTui, _footerTheme, footerData) => {
      footerDataRef = footerData;
      const unsubscribeBranch = footerData.onBranchChange(() => tuiRef?.requestRender());
      return {
        dispose() {
          unsubscribeBranch();
          if (footerDataRef === footerData) footerDataRef = null;
        },
        render() { return []; },
        invalidate() { tuiRef?.requestRender(); },
      };
    });

    const setWidget = ctx.ui.setWidget.bind(ctx.ui) as (
      name: string,
      content: unknown,
      options?: { placement?: string },
    ) => void;
    setWidget(
      "custom-footer",
      (widgetTui: { requestRender(): void }, theme: FooterTheme) => {
        tuiRef = widgetTui;
        return {
          render(width: number): string[] {
            const lines = [renderLine1(width, theme, ctx)];
            const statuses = footerDataRef?.getExtensionStatuses();
            if (statuses) {
              const separator = theme.fg("dim", "  ·  ");
              const slotLine = packFooterStatuses(statuses, slots.priorities, width, separator);
              if (slotLine) lines.push(slotLine);
            }
            return lines;
          },
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );
    slots.announceHost();
  });

  pi.on("agent_start", () => {
    responseEndedAt = null;
    tuiRef?.requestRender();
  });

  pi.on("agent_end", () => {
    responseEndedAt = Date.now();
    tuiRef?.requestRender();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearTimer();
    ctx.ui.setWidget("custom-footer", undefined);
    ctx.ui.setFooter(undefined);
    slots.clear();
    footerDataRef = null;
    tuiRef = null;
    responseEndedAt = null;
  });

  function renderLine1(
    width: number,
    theme: FooterTheme,
    ctx: {
      cwd: string;
      getContextUsage(): { percent: number | null; contextWindow: number } | null | undefined;
      model: { provider?: string; id?: string; contextWindow?: number } | null | undefined;
    },
  ): string {
    const separator = theme.fg("dim", " │ ");
    const separatorWidth = 3;
    const pill = renderModePill(currentMode, theme);
    const pillWidth = modePillWidth(currentMode);
    const pathRaw = buildPathString(ctx.cwd, footerDataRef?.getGitBranch() ?? null);

    const usage = ctx.getContextUsage();
    const percent = usage?.percent ?? 0;
    const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextRaw = `${percent.toFixed(0)}%/${fmtTokens(contextWindow)}`;
    const context = renderContextUsage(percent, contextWindow, theme);

    const provider = ctx.model?.provider || "unknown";
    const modelName = ctx.model?.id || "no-model";
    const model = renderModelInfo(modelName, provider, pi.getThinkingLevel(), theme);
    const responseTimeRaw = responseEndedAt === null ? "" : formatResponseTime(responseEndedAt);
    const responseTime = responseTimeRaw ? theme.fg("dim", responseTimeRaw) : "";

    const responseTimeWidth = responseTimeRaw ? separatorWidth + visibleWidth(responseTimeRaw) : 0;
    const rightBlockWidth = visibleWidth(contextRaw) + responseTimeWidth + separatorWidth + model.rawWidth;
    const pathBudget = width - pillWidth - separatorWidth - rightBlockWidth - separatorWidth;
    const pathDisplay = renderPath(pathRaw, pathBudget, theme);

    const segments: string[] = [pill];
    if (pathDisplay) segments.push(pathDisplay);
    segments.push(context);
    if (responseTime) segments.push(responseTime);
    segments.push(model.text);
    return truncateToWidth(segments.join(separator), width);
  }
}
