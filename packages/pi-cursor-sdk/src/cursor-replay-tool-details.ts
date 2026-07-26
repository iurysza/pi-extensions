import { asRecord, getBoolean, getNumber, getString } from "./cursor-record-utils.js";
import { isCursorReplayActivitySourceName, type CursorReplayActivitySourceName } from "./cursor-replay-source-names.js";

/** Replay detail variants keyed by replay card disposition, not SDK source tool alone. */
export type CursorReplayToolDetailsVariant =
	| "nativeEdit"
	| "nativeWrite"
	| "activity"
	| "generateImage"
	| "genericFallback";

/**
 * Sentinel source tool name for activity cards whose SDK name is not a known registry entry.
 * Display identity lives in `title` and replay args.
 */
export const CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME = "unregisteredActivity" as const;

/** SDK source tool names carried on neutral activity replay cards. */
export type CursorReplayActivitySourceToolName =
	| CursorReplayActivitySourceName
	| typeof CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;

declare const cursorReplayUnknownSourceToolNameBrand: unique symbol;

/** Opaque unknown/future Cursor tool names on generic-fallback replay cards. */
export type CursorReplayUnknownSourceToolName = string & {
	readonly [cursorReplayUnknownSourceToolNameBrand]: unique symbol;
};

export interface CursorReplayNativeEditDetails {
	variant: "nativeEdit";
	path?: string;
	linesAdded?: number;
	linesRemoved?: number;
	diffString?: string;
	diff?: string;
	firstChangedLine?: number;
	summary?: string;
	expandedText?: string;
}

export interface CursorReplayNativeWriteDetails {
	variant: "nativeWrite";
	path?: string;
	linesCreated?: number;
	fileSize?: number;
	fileContentAfterWrite?: string;
	expandedText?: string;
	summary?: string;
}

export interface CursorReplayGenerateImageDetails {
	variant: "generateImage";
	imagePath?: string;
	imageDisplayPath?: string;
	imageMimeType?: string;
	summary?: string;
	expandedText?: string;
	collapseDetailsByDefault?: boolean;
}

/** Neutral Cursor activity cards and unknown-tool fallbacks with a display title. */
export interface CursorReplayActivityDetails {
	variant: "activity";
	sourceToolName: CursorReplayActivitySourceToolName;
	title: string;
	summary?: string;
	expandedText?: string;
	collapseDetailsByDefault?: boolean;
	path?: string;
	fileSize?: number;
	/** Structured unified diff for edit (and similar) activity cards; drives canonical colored diff rendering. */
	diffString?: string;
	diff?: string;
	linesAdded?: number;
	linesRemoved?: number;
	/** Optional post-write content for write activity fallbacks (mirrors nativeWrite). */
	fileContentAfterWrite?: string;
}

/** Parsed replay details without a display title. */
export interface CursorReplayGenericFallbackDetails {
	variant: "genericFallback";
	sourceToolName: CursorReplayUnknownSourceToolName;
	summary?: string;
	expandedText?: string;
}

export type CursorReplayToolDetails =
	| CursorReplayNativeEditDetails
	| CursorReplayNativeWriteDetails
	| CursorReplayGenerateImageDetails
	| CursorReplayActivityDetails
	| CursorReplayGenericFallbackDetails;

export type CursorReplayActivityDetailFields = Pick<
	CursorReplayActivityDetails,
	| "summary"
	| "expandedText"
	| "collapseDetailsByDefault"
	| "path"
	| "fileSize"
	| "diffString"
	| "diff"
	| "linesAdded"
	| "linesRemoved"
	| "fileContentAfterWrite"
>;

export type CursorReplayGenerateImageDetailFields = Pick<
	CursorReplayGenerateImageDetails,
	"summary" | "expandedText" | "imagePath" | "imageDisplayPath" | "imageMimeType"
>;

function readSourceToolName(record: Record<string, unknown>): string | undefined {
	const sourceToolName = getString(record, "sourceToolName");
	return sourceToolName?.trim() ? sourceToolName.trim() : undefined;
}

function readVariant(record: Record<string, unknown>): string | undefined {
	const variant = getString(record, "variant");
	return variant?.trim() ? variant.trim() : undefined;
}

function parseCursorReplayNativeEditDetails(record: Record<string, unknown>): CursorReplayNativeEditDetails {
	return {
		variant: "nativeEdit",
		path: getString(record, "path"),
		linesAdded: getNumber(record, "linesAdded"),
		linesRemoved: getNumber(record, "linesRemoved"),
		diffString: getString(record, "diffString"),
		diff: getString(record, "diff"),
		firstChangedLine: getNumber(record, "firstChangedLine"),
		summary: getString(record, "summary"),
		expandedText: getString(record, "expandedText"),
	};
}

function parseCursorReplayNativeWriteDetails(record: Record<string, unknown>): CursorReplayNativeWriteDetails {
	return {
		variant: "nativeWrite",
		path: getString(record, "path"),
		linesCreated: getNumber(record, "linesCreated"),
		fileSize: getNumber(record, "fileSize"),
		fileContentAfterWrite: getString(record, "fileContentAfterWrite"),
		expandedText: getString(record, "expandedText"),
		summary: getString(record, "summary"),
	};
}

function parseCursorReplayGenerateImageDetails(record: Record<string, unknown>): CursorReplayGenerateImageDetails {
	const collapseDetailsByDefault = getBoolean(record, "collapseDetailsByDefault");
	return {
		variant: "generateImage",
		imagePath: getString(record, "imagePath"),
		imageDisplayPath: getString(record, "imageDisplayPath"),
		imageMimeType: getString(record, "imageMimeType"),
		summary: getString(record, "summary"),
		expandedText: getString(record, "expandedText"),
		...(collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault } : {}),
	};
}

function parseCursorReplayActivityDetails(
	record: Record<string, unknown>,
	sourceToolName: CursorReplayActivitySourceToolName,
	title: string,
): CursorReplayActivityDetails {
	return {
		variant: "activity",
		sourceToolName,
		title,
		summary: getString(record, "summary"),
		expandedText: getString(record, "expandedText"),
		collapseDetailsByDefault: getBoolean(record, "collapseDetailsByDefault"),
		path: getString(record, "path"),
		fileSize: getNumber(record, "fileSize"),
		diffString: getString(record, "diffString"),
		diff: getString(record, "diff"),
		linesAdded: getNumber(record, "linesAdded"),
		linesRemoved: getNumber(record, "linesRemoved"),
		fileContentAfterWrite: getString(record, "fileContentAfterWrite"),
	};
}

function brandCursorReplayUnknownSourceToolName(sourceToolName: string): CursorReplayUnknownSourceToolName {
	return sourceToolName as CursorReplayUnknownSourceToolName;
}

function parseCursorReplayGenericFallbackDetails(
	record: Record<string, unknown>,
	sourceToolName: string,
): CursorReplayGenericFallbackDetails {
	return {
		variant: "genericFallback",
		sourceToolName: brandCursorReplayUnknownSourceToolName(sourceToolName),
		summary: getString(record, "summary"),
		expandedText: getString(record, "expandedText"),
	};
}

function isCursorReplayActivitySourceToolName(name: string): name is CursorReplayActivitySourceToolName {
	if (name === CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME) return true;
	if (name === "generateImage") return false;
	return isCursorReplayActivitySourceName(name);
}

function resolveParseActivitySourceToolName(sourceToolName: string): CursorReplayActivitySourceToolName {
	return isCursorReplayActivitySourceToolName(sourceToolName)
		? sourceToolName
		: CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;
}

/** Maps incomplete or non-activity replay source names onto activity-card source tool names. */
export function resolveIncompleteReplayActivitySourceToolName(
	sourceToolName: string,
): CursorReplayActivitySourceToolName {
	if (sourceToolName === "generateImage") return CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME;
	return resolveParseActivitySourceToolName(sourceToolName);
}

function parseActivityVariantDetails(record: Record<string, unknown>): CursorReplayActivityDetails | undefined {
	const title = getString(record, "title")?.trim();
	if (!title) return undefined;
	return parseCursorReplayActivityDetails(
		record,
		resolveParseActivitySourceToolName(readSourceToolName(record) ?? CURSOR_REPLAY_UNREGISTERED_ACTIVITY_TOOL_NAME),
		title,
	);
}

export function parseCursorReplayToolDetails(value: unknown): CursorReplayToolDetails | undefined {
	const record = asRecord(value);
	if (!record) return undefined;
	switch (readVariant(record)) {
		case "nativeEdit":
			return parseCursorReplayNativeEditDetails(record);
		case "nativeWrite":
			return parseCursorReplayNativeWriteDetails(record);
		case "generateImage":
			return parseCursorReplayGenerateImageDetails(record);
		case "activity":
			return parseActivityVariantDetails(record);
		case "genericFallback":
			return parseCursorReplayGenericFallbackDetails(record, readSourceToolName(record) ?? "tool");
		default:
			return undefined;
	}
}

export function assembleCursorReplayActivityDetails(
	sourceToolName: CursorReplayActivitySourceToolName,
	title: string,
	fields: CursorReplayActivityDetailFields,
	contentText: string,
	isError: boolean,
	activitySummary: string | undefined,
): CursorReplayActivityDetails {
	const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
	return {
		variant: "activity",
		sourceToolName,
		title,
		summary,
		expandedText: fields.expandedText ?? contentText,
		...(fields.collapseDetailsByDefault !== undefined ? { collapseDetailsByDefault: fields.collapseDetailsByDefault } : {}),
		...(fields.path !== undefined ? { path: fields.path } : {}),
		...(fields.fileSize !== undefined ? { fileSize: fields.fileSize } : {}),
		...(fields.diffString !== undefined ? { diffString: fields.diffString } : {}),
		...(fields.diff !== undefined ? { diff: fields.diff } : {}),
		...(fields.linesAdded !== undefined ? { linesAdded: fields.linesAdded } : {}),
		...(fields.linesRemoved !== undefined ? { linesRemoved: fields.linesRemoved } : {}),
		...(fields.fileContentAfterWrite !== undefined ? { fileContentAfterWrite: fields.fileContentAfterWrite } : {}),
	};
}

export const CURSOR_REPLAY_GENERATE_IMAGE_RESULT_TITLE = "Cursor image generation" as const;

export function assembleCursorReplayGenerateImageDetails(
	fields: CursorReplayGenerateImageDetailFields,
	contentText: string,
	isError: boolean,
	activitySummary: string | undefined,
): CursorReplayGenerateImageDetails {
	const summary = isError ? fields.summary : (fields.summary ?? activitySummary);
	return {
		variant: "generateImage",
		imagePath: fields.imagePath,
		imageDisplayPath: fields.imageDisplayPath,
		imageMimeType: fields.imageMimeType,
		summary,
		expandedText: fields.expandedText ?? contentText,
	};
}

export function isCursorReplayNativeEditDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayNativeEditDetails {
	return details.variant === "nativeEdit";
}

export function isCursorReplayNativeWriteDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayNativeWriteDetails {
	return details.variant === "nativeWrite";
}

export function isCursorReplayGenerateImageDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayGenerateImageDetails {
	return details.variant === "generateImage";
}

export function isCursorReplayActivityDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayActivityDetails {
	return details.variant === "activity";
}

export function isCursorReplayGenericFallbackDetails(
	details: CursorReplayToolDetails,
): details is CursorReplayGenericFallbackDetails {
	return details.variant === "genericFallback";
}
