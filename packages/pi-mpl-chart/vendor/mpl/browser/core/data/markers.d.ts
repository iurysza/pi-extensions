import type { Cap, Join, MarkerName, Seg } from '../types.js';
/** Marker outline in marker units (y up; scale by markersize px). Vertices snap to integers when size >= snapPx. */
export type MarkerDef = {
    readonly segs: readonly Seg[];
    readonly filled: boolean;
    readonly snapPx: number;
    readonly join: Join;
    readonly cap: Cap;
};
export declare const MARKERS: Readonly<Record<MarkerName, MarkerDef>>;
export declare const MARKER_NAMES: readonly MarkerName[];
