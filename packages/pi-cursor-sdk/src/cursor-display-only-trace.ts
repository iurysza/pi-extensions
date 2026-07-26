import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

function withDisplayOnlyThinking(partial: AssistantMessage, thinking: string): AssistantMessage {
	return { ...partial, content: [...partial.content, { type: "thinking", thinking }] };
}

export function emitDisplayOnlyTraceBlock(stream: AssistantMessageEventStream, partial: AssistantMessage, text: string): void {
	const traceText = text.endsWith("\n") ? text : `${text}\n`;
	const contentIndex = partial.content.length;
	stream.push({ type: "thinking_start", contentIndex, partial: withDisplayOnlyThinking(partial, "") });
	const displayPartial = withDisplayOnlyThinking(partial, traceText);
	stream.push({ type: "thinking_delta", contentIndex, delta: traceText, partial: displayPartial });
	stream.push({ type: "thinking_end", contentIndex, content: traceText, partial: displayPartial });
}
