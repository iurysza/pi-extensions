import { asRecord, firstNonEmptyString } from "./cursor-record-utils.js";

function getNestedMcpArgs(args: Record<string, unknown>): Record<string, unknown> {
	return asRecord(args.args) ?? {};
}

export function extractWebSearchQuery(args: Record<string, unknown>): string | undefined {
	const nested = getNestedMcpArgs(args);
	return firstNonEmptyString(
		typeof args.search_term === "string" ? args.search_term : undefined,
		typeof args.searchTerm === "string" ? args.searchTerm : undefined,
		typeof args.query === "string" ? args.query : undefined,
		typeof args.q === "string" ? args.q : undefined,
		typeof nested.search_term === "string" ? nested.search_term : undefined,
		typeof nested.searchTerm === "string" ? nested.searchTerm : undefined,
		typeof nested.query === "string" ? nested.query : undefined,
		typeof nested.q === "string" ? nested.q : undefined,
	);
}

export function extractWebFetchTarget(args: Record<string, unknown>): string | undefined {
	const nested = getNestedMcpArgs(args);
	return firstNonEmptyString(
		typeof args.url === "string" ? args.url : undefined,
		typeof args.uri === "string" ? args.uri : undefined,
		typeof args.href === "string" ? args.href : undefined,
		typeof nested.url === "string" ? nested.url : undefined,
		typeof nested.uri === "string" ? nested.uri : undefined,
		typeof nested.href === "string" ? nested.href : undefined,
	);
}
