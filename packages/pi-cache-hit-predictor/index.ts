import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type CacheLane,
  type CachePrediction,
  CACHE_ICON,
  formatTokens,
  lastUsedLane,
  predictCacheHit,
  predictCacheSwitchImpact,
  recordAssistantUsage,
  renderSwitchImpact,
  scanCacheHistory,
} from "./src/predictor.js";
import { createFooterSlotRegistration } from "./src/footer-slot.js";

const STATUS_KEY = "pi-cache-hit-predictor";

interface ModelIdentity {
  provider: string;
  api: string;
  id: string;
}

function predictionText(prediction: CachePrediction): string {
  if (!prediction.hasLaneHistory) return `${CACHE_ICON} cold`;

  if (prediction.currentPromptTokens === null || prediction.percent === null) {
    return `${CACHE_ICON} ~${formatTokens(prediction.estimatedCacheTokens)}`;
  }
  return `${CACHE_ICON} ~${formatTokens(prediction.estimatedCacheTokens)}/~${formatTokens(prediction.currentPromptTokens)} ${Math.round(prediction.percent)}%`;
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
  return left.provider === right.provider
    && left.api === right.api
    && left.model === right.model
    && left.thinkingLevel === right.thinkingLevel;
}

export default function cacheHitPredictor(pi: ExtensionAPI) {
  const footerSlot = createFooterSlotRegistration(pi.events, STATUS_KEY, 200);
  let history = scanCacheHistory([]);
  let pendingPredictionTimer: ReturnType<typeof setTimeout> | undefined;
  let displayedLane: CacheLane | undefined;
  let activeLane: CacheLane | undefined;

  const rebuild = (ctx: ExtensionContext) => {
    history = scanCacheHistory(
      ctx.sessionManager.getBranch(),
      pi.getThinkingLevel(),
    );
  };

  const setCurrentLane = (model: ModelIdentity) => {
    activeLane = laneFor(model, pi.getThinkingLevel());
  };

  const setActiveLaneFromHistory = (ctx: ExtensionContext) => {
    activeLane = lastUsedLane(ctx.sessionManager.getBranch());
  };

  const clearPrediction = (ctx: ExtensionContext) => {
    displayedLane = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  };

  const legacyPredictionText = (
    ctx: ExtensionContext,
    lane: CacheLane,
  ): string => {
    const contextTokens = ctx.getContextUsage()?.tokens ?? null;
    const prediction = predictCacheHit(history, lane, contextTokens);
    return predictionText(prediction);
  };

  const renderImpact = (ctx: ExtensionContext, dest: CacheLane): string | undefined => {
    if (ctx.mode !== "tui") return undefined;
    if (!activeLane || sameLane(activeLane, dest)) return undefined;

    const contextUsage = ctx.getContextUsage();
    const currentPromptTokens = contextUsage?.tokens ?? null;
    const contextWindow = contextUsage?.contextWindow
      ?? ctx.model?.contextWindow
      ?? null;

    const impact = predictCacheSwitchImpact(
      history,
      activeLane,
      dest,
      currentPromptTokens,
      contextWindow,
    );

    if (impact.sourceTokens === 0 && impact.destTokens === 0) {
      return undefined;
    }

    if (currentPromptTokens === null || contextWindow === null) {
      return legacyPredictionText(ctx, dest);
    }

    return renderSwitchImpact(impact);
  };

  const showImpact = (ctx: ExtensionContext, dest: CacheLane) => {
    const text = renderImpact(ctx, dest);
    if (text) {
      displayedLane = dest;
      ctx.ui.setStatus(STATUS_KEY, text);
    } else {
      clearPrediction(ctx);
    }
    activeLane = dest;
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
    clearPrediction(ctx);
    rebuild(ctx);
    setActiveLaneFromHistory(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    clearPrediction(ctx);
    rebuild(ctx);
    setActiveLaneFromHistory(ctx);
  });
  pi.on("session_compact", async (_event, ctx) => {
    clearPrediction(ctx);
    rebuild(ctx);
    setActiveLaneFromHistory(ctx);
  });


  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const responseLane = laneFor({
      provider: event.message.provider,
      api: event.message.api,
      id: event.message.model,
    }, pi.getThinkingLevel());
    recordAssistantUsage(history, event.message, responseLane);
    activeLane = responseLane;
    if (
      displayedLane
      && event.message.stopReason !== "aborted"
      && event.message.stopReason !== "error"
      && sameLane(displayedLane, responseLane)
    ) clearPrediction(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (event.level === event.previousLevel || !ctx.model) return;
    schedulePrediction(ctx, ctx.model, event.level);
  });

  pi.on("model_select", async (event, ctx) => {
    if (!ctx.model) return;
    if (event.source === "restore" || !event.previousModel) {
      if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
      pendingPredictionTimer = undefined;
      clearPrediction(ctx);
      setCurrentLane(event.model);
      return;
    }
    schedulePrediction(ctx, event.model, pi.getThinkingLevel());
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
    pendingPredictionTimer = undefined;
    clearPrediction(ctx);
    footerSlot.dispose();
  });
}
