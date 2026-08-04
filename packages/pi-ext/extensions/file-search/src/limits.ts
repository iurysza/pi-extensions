// Pi's built-in tool boundary and the approved reference-compatible tripwires.
// Release asset receipts are recorded in tests and the implementation handoff.
export const PREVIEW_MAX_LINES = 2_000;
export const PREVIEW_MAX_BYTES = 50_000;
export const STDERR_MAX_BYTES = 64 * 1024;
export const ARCHIVE_MAX_BYTES = 25 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 10;
export const SEARCH_TIMEOUT_MS = 60_000;
export const PROBE_TIMEOUT_MS = 5_000;

export const FD_DEFAULT_LIMIT = 1_000;
export const FD_MAX_LIMIT = 10_000;
export const FD_MAX_DEPTH = 64;
export const RG_DEFAULT_LIMIT = 100;
export const RG_MAX_LIMIT = 1_000;
export const RG_MAX_CONTEXT = 20;

export function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.trunc(value)));
}
