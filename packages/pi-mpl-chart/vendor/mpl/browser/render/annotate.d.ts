import type { AxesAnnot } from '../core/layout.js';
import type { AxesSpec } from '../core/types.js';
/** Most points kept per artist. Ordered series keep each bucket's min and max (peaks survive); scatter keeps every k-th. */
export declare const MAX_POINTS = 2000;
/** A data series as drawn: data coordinates, the matching pixels, optional bases (bars). */
type Series = {
    readonly x: ArrayLike<number>;
    readonly y: ArrayLike<number>;
    readonly base: ArrayLike<number>;
    readonly snap: 'x' | 'y' | 'xy';
};
/** Indices to keep, in order: ≤ MAX_POINTS. Ordered series: per bucket of consecutive points, its min and max value. */
export declare function decimate(values: ArrayLike<number>, snap: Series['snap'], max?: number): readonly number[];
/** The sidecar of one Axes, as XML-escaped JSON text (it sits inside an SVG <metadata> element). */
export declare function axesSidecar(ax: AxesSpec, an: AxesAnnot, dp?: number, dpi?: number): string;
export {};
