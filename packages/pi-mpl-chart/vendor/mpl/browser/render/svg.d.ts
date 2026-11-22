import type { Node, Scene } from '../core/types.js';
import type { IOList } from './iolist.js';
import type { Tracer } from '../trace.js';
/**
 * How path data is written. 'default' is mpl's usual output: 4 decimals and a command letter on every segment.
 * 'compact' (toSVG({ precision })) rounds path coordinates (`d`, marker positions) to `decimals` places and writes
 * a repeated command letter once. Lines become relative (polylineCompact), and a line vertex that rounds onto the
 * one before it is dropped. Other attributes (sizes, widths, opacities, text positions) keep 4 decimals.
 */
export type PathData = {
    readonly kind: 'default';
} | {
    readonly kind: 'compact';
    readonly decimals: number;
};
export declare const DEFAULT_PATH_DATA: PathData;
/** f() at dp ∈ 0..4 decimals. (Writing it from integer parts measured slower end to end than V8's own conversion.) */
export declare const fdp: (v: number, dp: number) => string;
/**
 * How text is written. 'text': <text> elements, laid out by the viewer's own font engine. 'glyphs':
 * matplotlib's default svg.fonttype 'path' — each glyph's outline once in <defs> (font units), placed
 * with <use> at the same 26.6 pen positions the rasterizer uses, so geometry is exact everywhere.
 */
export type SvgText = 'text' | 'glyphs';
export declare function leafCount(n: Node): number;
/**
 * An annotated SVG's per-Axes part: how many top-level scene nodes the Axes drew (an Axes' nodes are contiguous,
 * in axes order, from the first node) and its sidecar (src/render/annotate.ts), already escaped for XML text.
 */
export type SvgAxesAnnot = {
    readonly nodes: number;
    readonly sidecar: string;
};
/**
 * Scene -> IOList; one span per top-level node. Element ids are per render, so output is deterministic;
 * `prefix` keeps them unique when several SVGs share one HTML document (ids are document-global).
 * `annot` (empty by default, which leaves the output byte-identical) makes it an annotated SVG for mpl/interactive.
 */
export declare function svgIO(scene: Scene, tracer: Tracer, text?: SvgText, prefix?: string, pd?: PathData, annot?: readonly SvgAxesAnnot[]): IOList;
export declare const svgChunks: (scene: Scene, tracer: Tracer, text?: SvgText, prefix?: string, pd?: PathData, annot?: readonly SvgAxesAnnot[]) => Generator<string>;
export declare const toSVG: (scene: Scene, tracer: Tracer, text?: SvgText, prefix?: string, pd?: PathData, annot?: readonly SvgAxesAnnot[]) => string;
export declare const svgStream: (scene: Scene, tracer: Tracer, text?: SvgText, prefix?: string, pd?: PathData, annot?: readonly SvgAxesAnnot[]) => ReadableStream<Uint8Array>;
