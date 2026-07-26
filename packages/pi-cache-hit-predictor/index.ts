import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type CacheLane,
  type CachePrediction,
  predictCacheHit,
  recordAssistantUsage,
  scanCacheHistory,
} from "./src/predictor.js";
import { createFooterSlotRegistration } from "./src/footer-slot.js";

const STATUS_KEY = "pi-cache-hit-predictor";

interface ModelIdentity {
  provider: string;
  api: string;
  id: string;
}

function formatTokens(tokens: number): string {
  if (tokens < 1_000) return Math.round(tokens).toString();
  if (tokens < 1_000_000) {
    return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  }
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}m`;
}

function predictionText(prediction: CachePrediction): string {
  const lane = `${prediction.lane.model} · ${prediction.lane.thinkingLevel}`;
  if (!prediction.hasLaneHistory) {
    const prompt = prediction.currentPromptTokens
      ? ` of ~${formatTokens(prediction.currentPromptTokens)}`
      : "";
    return `Cache hit prediction · ${lane}: cold lane (0%${prompt})`;
  }

  if (prediction.currentPromptTokens === null || prediction.percent === null) {
    return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} cached`;
  }
  return `Cache hit prediction · ${lane}: ~${formatTokens(prediction.estimatedCacheTokens)} / ~${formatTokens(prediction.currentPromptTokens)} (${Math.round(prediction.percent)}%) cached`;
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

  const rebuild = (ctx: ExtensionContext) => {
    history = scanCacheHistory(
      ctx.sessionManager.getBranch(),
      pi.getThinkingLevel(),
    );
  };

  const clearPrediction = (ctx: ExtensionContext) => {
    displayedLane = undefined;
    ctx.ui.setStatus(STATUS_KEY, undefined);
  };

  const appendPrediction = (
    ctx: ExtensionContext,
    model: ModelIdentity,
    thinkingLevel: string,
  ) => {
    if (ctx.mode !== "tui") return;
    const contextTokens = ctx.getContextUsage()?.tokens ?? null;
    const prediction = predictCacheHit(
      history,
      laneFor(model, thinkingLevel),
      contextTokens,
    );
    displayedLane = prediction.lane;
    ctx.ui.setStatus(STATUS_KEY, predictionText(prediction));
  };

  const schedulePrediction = (
    ctx: ExtensionContext,
    model: ModelIdentity,
    thinkingLevel: string,
  ) => {
    if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
    pendingPredictionTimer = setTimeout(() => {
      pendingPredictionTimer = undefined;
      appendPrediction(ctx, model, thinkingLevel);
    }, 0);
  };

  pi.on("session_start", async (_event, ctx) => {
    footerSlot.register();
    clearPrediction(ctx);
    rebuild(ctx);
  });
  pi.on("session_tree", async (_event, ctx) => {
    clearPrediction(ctx);
    rebuild(ctx);
  });
  pi.on("session_compact", async (_event, ctx) => {
    clearPrediction(ctx);
    rebuild(ctx);
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const selected = ctx.model;
    recordAssistantUsage(
      history,
      event.message,
      laneFor(
        selected?.provider === event.message.provider
          && selected.id === event.message.model
          && selected.api === event.message.api
          ? selected
          : {
              provider: event.message.provider,
              api: event.message.api,
              id: event.message.model,
            },
        pi.getThinkingLevel(),
      ),
    );
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    if (event.level === event.previousLevel || !ctx.model) return;
    schedulePrediction(ctx, ctx.model, event.level);
  });

  pi.on("model_select", async (event, ctx) => {
    if (event.source === "restore" || !event.previousModel) {
      if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
      pendingPredictionTimer = undefined;
      clearPrediction(ctx);
      return;
    }
    schedulePrediction(ctx, event.model, pi.getThinkingLevel());
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (event.status < 200 || event.status >= 300 || !displayedLane || !ctx.model) return;
    const destinationLane = laneFor(ctx.model, pi.getThinkingLevel());
    if (sameLane(displayedLane, destinationLane)) clearPrediction(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    if (pendingPredictionTimer) clearTimeout(pendingPredictionTimer);
    pendingPredictionTimer = undefined;
    clearPrediction(ctx);
    footerSlot.dispose();
  });
}
