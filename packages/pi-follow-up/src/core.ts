export type ConversationMessage = {
  readonly role: "user" | "assistant";
  readonly text: string;
};

export function visibleUnicodeCharacterCount(text: string): number {
  return Array.from(text).length;
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item): item is { type: "text"; text: string } =>
      Boolean(item) &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
    )
    .map((item) => item.text)
    .join("\n");
}

export function recentConversation(
  messages: readonly ConversationMessage[],
  count: number,
): readonly ConversationMessage[] {
  return messages.filter((message) => message.text.length > 0).slice(-count);
}

export function parseSuggestions(
  value: unknown,
  expectedCount: number,
): readonly string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.hasOwn(record, "suggestions")) return undefined;
  if (!Array.isArray(record.suggestions) || record.suggestions.length !== expectedCount) return undefined;

  const suggestions = record.suggestions.map((suggestion) =>
    typeof suggestion === "string" ? suggestion.trim() : "",
  );
  if (suggestions.some((suggestion) => suggestion.length === 0)) return undefined;
  if (new Set(suggestions.map((suggestion) => suggestion.toLocaleLowerCase())).size !== suggestions.length) {
    return undefined;
  }
  return suggestions;
}
