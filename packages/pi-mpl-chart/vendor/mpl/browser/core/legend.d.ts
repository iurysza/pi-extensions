import type { Box } from './legend-index.js';
import type { XY } from './path.js';
import type { AnchorCode, LegendEntry, LegendLoc, LegendMarkers, Node, Theme } from './types.js';
import type { Tracer } from '../trace.js';
export type LegendInput = {
    readonly entries: readonly LegendEntry[];
    readonly theme: Theme;
    readonly dpi: number;
    readonly W: number;
    readonly H: number;
    /** the geometry flip height (Frame.Hg): the frame and handles flip with it, labels with H */
    readonly Hg: number;
    /** Agg's pixel snapping (Frame.snap) */
    readonly snap: boolean;
    readonly axesBox: Box;
    readonly lines: readonly XY[];
    readonly points: readonly XY[];
    readonly paths: readonly XY[];
    readonly boxes: readonly Box[];
    readonly loc: LegendLoc;
    readonly ncols: number;
    readonly frame: boolean;
    readonly fontSizePt: number;
    readonly markers: LegendMarkers;
};
/** `entries[i]`: entry i's handle + label box (display, y up), in input order: what an interactive layer hit-tests. */
export type LegendOutput = {
    readonly box: Box;
    readonly code: AnchorCode;
    readonly nodes: readonly Node[];
    readonly entries: readonly Box[];
};
export declare function layoutLegend(inp: LegendInput, tracer: Tracer): LegendOutput;
