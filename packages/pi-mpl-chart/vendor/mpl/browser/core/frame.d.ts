import type { Position, Scale } from './types.js';
export type AxesBox = {
    readonly x0: number;
    readonly x1: number;
    readonly yTop: number;
    readonly yBot: number;
    readonly w: number;
    readonly h: number;
    /** top and bottom edges flipped with the geometry height Hg (Agg's int canvas height; the float height in SVG): for paths and clips */
    readonly yTopG: number;
    readonly yBotG: number;
    /** bottom and top edges in display (y-up) coordinates, b·H and t·H exactly as matplotlib holds them; H − yBot can be 1 ulp off */
    readonly b: number;
    readonly t: number;
};
export type Frame = {
    readonly box: AxesBox;
    readonly W: number;
    readonly H: number;
    /** the height paths, markers, images and clip boxes flip with: Agg's RendererAgg uses its int canvas height, while
     *  text flips with the float H (Text._draw: get_canvas_width_height). matplotlib's SVG flips everything with H. */
    readonly Hg: number;
    /** the canvas PathClipper clips line paths to (±1 px): int(W) × int(H) in Agg, W × H in SVG */
    readonly clipW: number;
    readonly clipH: number;
    /** Agg's pixel snapping (PathSnapper, draw_markers' pixel grid) applies; matplotlib's SVG backend never snaps */
    readonly snap: boolean;
    readonly xlim: readonly [number, number];
    readonly ylim: readonly [number, number];
    readonly xscale: Scale;
    readonly yscale: Scale;
    /** transData's affine part, display (y up) = scaled·a + c, with matplotlib's float operations */
    readonly ax: number;
    readonly cx: number;
    readonly ay: number;
    readonly cy: number;
};
/**
 * The axes bbox as matplotlib holds it: TransformedBbox(position, transFigure), so edges are
 * l·W, r·W, b·H, t·H in display (y-up) coordinates and widths are differences of edges.
 * Top-left y values flip with the canvas height, as Agg does.
 */
export declare function axesBox(p: Position, W: number, H: number, Hg?: number): AxesBox;
/**
 * BboxTransformTo(axes.bbox) ∘ BboxTransformFrom(viewLim), composed by np.dot:
 * From = [1/w, −v0·(1/w)], so a = outw·(1/w), c = outw·(−v0·(1/w)) + outl. Points map as (v·a + 0) + c.
 */
export declare function frame(box: AxesBox, W: number, H: number, dev: Device, xlim: readonly [number, number], ylim: readonly [number, number], xscale: Scale, yscale: Scale): Frame;
/**
 * The output a scene is laid out for. 'agg' is the PNG rasterizer (RendererAgg: int canvas, path snapping); 'svg' is
 * matplotlib's SVG backend (float canvas, no snapping).
 */
export type Device = 'agg' | 'svg';
/** The height a device flips path geometry with: RendererAgg's int(height), or the float height in SVG. */
export declare const geomHeight: (H: number, dev: Device) => number;
/** Data → top-left device px. */
export declare const tx: (f: Frame, x: number) => number;
/** Data → top-left device px. Matches Agg's concatenated affine (scale(1,-1)·translate(0,H) after
 *  transData): y_out = −ay·v + (H − cy). Reassociating as H − (ay·v + cy) is 1 ulp off at some *.5 and
 *  disagrees with PathSnapper's floor(v+0.5). */
export declare const ty: (f: Frame, y: number) => number;
/** Data → top-left px for a text anchor, which flips with the float height. */
export declare const tyText: (f: Frame, y: number) => number;
