/** Integer pixel box, half-open: [x0, x1) × [y0, y1). */
export type IBox = {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
};
/**
 * Coverage as Agg's packed scanlines: per row, runs of constant 8-bit alpha. Row r's runs
 * are [rows[r], rows[r+1]) in sx (column, relative to x0), sl (length), sv (alpha > 0).
 * Size is O(outline), not O(area): a full-canvas rectangle is one run per row.
 */
export type Coverage = {
    readonly x0: number;
    readonly y0: number;
    readonly w: number;
    readonly h: number;
    readonly rows: Int32Array;
    readonly sx: Int32Array;
    readonly sl: Int32Array;
    readonly sv: Uint8Array;
};
/** Run-length encode a dense alpha mask (glyph bitmaps). */
export declare function denseCoverage(x0: number, y0: number, w: number, h: number, a: Uint8Array): Coverage;
export type FillRule = 'nonzero' | 'evenodd';
export declare const EMPTY: Coverage;
/**
 * Path sink with Agg semantics: move_to auto-closes the previous contour, close
 * returns to the contour start, and every edge is clipped (in doubles, pixel units)
 * against the clip box exactly as rasterizer_sl_clip does before conversion to
 * 24.8 fixed point.
 */
export declare class Rasterizer {
    private readonly segs;
    private cx0;
    private cy0;
    private cx1;
    private cy1;
    private x1;
    private y1;
    private f1;
    private sx;
    private sy;
    private status;
    constructor(clip: IBox);
    reset(clip: IBox): void;
    private flags;
    private flagsY;
    moveTo(x: number, y: number): void;
    lineTo(x2: number, y2: number): void;
    close(): void;
    private lineY;
    private clipLine;
    private emit;
    /** Close, accumulate every segment into a bbox grid, and sweep to coverage. */
    sweep(rule: FillRule): Coverage;
}
