import {
	getCurrentSystemPrompt,
	getCurrentTools,
	type Context,
	type TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * Pi 1.0 hands providers a normalized transcript: the prompt and tool declarations live in system
 * messages. The Cursor provider internals still read `systemPrompt` and `tools`, so fold the
 * transcript back into that shape once, at the provider boundary. Plain contexts pass through.
 */
export function toCursorContext(context: Context | TranscriptContext): Context {
	if (!context.messages.some((message) => message.role === "system")) return context as Context;
	const systemPrompt = getCurrentSystemPrompt(context.messages);
	const tools = getCurrentTools(context.messages);
	return {
		...(systemPrompt ? { systemPrompt } : {}),
		messages: context.messages.filter((message) => message.role !== "system"),
		...(tools.length > 0 ? { tools } : {}),
	};
}
