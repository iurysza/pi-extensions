import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type CacheLane,
  cacheLaneKey,
  lastUsedLane,
  predictCacheSwitchImpact,
  recordAssistantUsage,
  scanCacheHistory,
} from "./src/predictor.js";
import {
  CACHE_WARNING_ICON,
  cacheMayBeStale,
  cacheWarmTimestamp,
  idleThresholdMs,
} from "./src/freshness.js";
import { createFooterSlotRegistration } from "./src/footer-slot.js";

const STATUS_KEY = "pi-cache-hit-predictor";

interface ModelIdentity {
  provider: string;
  api: string;
  id: string;
}

function laneFor(model: ModelIdentity, thinkingLevel: string): CacheLane {
  return {
    provider: model.provider,
    api: model.api,
    model: model.id,
    thinkingLevel,
  };
}

function sameLane(left: CacheLane, right: CacheLane): boolean {
  return cacheLaneKey(left) === cacheLaneKey(right);
}

export default function cacheHitPredictor(pi: ExtensionAPI) {
  const footerSlot = createFooterSlotRegistration(pi.events, STATUS_KEY, 200);
  let history = scanCacheHistory([]);
  let pendingPredictionTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let displayedLane: CacheLane | undefined;
  let selectedLane: CacheLane | undefined;
  // Keep the source anchored to a real response, not intermediate selections.
  let activeLane: CacheLane | undefined;
  let thresholdMs = idleThresholdMs(process.env.PI_CACHE_IDLE_MINUTES);
  let lastStatus: string | undefined;

  const renderStatus = (ctx: ExtensionContext) => {
    const snapshot = selectedLane && history.lanes.get(cacheLaneKey(selectedLane));
    const stale = cacheMayBeStale(snapshot?.refreshedAt, Date.now(), thresholdMs);
    const text = ctx.mode === "tui" && (displayedLane || stale)
      ? ctx.ui.theme.fg("warning", CACHE_WARNING_ICON)
      : undefined;
    if (text !== lastStatus) {
      ctx.ui.setStatus(STATUS_KEY, text);
      lastStatus = text;
    }
  };

  const clearTimers = () => {
    if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
    if (idleTimer) clearInterval(idleTimer);
    pendingPredictionTimer = undefined;
    idleTimer = undefined;
  };

  const reset = (ctx: ExtensionContext) => {
    clearTimers();
    displayedLane = undefined;
    lastStatus = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    history = scanCacheHistory(ctx.sessionManager.getBranch(), pi.getThinkingLevel());
    activeLane = lastUsedLane(ctx.sessionManager.getBranch(), pi.getThinkingLevel());
    selectedLane = ctx.model ? laneFor(ctx.model, pi.getThinkingLevel()) : undefined;
    thresholdMs = idleThresholdMs(process.env.PI_CACHE_IDLE_MINUTES);
    renderStatus(ctx);
    if (ctx.mode !== "tui" || thresholdMs === 0) return;
    idleTimer = setInterval(() => {
      // Pi's warmer persists successful refreshes without emitting message_end.
      const entries = ctx.sessionManager.getBranch();
      const snapshot = activeLane && history.lanes.get(cacheLaneKey(activeLane));
      if (snapshot) {
        for (let index = entries.length - 1; index >= 0; index--) {
          const entry = entries[index];
          if (Date.parse(entry.timestamp) <= (snapshot.refreshedAt ?? 0)) break;
          const warmedAt = cacheWarmTimestamp(entry, activeLane);
          if (warmedAt !== undefined) {
            snapshot.refreshedAt = warmedAt;
            break;
          }
        }
      }
      renderStatus(ctx);
    }, 1000);
    idleTimer.unref?.();
  };

  const showImpact = (ctx: ExtensionContext, dest: CacheLane) => {
    selectedLane = dest;
    displayedLane = undefined;
    if (activeLane && !sameLane(activeLane, dest)) {
      const usage = ctx.getContextUsage();
      const impact = predictCacheSwitchImpact(
        history, activeLane, dest, usage?.tokens ?? null,
        usage?.contextWindow ?? ctx.model?.contextWindow ?? null,
      );
      if (impact.lostTokens > 0) displayedLane = dest;
    }
    renderStatus(ctx);
  };

  const schedulePrediction = (
    ctx: ExtensionContext,
    model: ModelIdentity,
    thinkingLevel: string,
  ) => {
    const dest = laneFor(model, thinkingLevel);
    if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
    pendingPredictionTimer = setTimeout(() => {
      pendingPredictionTimer = undefined;
      showImpact(ctx, dest);
    }, 0);
  };

  pi.on("session_start", async (_event, ctx) => {
    footerSlot.register();
    reset(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => reset(ctx));
  pi.on("session_compact", async (_event, ctx) => reset(ctx));

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant"
      || event.message.stopReason === "aborted"
      || event.message.stopReason === "error") return;
    const responseLane = laneFor({
      provider: event.message.provider,
      api: event.message.api,
      id: event.message.model,
    }, pi.getThinkingLevel());
    recordAssistantUsage(history, event.message, responseLane);
    activeLane = responseLane;
    if (!selectedLane) selectedLane = responseLane;
    if (displayedLane && sameLane(displayedLane, responseLane)) displayedLane = undefined;
    renderStatus(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (event.level === event.previousLevel || !ctx.model) return;
    schedulePrediction(ctx, ctx.model, event.level);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "restore" || !event.previousModel) {
      if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
      pendingPredictionTimer = undefined;
      displayedLane = undefined;
      selectedLane = laneFor(event.model, pi.getThinkingLevel());
      renderStatus(ctx);
      return;
    }
    schedulePrediction(ctx, event.model, pi.getThinkingLevel());
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearTimers();
    displayedLane = undefined;
    selectedLane = undefined;
    lastStatus = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
    footerSlot.dispose();
  });
}
