import {
	assembleCursorReplayActivityDetails,
	assembleCursorReplayGenerateImageDetails,
	type CursorReplayActivitySourceToolName,
	type CursorReplayNativeEditDetails,
	type CursorReplayGenerateImageDetails,
	type CursorReplayGenericFallbackDetails,
	type CursorReplayActivityDetails,
	type CursorReplayNativeWriteDetails,
} from "../src/cursor-replay-tool-details.js";

type Expect<T extends true> = T;
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type NotExtends<A, B> = A extends B ? false : true;

type _variantNativeEdit = Expect<Equal<CursorReplayNativeEditDetails["variant"], "nativeEdit">>;
type _variantNativeWrite = Expect<Equal<CursorReplayNativeWriteDetails["variant"], "nativeWrite">>;
type _variantGenerateImage = Expect<Equal<CursorReplayGenerateImageDetails["variant"], "generateImage">>;
type _variantActivity = Expect<Equal<CursorReplayActivityDetails["variant"], "activity">>;
type _variantGenericFallback = Expect<Equal<CursorReplayGenericFallbackDetails["variant"], "genericFallback">>;
type _generateImageNotActivity = Expect<NotExtends<"generateImage", CursorReplayActivitySourceToolName>>;
type _mcpIsActivity = Expect<Equal<"mcp" extends CursorReplayActivitySourceToolName ? true : false, true>>;
type _editIsActivity = Expect<Equal<"edit" extends CursorReplayActivitySourceToolName ? true : false, true>>;
type _writeIsActivity = Expect<Equal<"write" extends CursorReplayActivitySourceToolName ? true : false, true>>;

// Compile-time regression: generateImage must use the dedicated generateImage variant.
const _rejectGenerateImageOnActivity: CursorReplayActivityDetails = {
	variant: "activity",
	// @ts-expect-error generateImage uses the dedicated generateImage variant
	sourceToolName: "generateImage",
	title: "Cursor image generation",
};

const _rejectEditOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error native edit disposition uses the dedicated nativeEdit variant
	sourceToolName: "edit",
};

const _rejectWriteOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error native write disposition uses the dedicated nativeWrite variant
	sourceToolName: "write",
};

const _rejectGenerateImageOnGenericFallback: CursorReplayGenericFallbackDetails = {
	variant: "genericFallback",
	// @ts-expect-error structured generateImage names use the dedicated generateImage variant
	sourceToolName: "generateImage",
};

const _rejectImageFieldsOnActivityDetails = assembleCursorReplayActivityDetails(
	"mcp",
	"Cursor MCP",
	{
		// @ts-expect-error image fields belong to assembleCursorReplayGenerateImageDetails
		imagePath: "/tmp/image.png",
	},
	"",
	false,
	undefined,
);

const _acceptGenerateImageDetails = assembleCursorReplayGenerateImageDetails(
	{ imagePath: "/tmp/image.png", imageMimeType: "image/png" },
	"",
	false,
	undefined,
);

const _acceptEditOnActivityDetails = assembleCursorReplayActivityDetails(
	"edit",
	"Cursor edit",
	{},
	"",
	false,
	undefined,
);

void _acceptEditOnActivityDetails;
void _acceptGenerateImageDetails;
void _rejectGenerateImageOnActivity;
void _rejectEditOnGenericFallback;
void _rejectWriteOnGenericFallback;
void _rejectGenerateImageOnGenericFallback;
void _rejectImageFieldsOnActivityDetails;
