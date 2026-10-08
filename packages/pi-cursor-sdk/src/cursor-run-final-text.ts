import type { AssistantMessage } from "@earendil-works/pi-ai";
import { asRecord, hasUsableText } from "./cursor-record-utils.js";

function isCursorTextBoundary(text: string, index: number): boolean {
	if (index <= 0 || index >= text.length) return true;
	const before = text[index - 1];
	const after = text[index];
	return !/[\p{L}\p{N}_]/u.test(before) || !/[\p{L}\p{N}_]/u.test(after);
}

function trimAlreadyEmittedCursorText(text: string, emittedText: string, options?: { allowPartialPrefix?: boolean }): string {
	if (!text || !emittedText) return text;
	if (text === emittedText) return "";
	if (text.startsWith(emittedText) && (options?.allowPartialPrefix || isCursorTextBoundary(text, emittedText.length))) {
		return text.slice(emittedText.length);
	}
	if (emittedText.endsWith(text) && isCursorTextBoundary(emittedText, emittedText.length - text.length)) return "";
	const trimmedText = text.trim();
	const trimmedEmittedText = emittedText.trim();
	if (trimmedText === trimmedEmittedText) return "";
	if (trimmedText && trimmedEmittedText.endsWith(trimmedText)) {
		const suffixStart = trimmedEmittedText.length - trimmedText.length;
		if (isCursorTextBoundary(trimmedEmittedText, suffixStart)) return "";
	}
	return text;
}

export function trimCurrentTurnAlreadyEmittedCursorText(
	text: string,
	currentTurnEmittedText: string,
	emittedText = currentTurnEmittedText,
): string {
	if (!currentTurnEmittedText) return trimAlreadyEmittedCursorText(text, emittedText);
	const currentTurnTrimmedText = trimAlreadyEmittedCursorText(text, currentTurnEmittedText, { allowPartialPrefix: true });
	if (currentTurnTrimmedText !== text) return currentTurnTrimmedText;
	if (emittedText.endsWith(currentTurnEmittedText)) {
		const emittedTextTrimmedText = trimAlreadyEmittedCursorText(text, emittedText, { allowPartialPrefix: true });
		if (emittedTextTrimmedText !== text) return emittedTextTrimmedText;
	}
	return trimAlreadyEmittedCursorText(text, emittedText);
}

export function getFinalAssistantText(message: Pick<AssistantMessage, "content">): string {
	for (let index = message.content.length - 1; index >= 0; index--) {
		const block = asRecord(message.content[index]);
		if (block?.type !== "text" || typeof block.text !== "string") continue;
		if (hasUsableText(block.text)) return block.text;
	}
	return "";
}

export function selectCursorFinalText(
	resultText: unknown,
	textDeltas: readonly string[],
	emittedText: string,
	fallbackText?: string,
	options?: { allowPartialPrefix?: boolean },
): string {
	const candidates = [typeof resultText === "string" ? resultText : undefined, fallbackText, textDeltas.join("")];
	for (const candidate of candidates) {
		if (!hasUsableText(candidate)) continue;
		const trimmedCandidate = trimAlreadyEmittedCursorText(candidate, emittedText, options);
		if (hasUsableText(trimmedCandidate)) return trimmedCandidate;
	}
	return "";
}
