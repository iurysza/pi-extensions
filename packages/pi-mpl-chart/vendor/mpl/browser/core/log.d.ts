import type { TickLabel } from './types.js';
/** Python round(): half to even. */
export declare const pyRound: (x: number) => number;
/** LogLocator.nonsingular; minpos = smallest positive data value on the axis (Infinity if none). */
export declare function logNonsingular(v0: number, v1: number, base: number, minpos: number): readonly [number, number];
export type LogSubs = {
    readonly kind: 'major';
} | {
    readonly kind: 'minorAuto';
};
/** LogLocator.tick_values with numticks='auto' (n_request = clip(tick_space, 2, 9)). */
export declare function logTicks(vminIn: number, vmaxIn: number, base: number, subs: LogSubs, tickSpace: number, minpos: number): number[];
/** '%g' (6 significant digits, trailing zeros stripped). */
export declare function pyG(x: number): string;
/** LogFormatterSciNotation.__call__ for each loc (labelOnlyBase = False). */
export declare function logFormat(locs: readonly number[], view: readonly [number, number], base: number): readonly TickLabel[];
/** The exact string matplotlib produces for a tick label (for metadata and tests). */
export declare function tickLabelText(l: TickLabel): string;
