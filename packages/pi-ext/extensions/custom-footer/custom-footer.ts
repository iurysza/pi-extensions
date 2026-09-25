/**
 * Two-line custom footer.
 *
 * Line 1 shows the nearest loaded AGENTS.md folder, model, and context usage.
 * Line 2 packs quota, integrations, and transient statuses in that order.
 * Ordinary setStatus() values remain visible as legacy priority-zero slots.
 */

import { SettingsManager, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildPathString,
  nearestAgentsFolder,
  renderContextUsage,
  renderModelInfo,
  renderPath,
} from "./renderers.js";
import {
  createFooterSlotRegistry,
  orderedStatusValues,
  packFooterStatuses,
  partitionFooterStatuses,
} from "./footer-slots.js";

type FooterData = {
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getGitBranch(): string | undefined;
  onBranchChange(callback: () => void): () => void;
};

type FooterTheme = {
  fg(role: any, text: string): string;
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

type FooterSettings = {
  reload(): Promise<void>;
  getCompactionSettings(model?: { provider: string; id: string }): { enabled: boolean; reserveTokens: number };
};

export default function customFooter(
  pi: ExtensionAPI,
  loadSettings: (cwd: string, trusted: boolean) => FooterSettings = (cwd, trusted) =>
    SettingsManager.create(cwd, undefined, { projectTrusted: trusted }),
) {
  const slots = createFooterSlotRegistry(pi.events);
  let tuiRef: { requestRender(): void } | null = null;
  let footerDataRef: FooterData | null = null;
  let responseEndedAt: number | null = null;
  let instructionFolder: string | undefined;
  let settings: FooterSettings | undefined;
  let responseAgeTimer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (responseAgeTimer) clearInterval(responseAgeTimer);
    responseAgeTimer = undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    settings = loadSettings(ctx.cwd, ctx.isProjectTrusted());
    instructionFolder = undefined;
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
            const statuses = footerDataRef?.getExtensionStatuses() ?? new Map<string, string>();
            const { core, aux } = partitionFooterStatuses(statuses, slots.placements);
            const lines = [renderLine1(width, theme, ctx, orderedStatusValues(core, slots.priorities))];
            const separator = theme.fg("dim", "  ·  ");
            const priorities = new Map(slots.priorities);
            if (!priorities.has("mcp")) priorities.set("mcp", 80);
            if (responseEndedAt !== null) {
              aux.set("response-age", theme.fg("dim", formatResponseTime(responseEndedAt)));
              priorities.set("response-age", -1);
            }
            const slotLine = packFooterStatuses(aux, priorities, width, separator);
            if (slotLine) lines.push(slotLine);
            return lines;
          },
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );
    slots.announceHost();
  });

  pi.on("before_agent_start", async (event) => {
    instructionFolder = nearestAgentsFolder(event.systemPromptOptions.contextFiles, event.systemPromptOptions.cwd);
    await settings?.reload();
    tuiRef?.requestRender();
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
    instructionFolder = undefined;
    settings = undefined;
  });

  function renderLine1(
    width: number,
    theme: FooterTheme,
    ctx: {
      cwd: string;
      getContextUsage(): { percent: number | null; tokens: number | null; contextWindow: number } | null | undefined;
      model: { provider?: string; id?: string; contextWindow?: number } | null | undefined;
    },
    coreValues: readonly string[],
  ): string {
    const separator = theme.fg("dim", " │ ");
    const separatorWidth = 3;
    const branch = footerDataRef?.getGitBranch();
    const icon = "󱂵 ";
    const pathRaw = buildPathString(instructionFolder ?? "…", branch ?? null);

    const usage = ctx.getContextUsage();
    const percent = usage?.percent ?? 0;
    const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const activeModel = ctx.model?.provider && ctx.model.id
      ? { provider: ctx.model.provider, id: ctx.model.id }
      : undefined;
    const context = renderContextUsage(percent, contextWindow, usage?.tokens ?? null, theme,
      settings?.getCompactionSettings(activeModel));

    const provider = ctx.model?.provider || "unknown";
    const modelName = ctx.model?.id || "no-model";
    const model = renderModelInfo(modelName, provider, pi.getThinkingLevel(), theme);
    const coreWidth = coreValues.reduce((sum, value) => sum + separatorWidth + visibleWidth(value), 0);
    const rightBlockWidth = model.rawWidth + separatorWidth + visibleWidth(context) + coreWidth;
    const pathBudget = width - 1 - rightBlockWidth - separatorWidth;
    const pathDisplay = renderPath(pathRaw, pathBudget - visibleWidth(icon), theme);

    const segments: string[] = [];
    if (pathDisplay) segments.push(theme.fg("text", icon) + pathDisplay);
    segments.push(model.text, context, ...coreValues);
    return truncateToWidth(` ${segments.join(separator)}`, width);
  }
}
