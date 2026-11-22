import type { Face } from '../core/fonts.js';
import type { Canvas, Rgba8 } from './agg/canvas.js';
/** conicSteps' output: (x, y) pairs, 24.8. d < 2^31 bounds the count by 2^13. */
export declare const CONIC_STEPS: Float64Array;
/**
 * gray_render_conic's subdivision of the conic p0 → p1 → p2 (24.8): 0 when it is flat enough for one line to
 * p2, else the count of DDA points, written to CONIC_STEPS. FreeType steps in 64-bit fixed point (values scaled
 * by 2^32); here each value is two integer words, v = h·2^32 + l with 0 ≤ l < 2^32. Every word stays far below
 * 2^53, so each double sum is exact, and a point is p's high word, FreeType's p >> 32 (arithmetic: floor).
 * Scaling by a power of two is exact. (test/conic.test.ts checks it against the 64-bit arithmetic in BigInt.)
 */
export declare function conicSteps(p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number): number;
/** FT_Set_Transform 16.16 matrix [[xx, xy], [yx, yy]] (identity when upright). */
export type RotMat = {
    readonly xx: number;
    readonly xy: number;
    readonly yx: number;
    readonly yy: number;
};
export declare const ROT_ID: RotMat;
export declare const ROT_90: RotMat;
/** matplotlib Agg: round(0x10000 * [[cos,-sin],[sin,cos]]) for angle degrees CCW in y-down screen space. */
export declare function rotMatDeg(deg: number): RotMat;
/**
 * Render one glyph whose origin is (ox, oy) in 26.6 FreeType space (y up from the
 * canvas bottom) and blend it like RendererAgg::draw_text_image.
 */
export declare function drawGlyph(c: Canvas, face: Face, gid: number, scale: number, rot: RotMat | boolean, ox: number, oy: number, color: Rgba8): void;
/** The uncached path: load, rasterize and blend at the real origin. */
export declare function drawGlyphDirect(c: Canvas, face: Face, gid: number, scale: number, rot: RotMat | boolean, ox: number, oy: number, color: Rgba8): void;
export declare function clearGlyphCache(): void;
/** Cache counters since the last call (for traces). */
export declare function glyphCacheStats(): {
    readonly hits: number;
    readonly misses: number;
    readonly size: number;
};
