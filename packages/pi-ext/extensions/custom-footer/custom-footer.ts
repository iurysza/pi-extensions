/**
 * Two-line custom footer.
 *
 * Line 1: context usage · model · core slots · integrations and response age.
 * Line 2: usage quota · working folder and git branch.
 * Ordinary setStatus() values remain visible as legacy priority-zero slots.
 */

import { SettingsManager, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import {
  buildPathString,
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

/** Usage-limit bar: line 2, before the folder. */
const QUOTA_SLOT = "pi-token-tank";

type FooterData = {
  getExtensionStatuses(): ReadonlyMap<string, string>;
  getGitBranch(): string | undefined;
  onBranchChange(callback: () => void): () => void;
};

type FooterTheme = {
  fg(role: any, text: string): string;
};

export function formatResponseTime(endedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - endedAt) / 1000));
  if (seconds < 60) return `󰋚 ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `󰋚 ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `󰋚 ${hours}h ago`;
  return `󰋚 ${Math.floor(hours / 24)}d ago`;
}

function lastResponseEndedAt(entries: readonly SessionEntry[]): number | null {
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "message" || entry.message.role !== "assistant"
      || entry.message.stopReason === "toolUse") continue;
    // Entry timestamps record when the completed message was appended.
    const endedAt = Date.parse(entry.timestamp);
    if (Number.isFinite(endedAt)) return endedAt;
  }
  return null;
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
  let settings: FooterSettings | undefined;
  let responseAgeTimer: ReturnType<typeof setInterval> | undefined;

  const clearTimer = () => {
    if (responseAgeTimer) clearInterval(responseAgeTimer);
    responseAgeTimer = undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    settings = loadSettings(ctx.cwd, ctx.isProjectTrusted());
    responseEndedAt = lastResponseEndedAt(ctx.sessionManager.getBranch());
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
            const { core, aux, context } = partitionFooterStatuses(statuses, slots.placements);
            const priorities = new Map(slots.priorities);
            if (!priorities.has("mcp")) priorities.set("mcp", 80);
            if (responseEndedAt !== null) {
              aux.set("response-age", theme.fg("dim", formatResponseTime(responseEndedAt)));
              priorities.set("response-age", -1);
            }
            const quota = aux.get(QUOTA_SLOT);
            aux.delete(QUOTA_SLOT);
            const line1 = renderLine1(width, theme, ctx,
              orderedStatusValues(core, slots.priorities),
              orderedStatusValues(context, slots.priorities));
            const separator = theme.fg("dim", "  ·  ");
            const auxLine = packFooterStatuses(aux, priorities, width - visibleWidth(line1) - 4, separator);
            return [
              auxLine ? `${line1}${theme.fg("dim", "  · ")}${auxLine}` : line1,
              renderLine2(width, theme, ctx.cwd, quota),
            ];
          },
          invalidate() {},
        };
      },
      { placement: "belowEditor" },
    );
    slots.announceHost();
  });

  pi.on("before_agent_start", async () => {
    await settings?.reload();
    tuiRef?.requestRender();
  });

  pi.on("session_tree", (_event, ctx) => {
    responseEndedAt = lastResponseEndedAt(ctx.sessionManager.getBranch());
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
    contextValues: readonly string[],
  ): string {
    const separator = theme.fg("dim", "  ·  ");
    const usage = ctx.getContextUsage();
    const percent = usage?.percent ?? 0;
    const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const activeModel = ctx.model?.provider && ctx.model.id
      ? { provider: ctx.model.provider, id: ctx.model.id }
      : undefined;
    const context = [renderContextUsage(percent, contextWindow, usage?.tokens ?? null, theme,
      settings?.getCompactionSettings(activeModel)), ...contextValues].join("  ");
    const model = renderModelInfo(ctx.model?.id || "no-model", pi.getThinkingLevel(), theme);
    const segments = [context, model.text, ...coreValues];
    return truncateToWidth(` ${segments.join(separator)}`, width);
  }

  function renderLine2(width: number, theme: FooterTheme, cwd: string, quota: string | undefined): string {
    const separator = theme.fg("dim", "  ·  ");
    const branch = footerDataRef?.getGitBranch();
    const icon = "󱂵 ";
    const branchLabel = branch ? ` 󰘬 ${branch}` : "";
    const lead = quota ? ` ${quota}` : "";
    const used = visibleWidth(lead) + (quota ? 5 : 1);
    const pathBudget = width - used - visibleWidth(icon) - visibleWidth(branchLabel);
    const path = pathBudget > 0 ? renderPath(buildPathString(cwd, null), pathBudget, theme) : "";
    const folder = path ? theme.fg("text", icon) + path + theme.fg("dim", branchLabel) : "";
    const parts = [lead.trimStart(), folder].filter(Boolean);
    return truncateToWidth(` ${parts.join(separator)}`, width);
  }
}
