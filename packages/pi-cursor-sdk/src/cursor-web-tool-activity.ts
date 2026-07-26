import { getFirstStringByKeys } from "./cursor-record-utils.js";
import {
	classifyCursorWebToolKind,
	normalizeCursorToolName as normalizeToolName,
} from "./cursor-tool-presentation-registry.js";

function getMcpToolName(args: Record<string, unknown>): string | undefined {
	const toolName = getFirstStringByKeys(args, ["toolName", "tool_name"]);
	const trimmed = toolName?.trim();
	return trimmed || undefined;
}

/**
 * Maps SDK/host/MCP tool names to transcript display keys.
 * Web search/fetch often arrives as MCP `toolName` values, not dedicated SDK ToolTypes.
 */
export function resolveTranscriptToolName(rawName: string, args: Record<string, unknown>): string {
	const normalized = normalizeToolName(rawName);
	const directWebKind = classifyCursorWebToolKind(rawName) ?? classifyCursorWebToolKind(normalized);
	if (directWebKind) return directWebKind;
	if (normalized === "mcp") {
		const mcpWebKind = classifyCursorWebToolKind(getMcpToolName(args));
		if (mcpWebKind) return mcpWebKind;
	}
	return normalized;
}
