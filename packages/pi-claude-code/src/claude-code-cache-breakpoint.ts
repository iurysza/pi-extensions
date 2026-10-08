type Block = Record<string, unknown>;
type Message = { role?: unknown; content?: unknown };

/**
 * Moves the single message-level cache marker onto the last block of the last non-`system`
 * message. Claude Code 2.1.282 marks a trailing `role: "system"` date reminder that the next
 * Turn never replays, so its cache write would never be read. Nothing else in the body changes.
 */
export function pinCacheBreakpoint(body: Buffer): Buffer {
	let payload: { messages?: unknown };
	try {
		payload = JSON.parse(body.toString("utf8"));
	} catch {
		return body;
	}
	if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) return body;
	const messages = payload.messages as Message[];

	let marked: Block | undefined;
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content as Block[]) {
			if (block && typeof block === "object" && block.cache_control) marked = block;
		}
	}
	if (!marked) return body;

	const target = [...messages].reverse().find((message) => message?.role !== "system");
	if (!target) return body;
	if (typeof target.content === "string") target.content = [{ type: "text", text: target.content }];
	if (!Array.isArray(target.content) || target.content.length === 0) return body;
	const last = target.content[target.content.length - 1] as Block;
	if (!last || typeof last !== "object" || last === marked) return body;

	last.cache_control = marked.cache_control;
	delete marked.cache_control;
	return Buffer.from(JSON.stringify(payload), "utf8");
}
