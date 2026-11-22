import type { Clip, Ink, Node, Option, Paint, Seg, Stroke } from './types.js';
/** Agg PathSnapper: pixel centres for odd rounded stroke widths, pixel edges for even (top-left raster coords).
 *  After the y-up→y-down flip, vertices land on floor(v + 0.5) + off (off = 0.5 for odd stroke px). */
export declare const snapOffset: (strokePx: number) => number;
export declare const snap: (v: number, strokePx: number) => number;
/** snap() on Agg; the value itself where nothing snaps (matplotlib's SVG backend; Frame.snap false). */
export declare const snapIf: (on: boolean, v: number, strokePx: number) => number;
/** What a shape draws; none when it would draw nothing (fully transparent counts as nothing). */
export declare function inkOf(fill: Paint, stroke: Option<Stroke>): Option<Ink>;
export declare const rectNode: (x: number, y: number, w: number, h: number, ink: Ink) => Node;
export declare const pathNode: (segs: readonly Seg[], ink: Ink, antialiased?: boolean) => Node;
export declare const group: (nodes: readonly Node[], clip: Clip) => Node;
export declare const NO_CLIP: Clip;
