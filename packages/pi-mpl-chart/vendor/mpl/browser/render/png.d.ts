import type { Canvas } from './agg/canvas.js';
import type { Option } from '../core/types.js';
/** colors: the palette budget (1..256), or none for full RGBA. */
export type PngOptions = {
    readonly colors: Option<number>;
};
/** encodePNGSync also takes the built-in deflate's level (1..9); none keeps the default chart-tuned encoder. */
export type PngSyncOptions = PngOptions & {
    readonly level: Option<number>;
};
export declare const RGBA: PngSyncOptions;
/**
 * How hard the built-in deflate searches, as zlib's configuration_table: greedy (deflate_fast) or lazy (deflate_slow)
 * matching; `chain` hash candidates at most, a quarter of them once the previous match reaches `good`; no chain search
 * once the left or upper match reaches `nice`, and the chain search stops at a `stop` match; lazy matching does not
 * look past a match of `maxLazy`. Levels 1..9 take zlib's values (nice = stop; the greedy levels keep this tokenizer's
 * insertion policy rather than max_insert_length). The default (no level) searches 4
 * candidates only below 16 and keeps the longest, which the chart-tuned encoders were measured with.
 * Measured on 23 fixtures against the default (RGBA / 64 colours): level 6 is 7.5% / 5.1% smaller at 3x / 1.2x the
 * time, level 9 9.5% / 8.2% at 12x / 5x, within about 1% of zlib -9.
 */
export type Effort = {
    readonly lazy: boolean;
    readonly chain: number;
    readonly good: number;
    readonly nice: number;
    readonly stop: number;
    readonly maxLazy: number;
};
/** zlib's 1..9 scale; anything else is an error. */
export declare function effortOf(level: number): Effort;
/**
 * Rows [y0, y1) with filter type 0 (None). Measured on the fixtures with zlib level 6:
 * None 181.8 KB < adaptive min-sum-abs 200.3 KB < Up 203.5 KB < Paeth 208.3 KB. Charts
 * are flat color with anti-aliased edges; prediction turns those edges into noise that
 * LZ77 can't match, and None also costs nothing to compute.
 */
export declare function filteredBand(c: Canvas, y0: number, y1: number): Uint8Array<ArrayBuffer>;
/** PNG as a byte stream. Uses the platform's zlib (CompressionStream 'deflate' = RFC 1950). */
export declare function pngStream(c: Canvas, opts?: PngOptions): ReadableStream<Uint8Array>;
export declare function encodePNG(c: Canvas, opts?: PngOptions): Promise<Uint8Array>;
/**
 * Max zlib bytes retained for one Huffman block before it is wrapped as an IDAT.
 * writeBlock reserves (nTok·6+8) bytes; that is the hard ceiling for one Huffman block.
 */
export declare const PNG_IDAT_PAYLOAD_MAX: number;
/**
 * zlib stream (RFC 1950) of `d`. `rowDist` is the byte distance to the same byte one row up
 * (pass 0 for generic data).
 */
export declare function zlibSync(d: Uint8Array, rowDist?: number, left?: number, effort?: Effort): Uint8Array;
/**
 * Tokens per dynamic-Huffman block — same as zlibFrom's PER. Two buffers of this size are retained
 * (active + one held-back full block) so BFINAL lands on the same block as the historical whole-buffer path.
 * Peak token scratch: `2 · TOK_BLOCK · 4` bytes, independent of w·h.
 */
export declare const TOK_BLOCK: number;
/**
 * Module-pooled scratch retained across encodes (bytes). Independent of w·h.
 * Includes the bit writer cap (one IDAT zlib payload) and both token blocks.
 * Intervals L/U grow with width — counted in pngPeakBytes via pngIntervalsBytes(w).
 */
export declare const PNG_SYNC_FIXED_SCRATCH_BYTES: number;
/** One enqueued IDAT chunk: length(4)+type(4)+payload+crc(4). Stream retains at most one. */
export declare const PNG_IDAT_CHUNK_MAX: number;
/**
 * Node/V8 empty-isolate `process.memoryUsage().arrayBuffers` before our canvas exists.
 * Measured max baseGap across clean-isolate probes (dashboard@1×): 255_556 bytes.
 * Rounded up to 256 KiB so the formula remains a hard upper bound on measured peaks.
 */
export declare const PNG_ARRAYBUFFERS_BASELINE_BYTES: number;
/**
 * Extra allowance on top of pngPeakBytes for V8 deferring reclaim of a just-dropped IDAT
 * ArrayBuffer across a `gc()` turn. Measured max (livePeak − pngPeakBytes) over repeated
 * clean-isolate runs: 1_127_800 bytes (demo@3×). Set to 1.25 MiB. CI asserts
 * measured ≤ pngPeakBytes + PNG_PEAK_V8_RECLAIM_SLACK_BYTES with no further tolerance.
 */
export declare const PNG_PEAK_V8_RECLAIM_SLACK_BYTES: number;
/** Interval arrays L/U after ensure(w): 2 · (w+4) · 4 bytes. */
export declare const pngIntervalsBytes: (w: number) => number;
/** Block-state bytes on a canvas of size w×h (Agg BLOCK=32). */
export declare const canvasBlockBytes: (w: number, h: number) => number;
/**
 * Exact peak `arrayBuffers` bound for the streaming RGBA encode path (bytes):
 *   4·w·h + canvasBlockBytes(w,h) + PNG_SYNC_FIXED_SCRATCH_BYTES
 *   + max(0, pngIntervalsBytes(w) − 2·2048·4) + PNG_IDAT_CHUNK_MAX
 *   + PNG_ARRAYBUFFERS_BASELINE_BYTES
 *
 * Live retained encoded output ≤ one IDAT chunk (pull-based). Unreclaimed V8 garbage from
 * prior chunks is not live; CI measures with GC between pulls (or a clean isolate).
 * Full-frame RGBA is the one O(w·h) term (bands rejected — band-verdict.md).
 */
export declare const pngPeakBytes: (w: number, h: number) => number;
/**
 * Workers isolate budget for PNG peak (bytes). 64 MB leaves headroom under the 128 MB
 * isolate for request handling, Workers Caching materialization, and other isolate state.
 * Enforced before canvas allocation; demo @3× (~54 MB) fits; a 4 MP square @2× does not.
 */
export declare const PNG_PEAK_BUDGET_BYTES: number;
/** Max 1× pixels (mpl-web LIMITS.pixels). */
export declare const MAX_FRAME_PIXELS: number;
/** Known-constant peak at the widest legal 1× frame (w=MAX_FRAME_PIXELS, h=1). */
export declare const PNG_PEAK_MAX_1X_WIDE_BYTES: number;
/** Known-constant peak at the square max-1× frame (2048×2048). */
export declare const PNG_PEAK_MAX_1X_SQUARE_BYTES: number;
/** Whether an output frame of w×h fits the PNG peak budget (no allocation). */
export declare const pngPeakFitsBudget: (w: number, h: number) => boolean;
/**
 * Largest integer scale ≥ 1 whose output (≈ widthIn·dpi·scale × heightIn·dpi·scale) fits
 * the peak budget; 0 if even scale 1 does not.
 */
export declare const maxPngScaleForFigure: (widthIn: number, heightIn: number, dpi: number) => number;
export declare function encodePNGSync(c: Canvas, opts?: PngSyncOptions): Uint8Array;
/**
 * Pull-based PNG: signature+IHDR, then one IDAT per pull (≤ PNG_IDAT_PAYLOAD_MAX zlib bytes), then IEND.
 * Backpressure: the encoder only advances on pull. Retained encoded output ≤ one IDAT payload.
 * Zlib payloads across IDATs concat to the same bytes as encodePNGSync's single IDAT (file framing differs).
 */
export declare function pngStreamSync(c: Canvas, opts?: PngSyncOptions): ReadableStream<Uint8Array>;
