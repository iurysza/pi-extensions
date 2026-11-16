import type { Context } from "@earendil-works/pi-ai";

/** Tool names from the provider context snapshot at stream start (not live pi.getActiveTools()). */
export function getActiveContextToolNames(context: Context): ReadonlySet<string> | undefined {
	return context.tools ? new Set(context.tools.map((tool) => tool.name)) : undefined;
}

/**
 * True when the request states an empty tool list, as pi compaction summaries do. Pi rejects any
 * tool call in those answers, so the provider must not surface one. A context without a `tools`
 * field says nothing about tools and keeps the default routing.
 */
export function contextForbidsTools(context: Context): boolean {
	return context.tools !== undefined && context.tools.length === 0;
}
