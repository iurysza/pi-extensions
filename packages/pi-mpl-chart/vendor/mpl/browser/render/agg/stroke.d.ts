import type { Cap, Join, Seg } from '../../core/types.js';
/** Where polygons go: Agg's rasterizer add_vertex interface. */
export interface PathSink {
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
}
/** A flattened subpath. */
export type Sub = {
    readonly xs: number[];
    readonly ys: number[];
    readonly closed: boolean;
};
/**
 * conv_curve over a Seg list, split into subpaths at M (and after Z). Curve start
 * points are the current point; curve_div emits interior points then the end point.
 * `dx, dy` translate every vertex first (conv_transform).
 */
export declare function flatten(segs: readonly Seg[], dx: number, dy: number): Sub[];
/** Fill: every subpath becomes a polygon (the rasterizer auto-closes). */
export declare function fillPath(subs: readonly Sub[], sink: PathSink): void;
type LJ = 'miter' | 'miterRevert' | 'round' | 'bevel';
type Stroker = {
    readonly w: number;
    readonly wAbs: number;
    readonly wEps: number;
    readonly cap: Cap;
    readonly join: LJ;
    readonly miterLimit: number;
};
/** matplotlib's GCAgg mapping: 'miter' → miter_join_revert, 'projecting' (square) caps. */
export declare function stroker(width: number, cap: Cap, join: Join, miterLimit: number): Stroker;
/** Stroke flattened subpaths (conv_adaptor_vcgen<vcgen_stroke>). */
export declare function strokePath(subs: readonly Sub[], st: Stroker, sink: PathSink): void;
/**
 * conv_dash: each subpath is cut into dashes; returns open subpaths for the stroker.
 * pattern alternates on/off lengths in px; offset is dash_start.
 */
export declare function dashPath(subs: readonly Sub[], pattern: readonly number[], offset: number): Sub[];
export {};
