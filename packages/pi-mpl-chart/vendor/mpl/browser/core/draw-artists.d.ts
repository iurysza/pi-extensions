import type { Frame } from './frame.js';
import type { Box } from './legend-index.js';
import type { XY } from './path.js';
import type { WedgeArtist } from './types.js';
import type { Artist, AxLineArtist, MarkerName, ScatterCollection, BarArtist, PolygonArtist, SegmentsArtist, Clip, FillArtist, Handle, ImageArtist, LineArtist, Node, Option, TextArtist, Theme, ScatterArtist, SpanArtist, AnnotationArtist, Paint } from './types.js';
import type { Face } from './fonts.js';
import type { SpanHandle } from '../trace.js';
/** What an artist draws, plus what loc='best' avoids: line vertices and paths, patch boxes, and collection offsets
 *  (points, display y up; they count when strictly inside but, unlike a line, do not intersect). */
export type Drawn = {
    readonly nodes: readonly Node[];
    readonly lines: readonly XY[];
    readonly boxes: readonly Box[];
    readonly points: readonly XY[];
    /** a curved Patch path for loc='best': its flattened polyline (display, y up) only intersects; its own vertices
     *  (control points included) are counted through `points` */
    readonly paths: readonly XY[];
    readonly handle: Option<Handle>;
};
/** The artist's legend handle. It depends on the artist alone (not the frame), so a layout that only measures
 *  (tight_layout's first pass) can build legend entries without drawing. Every draw* returns this. */
export declare function handleOf(a: Artist): Option<Handle>;
export declare function drawLine(a: LineArtist, f: Frame, theme: Theme, k: number, clip: Clip, span: SpanHandle): Drawn;
/**
 * axline (lines.AxLine.get_transform): in scaled coordinates, intersect the line with the four view-limit
 * edges, sort the points and keep the middle two; Line2D's unit path [(0, 0), (1, 1)] maps onto them.
 */
export declare function drawAxLine(a: AxLineArtist, f: Frame, theme: Theme, k: number, clip: Clip, span: SpanHandle): Drawn;
/**
 * A LineCollection (Collection.draw). One solid segment takes the single-path optimization, draw_markers
 * with the segment as the marker at display (0, 0), i.e. pixel (0, H); otherwise draw_path_collection
 * strokes each segment with its own colour and dashes, in order. Either way Agg's PathSnapper snaps
 * an axis-aligned segment to floor(v + 0.5) + (odd width ? 0.5 : 0). GC defaults: butt caps, round joins.
 */
export declare function drawSegments(a: SegmentsArtist, f: Frame, theme: Theme, k: number, clip: Clip): Drawn;
/** A Polygon patch: filled and/or stroked (miter joins, butt caps), snapped when rectilinear. */
export declare function drawPolygon(a: PolygonArtist, f: Frame, k: number, clip: Clip): Drawn;
export declare function drawBar(a: BarArtist, f: Frame, k: number, clip: Clip, span: SpanHandle): Drawn;
/**
 * fill_between as FillBetweenPolyCollection builds it: [start, (x, y1)…, end, (x, y2) reversed],
 * closed. Vertices go through the same folded affine as lines; Agg fills with the non-zero rule.
 */
export declare function drawFill(a: FillArtist, f: Frame, k: number, clip: Clip): Drawn;
/** ax.text: position through transData or transAxes (Python-side, then flipped), laid out like Text. */
export declare function drawText(a: TextArtist, f: Frame, dpi: number, face: Face): Drawn;
/**
 * A Wedge (or its Shadow) through Patch.draw: the path's vertices go through the data affine (for a Shadow composed
 * with its translation: c' = a·(o·dpi/72) + c, as np.dot composes the two matrices), flipped as Agg does. A filled
 * path is neither clipped nor snapped (it has curves). loc='best' sees it as a path: Bézier segments flattened in
 * display space (path_intersects_rectangle's conv_curve), every vertex in order, the CLOSEPOLY one included.
 */
export declare function drawWedge(a: WedgeArtist, f: Frame, k: number, clip: Clip): Drawn;
/** ax.annotate: Annotation.draw draws its FancyArrowPatch (ArrowStyle.Simple via the YAArrow emulation), then the text. */
export declare function drawAnnotation(a: AnnotationArtist, f: Frame, W: number, dpi: number, theme: Theme, k: number, clip: Clip): Drawn;
/** ax.scatter: markers-only collection with sizes in pt^2. */
export declare function drawScatter(a: ScatterArtist, f: Frame, _theme: Theme, k: number, clip: Clip): Drawn;
/** Collection.draw's lengths: a lone 'none' colour is to_rgba_array's empty array. */
export declare const paintCount: (ps: readonly Paint[]) => number;
/**
 * Collection.draw's single-path optimization (renderer.draw_markers): at most one size, exactly one face and one edge
 * colour, and the scaled marker smaller than the figure. The test is on the collection's lists, not on whether the
 * points happen to look alike: s=[60, 60, 60] is three transforms and goes through draw_path_collection.
 */
export declare function singlePath(shape: MarkerName, c: ScatterCollection, k: number, W: number, H: number): boolean;
/**
 * A PathCollection of one marker path at display offsets (top-left px). `single` is Collection.draw's single-path
 * optimization: one path, size, face and edge colour go through renderer.draw_markers (no snapping, the draw_markers
 * pixel offset). Otherwise RendererAgg::_draw_path_collection_generic: point i takes sizes, faces and edges at i modulo
 * their lengths, its path is scaled by sqrt(s) * dpi / 72 and translated to the exact offset, then filled and stroked.
 */
export declare function collectionNodes(shape: MarkerName, xs: Float64Array, ys: Float64Array, sizesPt2: Float64Array, faces: readonly Paint[], edges: readonly Paint[], edgeWidthPt: number, k: number, single: boolean, snapOn?: boolean): readonly Node[];
/** axvspan / axhspan: spans in data × axes-fraction coordinates. */
export declare function drawSpan(a: SpanArtist, f: Frame, k: number, clip: Clip): Drawn;
/** ax.imshow: rasterise a ScalarMappable to an image node. */
export declare function drawImage(a: ImageArtist, f: Frame, clip: Clip): Drawn;
