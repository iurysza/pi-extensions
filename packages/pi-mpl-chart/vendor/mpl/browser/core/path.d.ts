import type { Simplify } from './types.js';
export type XY = {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
};
/** Vertices in device px (y down). MOVETO at the indices in `moves` (ascending), LINETO everywhere else. */
export type Polyline = {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly moves: Uint32Array;
};
/** One subpath starting at vertex 0 (shared; never mutated). */
export declare const MOVE0: Uint32Array;
/**
 * PathSimplifier::vertex, line for line (Allan Haldane / Michael Droettboom / Kevin Rose): consecutive vertices
 * whose perpendicular distance from the current vector stays under the threshold merge into it; the run's
 * furthest forward and backward points are kept. `thr` is path.simplify_threshold in px (compared squared).
 * The arithmetic is the C++'s, operation for operation. The loop is one closure-free function with the output
 * written inline: a closure over the state would context-allocate every variable the loop touches, which costs the
 * most in the interpreter and baseline tiers where short-lived isolates run.
 */
export declare function simplifyPath(p: Polyline, thr: number): Polyline;
/**
 * RendererAgg::draw_path for an unfilled, unhatched stroke (clip = simplify-eligible = true): drop non-finite
 * vertices, clip to the canvas (W × H, integers) widened by 1 px, snap when SNAP_AUTO says so, then simplify when
 * Path.should_simplify holds (path.simplify on and at least 128 vertices in the original path).
 * `strokePx` is the stroke width in px (it picks the snap offset). snapOn false is matplotlib's SVG backend (no PathSnapper).
 */
export declare function cleanupStroke(xs: Float64Array, ys: Float64Array, W: number, H: number, strokePx: number, simplify: Simplify, snapOn?: boolean): Polyline;
/**
 * PathSnapper::should_snap for SNAP_AUTO: at most 1024 vertices, and every segment axis-aligned within
 * 1e-4 px (|dx| < 1e-4 or |dy| < 1e-4). Such paths snap to pixel centres (or edges) in Agg.
 */
export declare function isRectilinear(xs: Float64Array, ys: Float64Array): boolean;
/** decimateMinMax keeps both ends of any step between samples of one column longer than this (device px). */
export declare const DECIMATE_STEP_PX = 2;
/**
 * Min/max decimation per device-pixel column (plot's opt-in `decimate`, see Decimate in types.ts). A column is
 * floor(x · perPx). In each run of finite samples sharing one, these are kept, in sample order: the first and the last;
 * the lowest and the highest y, each with the samples either side of it in the run (so a spike keeps the slopes of its
 * flanks, not a chord from the run's ends); and both ends of every step longer than DECIMATE_STEP_PX (so a jump is
 * drawn where it happens, not moved to an extreme's x). A non-finite sample is kept and ends the run, so NaN still
 * breaks the line. x must be non-decreasing over its finite values (a time series); otherwise the input comes back
 * unchanged.
 *
 * Measured on fixture dense_timeseries_tag (3 × 11,641 samples, 720 × 480) against the exact render: first/min/max/last
 * alone changed 4.65 % of the canvas (1,950 px by more than 64); with the flanks and steps, 2.02 % (437 px).
 */
export declare function decimateMinMax(xs: Float64Array, ys: Float64Array, perPx: number): XY;
