export function extractContentText(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((block) => typeof block?.text === "string" ? block.text : JSON.stringify(block)).join("\n");
}

export function extractFinalTextContent(content) {
	if (typeof content === "string") return content.trim().length > 0 ? content : "";
	if (!Array.isArray(content)) return "";
	for (let index = content.length - 1; index >= 0; index--) {
		const block = content[index];
		const text = typeof block?.text === "string" ? block.text : undefined;
		if (text?.trim()) return text;
	}
	return "";
}

export function getAssistantFinalText(message) {
	return message?.role === "assistant" ? extractFinalTextContent(message.content) : "";
}

export function jsonlHasAssistantFinalTextMarker(jsonlRaw, finalMarker) {
	if (!finalMarker) return true;
	for (const line of jsonlRaw.split(/\r?\n/)) {
		if (!line.trim()) continue;
		let event;
		try { event = JSON.parse(line); } catch { continue; }
		if (getAssistantFinalText(event?.message).includes(finalMarker)) return true;
	}
	return false;
}
