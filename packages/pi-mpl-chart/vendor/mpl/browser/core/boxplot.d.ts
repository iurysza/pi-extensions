import type { Option, Result } from './types.js';
/** Whisker rule: Tukey's IQR multiple, or an explicit (lo, hi) percentile pair. */
export type Whis = {
    readonly kind: 'iqr';
    readonly coef: number;
} | {
    readonly kind: 'percentiles';
    readonly lo: number;
    readonly hi: number;
};
/** One column's boxplot statistics, as cbook.boxplot_stats returns. */
export type BoxplotStats = {
    readonly mean: number;
    readonly med: number;
    readonly q1: number;
    readonly q3: number;
    readonly iqr: number;
    readonly cilo: number;
    readonly cihi: number;
    readonly whislo: number;
    readonly whishi: number;
    readonly fliers: Float64Array;
    readonly label: Option<string>;
};
/** numpy.percentile(a, q, method='linear') for a finite sorted sample (q in [0, 100]). */
export declare function percentileLinear(sorted: Float64Array, q: number): number;
/** Parse whis: a float, or a length-2 percentile pair. */
export declare function parseWhis(v: unknown): Result<Whis>;
/**
 * cbook.boxplot_stats for one already-reshaped sample (1-D values).
 * Matches matplotlib when bootstrap is None (Gaussian notch).
 */
export declare function boxplotStatsOne(values: Float64Array, whis: Whis, autorange: boolean, label: Option<string>): BoxplotStats;
/**
 * Reshape X the way cbook._reshape_2D does for lists: a list of arrays is several datasets;
 * a flat numeric array is one. 2-D typed arrays are not accepted (JS has no ndarray columns).
 */
export declare function reshapeBoxplotData(x: unknown): Result<readonly Float64Array[]>;
/** boxplot_stats(X, whis, labels, autorange) with bootstrap off. */
export declare function boxplotStats(datasets: readonly Float64Array[], whis: Whis, labels: Option<readonly Option<string>[]>, autorange: boolean): Result<readonly BoxplotStats[]>;
