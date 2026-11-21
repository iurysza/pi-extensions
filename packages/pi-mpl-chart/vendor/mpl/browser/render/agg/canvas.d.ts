import type { Result } from '../../core/types.js';
import type { Coverage, IBox } from './raster.js';
/**
 * dpi is recorded so encoders can write physical size (PNG pHYs); 0 means unknown.
 *
 * Block state: each row is cut into blocks of BLOCK pixels (the last may be shorter). For block
 * `y·nb + j`, mix = 0 means every pixel in it is exactly blk[...] (a Uint32 as in u32); mix = 1
 * promises nothing. Every writer keeps this true (blendCoverage below is the only one in the
 * renderer); code that writes px or u32 itself must call invalidateBlocks. Encoders use it to
 * skip flat regions without reading them, and the blender to turn a uniform block into one fill.
 */
export type Canvas = {
    readonly w: number;
    readonly h: number;
    readonly dpi: number;
    readonly px: Uint8Array;
    readonly u32: Uint32Array;
    /** Same pixels as u32, as int32 — opaque values stay Smis for unoptimized encode/blend code. */
    readonly i32: Int32Array;
    readonly nb: number;
    readonly blk: Uint32Array;
    readonly mix: Uint8Array;
    /** blk as int32, same Smi reason as i32. */
    readonly blkI32: Int32Array;
};
/** A color quantized like agg::rgba8(agg::rgba): uround(c * 255). */
export type Rgba8 = {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
};
export declare const quantize: (v: number) => number;
/** One RGBA8 pixel as the Uint32 the canvas' native-endian view stores. */
export declare const pack: (r: number, g: number, b: number, a: number) => number;
export declare const BLOCK_SHIFT: number;
export declare const BLOCK: number;
/** RendererAgg::clear fills with _fill_color = rgba(1, 1, 1, 0). */
export declare function newCanvas(w: number, h: number, dpi: number): Canvas;
/** Back to the state newCanvas returns. */
export declare function clearCanvas(c: Canvas): void;
/**
 * A caller's canvas (a previous toRGBA result) to render into again: every view must be the one newCanvas makes, at
 * its size and over its own buffer, so the block state and the pixels can't disagree.
 */
export declare function parseCanvas(v: unknown): Result<Canvas>;
/** Wrap RGBA pixels written elsewhere (byteOffset must be a multiple of 4); block state is scanned. */
export declare function canvasOf(w: number, h: number, dpi: number, px: Uint8Array): Canvas;
/** After writing px/u32 directly: drop every uniformity claim (cheap), or rescan (exact). */
export declare function invalidateBlocks(c: Canvas): void;
export declare function scanBlocks(c: Canvas): void;
/** The block invariant, checked against the pixels (tests). Returns the first bad block or −1. */
export declare function checkBlocks(c: Canvas): number;
/**
 * Composite a coverage mask in one color, shifted by (dx, dy) and limited to `clip`
 * (half-open). Zero-coverage pixels are untouched, as in Agg's scanline renderers.
 */
export declare function blendCoverage(c: Canvas, cov: Coverage, color: Rgba8, dx: number, dy: number, clip: IBox): void;
