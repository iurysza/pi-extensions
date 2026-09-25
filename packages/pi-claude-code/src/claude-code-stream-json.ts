import type { NativeBlock } from "./claude-code-request.js";

export type CliResult = {
	type: "result";
	subtype?: string;
	is_error?: boolean;
	num_turns?: number;
	result?: string;
	stop_reason?: string | null;
};

export type CliEvent =
	| CliResult
	| { type: "assistant"; error?: string; message?: { content?: NativeBlock[] } }
	| { type: "control_response"; response?: { subtype?: string; request_id?: string; response?: unknown; error?: string } }
	| { type: "other" };

export type CliLine = { ok: true; event: CliEvent } | { ok: false; line: string };

/** Parses one stdout line; blank lines yield undefined. */
export function parseCliLine(line: string): CliLine | undefined {
	const trimmed = line.trim();
	if (!trimmed) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(trimmed);
	} catch {
		return { ok: false, line: trimmed.slice(0, 300) };
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, line: trimmed.slice(0, 300) };
	const record = value as Record<string, unknown>;
	if (record.type === "result" || record.type === "assistant" || record.type === "control_response") {
		return { ok: true, event: record as CliEvent };
	}
	return { ok: true, event: { type: "other" } };
}

export function assistantText(event: Extract<CliEvent, { type: "assistant" }>): string {
	return (event.message?.content ?? [])
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}
