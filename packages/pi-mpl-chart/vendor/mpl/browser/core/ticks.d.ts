import type { AxisSpec, Scale, Theme, TickLabel } from './types.js';
/** `index` is the tick's place in its locator's list (Axis.get_major_ticks order), in view or not. */
export type Tick = {
    readonly loc: number;
    readonly label: TickLabel;
    readonly minor: boolean;
    readonly index: number;
};
export type TickSet = {
    readonly locs: readonly number[];
    readonly labels: readonly TickLabel[];
    readonly offset: string;
    readonly minor: readonly number[];
    readonly minorLabels: readonly TickLabel[];
    /** major then minor, restricted to the view interval */
    readonly visible: readonly Tick[];
};
/** XAxis/YAxis.get_tick_space: how many labels fit (aspect heuristics 3:1 for x, 2:1 for y). */
export declare function tickSpace(axis: 'x' | 'y', lengthPx: number, dpi: number, labelSizePt: number): number;
export declare const scaleOf: (spec: AxisSpec) => Scale;
export declare function computeTicks(spec: AxisSpec, lim: readonly [number, number], space: number, theme: Theme, minpos: number): TickSet;
