import type { Artist, AxisSpec, Scale } from './types.js';
export type Extent = {
    readonly lo: number;
    readonly hi: number;
    readonly minpos: number;
    readonly count: number;
    readonly stickies: readonly number[];
};
export declare function dataExtents(artists: readonly Artist[]): {
    readonly x: Extent;
    readonly y: Extent;
};
/** Shared axes autoscale over the union of their data limits. */
export declare const unionExtent: (es: readonly Extent[]) => Extent;
/** handle_single_axis */
export declare function autoscaleExtent(e: Extent, spec: AxisSpec, s: Scale, margin: number): readonly [number, number];
export declare function viewLimits(spec: AxisSpec, s: Scale, e: Extent, margin: number): readonly [number, number];
