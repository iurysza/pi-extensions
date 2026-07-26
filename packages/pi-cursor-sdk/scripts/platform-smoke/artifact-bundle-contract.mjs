/**
 * Platform artifact bundle contract — transport markers, path rules, size caps, and the
 * canonical exact-size base64 decoder shared by the writer, extractor, and remote chunk transport.
 */

export const PLATFORM_ARTIFACT_BUNDLE_START = "PLATFORM_LIVE_BUNDLE_JSON_START";
export const PLATFORM_ARTIFACT_BUNDLE_END = "PLATFORM_LIVE_BUNDLE_JSON_END";
export const PLATFORM_ARTIFACT_BUNDLE_FILE_MARKER = "PLATFORM_LIVE_BUNDLE_FILE_JSON=";
export const PLATFORM_ARTIFACT_BUNDLE_PATH = ".platform-artifact-bundle.gz";

export const MAX_BUNDLE_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_COMPRESSED_BUNDLE_BYTES = 20 * 1024 * 1024;
export const MAX_INFLATED_BUNDLE_JSON_BYTES = 64 * 1024 * 1024;
export const MAX_BUNDLE_FILE_COUNT = 512;
export const MAX_BUNDLE_AGGREGATE_BYTES = 40 * 1024 * 1024;
export const MAX_BUNDLE_PATH_BYTES = 4096;
export const MAX_BUNDLE_PATH_COMPONENTS = 4096;

/**
 * Decode base64 only when it is the canonical (shortest, correctly padded) encoding of
 * exactly `exactDecodedSize` bytes — rejects re-encodings that round-trip to a different string.
 */
export function decodeCanonicalBase64(value, exactDecodedSize) {
	if (typeof value !== "string" || value.length !== 4 * Math.ceil(exactDecodedSize / 3)) return undefined;
	const decoded = Buffer.from(value, "base64");
	return decoded.toString("base64") === value ? decoded : undefined;
}

/** A relative, forward-slash, dot-segment-free path — the only path shape a bundle may declare. */
export function isCanonicalPlatformBundlePath(path) {
	if (typeof path !== "string" || !path || Buffer.byteLength(path) > MAX_BUNDLE_PATH_BYTES || path.includes("\\") || path.includes("\0")) return false;
	if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
	return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
