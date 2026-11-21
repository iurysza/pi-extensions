import type { Cap, Dash, LineMarkers, LineStyle, MarkerName, Node, Option, Rgb, Seg, Stroke, Theme } from './types.js';
/** lines._get_dash_pattern + _scale_dashes, in px. */
export declare function dashFor(theme: Theme, style: LineStyle, widthPt: number, k: number): Dash;
/** Line2D.is_dashed: every linestyle but '-' (a dash tuple counts, even one drawn solid). */
export declare const isDashedStyle: (style: LineStyle) => boolean;
/** Line2D stroke: solid lines use the solid cap/join, dashed ones the dash cap/join. */
export declare function lineStroke(theme: Theme, color: Rgb, widthPt: number, style: LineStyle, k: number, capOverride?: Option<Cap>): Stroke;
/** Marker outline at the origin in px (y down). Vertices snap to integers at/above the marker's threshold. */
export declare function markerShape(name: MarkerName, sizePx: number, doSnap?: boolean): readonly Seg[];
/**
 * PathSnapper's SNAP_AUTO test (path_converters.h should_snap), on a path in px: at most 1024 segments, no curves, and
 * every line_to axis-aligned within 1e-4 px of the previous vertex (a move_to only moves the pen, so '+' snaps).
 * A collection's GraphicsContext keeps snap None, which is this test.
 */
export declare function snapsAuto(segs: readonly Seg[]): boolean;
/**
 * One instanced Markers node: renderer.draw_markers. Agg snaps each origin to the pixel centre; opaque identical
 * markers at the same snapped pixel are indistinguishable, so they dedupe. A Line2D snaps its marker path when the
 * marker is at least its snap threshold, and strokes with the marker's own join and cap. With `collection` (a
 * PathCollection's single-path draw) the GraphicsContext keeps its defaults instead: round join, butt cap, and
 * SNAP_AUTO, which snaps only an axis-aligned path (a square, not a triangle or diamond).
 */
export declare function markersNode(m: Extract<LineMarkers, {
    kind: 'on';
}>, xs: Float64Array, ys: Float64Array, k: number, collection?: boolean, snapOn?: boolean): Option<Node>;
