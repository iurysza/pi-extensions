import type { ArrowStyle } from './types.js';
export type Pt = readonly [number, number];
export type Box = {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
};
/** Path codes in matplotlib's order: M, L, Q (one CURVE3 pair), Z. */
export type ArrowSeg = {
    readonly kind: 'M';
    readonly p: Pt;
} | {
    readonly kind: 'L';
    readonly p: Pt;
} | {
    readonly kind: 'Q';
    readonly c: Pt;
    readonly p: Pt;
} | {
    readonly kind: 'Z';
};
export type SimpleArrowSpec = {
    /** arrowprops width / headwidth / headlength in pt, shrink as a fraction */
    readonly widthPt: number;
    readonly headWidthPt: number;
    readonly headLengthPt: number;
    readonly shrink: number;
    /** mutation_scale: the annotation's font size in pt */
    readonly mutationPt: number;
};
/**
 * The arrow path for annotate(..., arrowprops={...}) with no 'arrowstyle', from the text's window extent
 * `bbox` to the annotated point `xy`. `k` is points_to_pixels(1) (FancyArrowPatch's dpi_cor).
 */
export declare function yaArrowPath(bbox: Box, xy: Pt, hasText: boolean, spec: SimpleArrowSpec, k: number): readonly ArrowSeg[];
/**
 * Path.get_extents of an arrow path (display px): every segment's end points plus a quadratic's axis-aligned extrema,
 * t = (p0 - c) / (p0 - 2c + p1) where it lies inside (0, 1). Annotation.get_window_extent unions it with the text's.
 */
export declare function arrowExtents(path: readonly ArrowSeg[]): Box;
/** An arrowstyle or connectionstyle matplotlib has that this port does not draw (or does not know). */
export declare class UnsupportedArrowStyleError extends Error {
    readonly style: string;
    constructor(style: string, detail: string);
}
/** Every arrowstyle name this port draws, in ArrowStyle's registry order. */
export declare const ARROW_STYLES: readonly string[];
/**
 * ArrowStyle(spec): a registered name with optional ",key=value" parameters. An unknown name, or a style this port
 * does not draw, throws UnsupportedArrowStyleError; a parameter the style's __init__ does not take throws TypeError
 * as matplotlib does. A rotated bracket (angleA / angleB other than 0) is unsupported.
 */
export declare function parseArrowStyle(spec: string): ArrowStyle;
/** ConnectionStyle(spec): only "arc3" (optionally ",rad=r") is drawn; the result is rad. */
export declare function parseConnectionStyle(spec: string): number;
/** One path of a FancyArrowPatch: `fillable` paths take the facecolor (when it is not transparent). */
export type ArrowPiece = {
    readonly segs: readonly ArrowSeg[];
    readonly fillable: boolean;
};
export type StyledArrowSpec = {
    readonly style: ArrowStyle;
    readonly rad: number;
    readonly relpos: Pt;
    readonly shrinkAPt: number;
    readonly shrinkBPt: number;
    readonly mutationPt: number;
    readonly linewidthPt: number;
};
/**
 * The FancyArrowPatch paths for annotate(..., arrowprops={'arrowstyle': ...}), display px y-up: from relpos of the
 * text's window extent `bbox` to `xy` along Arc3(rad), clipped by the padded text box, shrunk by shrinkA / shrinkB,
 * then the style's transmute at mutation_scale * dpi_cor. `k` is points_to_pixels(1).
 */
export declare function styledArrowPaths(bbox: Box, xy: Pt, hasText: boolean, spec: StyledArrowSpec, k: number): readonly ArrowPiece[];
