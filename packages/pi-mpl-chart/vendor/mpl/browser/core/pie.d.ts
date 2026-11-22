import type { HAlign, Option, Result, VAlign } from './types.js';
/** Path codes, as matplotlib.path.Path. */
export declare const MOVETO = 1, LINETO = 2, CURVE4 = 4, CLOSEPOLY = 79;
/** A path in data coordinates: vertex i is (xs[i], ys[i]) with code codes[i]; CURVE4 vertices come in threes. */
export type PathData = {
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly codes: Uint8Array;
};
/** Path.arc(theta1, theta2) (is_wedge=False): the unit-circle arc as n cubic Béziers (Masionobe 2003). */
export declare function unitArc(theta1: number, theta2: number): PathData;
/**
 * Wedge._recompute_path: the arc theta1 → theta2 (degrees), then a LINETO to the centre (or, with `width`, the
 * reversed inner arc scaled by (r − width)/r), CLOSEPOLY; scaled by r and moved to the centre (v·r + center).
 * A complete annulus (theta2 − theta1 = 360) is drawn 0 → 360 with a MOVETO connector.
 */
export declare function wedgePath(cx: number, cy: number, r: number, theta1: number, theta2: number, width: Option<number>): PathData;
/** One wedge of a pie: its centre (after explode), radius and angles in degrees (theta1 < theta2). */
export type PieWedge = {
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
    readonly theta1: number;
    readonly theta2: number;
};
/** Axes.pie's wedge loop: fractions of the circle from startangle, counterclockwise or not, each offset by explode·r̂. */
export declare function pieWedges(fracs: Float64Array, explode: Float64Array, startangle: number, counterclock: boolean, center: readonly [number, number], radius: number): readonly PieWedge[];
/** Python's float % 360 (the sign follows the divisor), as Text.set_rotation normalizes. */
export declare const pyMod360: (v: number) => number;
/** Where pie_label puts a wedge's text: (x, y) in data coordinates, its alignment and rotation (degrees CCW). */
export type PieLabelPos = {
    readonly x: number;
    readonly y: number;
    readonly ha: HAlign;
    readonly va: VAlign;
    readonly rotation: number;
};
/** Axes.pie_label for one wedge: at distance·r along the bisector; 'outer' aligns away from the centre. */
export declare function pieLabelPos(w: PieWedge, distance: number, alignment: 'outer' | 'center', rotate: boolean): PieLabelPos;
/** CPython float repr (str): shortest round-trip digits, exponent form outside 1e-4 ≤ |x| < 1e16. */
export declare function pyFloatRepr(x: number): string;
/**
 * Python's `fmt % value` for one float (pie's autopct): %[flags][width][.precision]conv with flags '-', '+', ' ', '0',
 * '#' and conversions d i u f F e E g G s r, plus '%%'. A mapping key, '*' or a second conversion is an error.
 */
export declare function pyPercentFormat(fmt: string, value: number): Result<string>;
