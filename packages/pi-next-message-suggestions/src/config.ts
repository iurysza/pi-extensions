import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const DEFAULT_PROMPT = `Suggest the next user message for this conversation. Return exactly the requested number of concise, distinct, natural replies. They may be questions, confirmations, corrections, or useful next tasks. Do not explain your choices. Call the next_message_suggestions tool and provide only its suggestion strings.`;

export const DEFAULT_CONFIG = {
  threshold: 1_200,
  recentMessages: 3,
  count: 3,
  prompt: DEFAULT_PROMPT,
  provider: "openai-codex",
  model: "gpt-5.6-luna",
  thinking: "low" as ThinkingLevel,
} as const;

export type SuggestionsConfig = {
  readonly threshold: number;
  readonly recentMessages: number;
  readonly count: number;
  readonly prompt: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking: ThinkingLevel;
};

const THINKING_LEVELS = new Set<ThinkingLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

function positiveInteger(value: boolean | string | undefined, fallback: number): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function text(value: boolean | string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function thinking(value: boolean | string | undefined): ThinkingLevel {
  return typeof value === "string" && THINKING_LEVELS.has(value as ThinkingLevel)
    ? value as ThinkingLevel
    : DEFAULT_CONFIG.thinking;
}

export function registerSuggestionFlags(pi: ExtensionAPI): void {
  pi.registerFlag("next-message-suggestions-threshold", {
    type: "string",
    default: String(DEFAULT_CONFIG.threshold),
    description: "Visible assistant characters required before generating next-message suggestions.",
  });
  pi.registerFlag("next-message-suggestions-recent-messages", {
    type: "string",
    default: String(DEFAULT_CONFIG.recentMessages),
    description: "Recent user/assistant messages included in suggestion context.",
  });
  pi.registerFlag("next-message-suggestions-count", {
    type: "string",
    default: String(DEFAULT_CONFIG.count),
    description: "Number of next-message suggestions to generate.",
  });
  pi.registerFlag("next-message-suggestions-prompt", {
    type: "string",
    default: DEFAULT_CONFIG.prompt,
    description: "System prompt for next-message suggestion generation.",
  });
  pi.registerFlag("next-message-suggestions-provider", {
    type: "string",
    default: DEFAULT_CONFIG.provider,
    description: "Provider for next-message suggestion generation.",
  });
  pi.registerFlag("next-message-suggestions-model", {
    type: "string",
    default: DEFAULT_CONFIG.model,
    description: "Model for next-message suggestion generation.",
  });
  pi.registerFlag("next-message-suggestions-thinking", {
    type: "string",
    default: DEFAULT_CONFIG.thinking,
    description: "Thinking level for next-message suggestion generation.",
  });
}

export function readSuggestionConfig(pi: Pick<ExtensionAPI, "getFlag">): SuggestionsConfig {
  return {
    threshold: positiveInteger(pi.getFlag("next-message-suggestions-threshold"), DEFAULT_CONFIG.threshold),
    recentMessages: positiveInteger(pi.getFlag("next-message-suggestions-recent-messages"), DEFAULT_CONFIG.recentMessages),
    count: positiveInteger(pi.getFlag("next-message-suggestions-count"), DEFAULT_CONFIG.count),
    prompt: text(pi.getFlag("next-message-suggestions-prompt"), DEFAULT_CONFIG.prompt),
    provider: text(pi.getFlag("next-message-suggestions-provider"), DEFAULT_CONFIG.provider),
    model: text(pi.getFlag("next-message-suggestions-model"), DEFAULT_CONFIG.model),
    thinking: thinking(pi.getFlag("next-message-suggestions-thinking")),
  };
}
