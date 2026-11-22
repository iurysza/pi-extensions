import type { Option, Result } from './types.js';
/** The bin estimators np.histogram_bin_edges accepts by name. */
export type BinEstimator = 'auto' | 'fd' | 'doane' | 'scott' | 'stone' | 'rice' | 'sturges' | 'sqrt';
export declare const BIN_ESTIMATORS: readonly BinEstimator[];
/** hist(bins=…): a count of equal-width bins, explicit edges, or an estimator name. */
export type Bins = {
    readonly kind: 'count';
    readonly n: number;
} | {
    readonly kind: 'edges';
    readonly edges: Float64Array;
} | {
    readonly kind: 'estimator';
    readonly name: BinEstimator;
};
/** A 1-D sample and its numpy dtype class: a list of Python ints is an integer array, which changes
 *  the estimators (bin width ≥ 1) and how reductions accumulate (buffered casts to float64). */
export type Sample = {
    readonly values: Float64Array;
    readonly integer: boolean;
};
export type Range = Option<readonly [number, number]>;
/** np.add.reduce over float64. An integer array is cast to float64 through 8192-element buffers,
 *  each reduced pairwise and accumulated in order. */
export declare function npSum(a: Float64Array, integer?: boolean): number;
/** np.linspace(start, stop, num) for float64. */
export declare function linspace(start: number, stop: number, num: number): Float64Array;
/** np.histogram_bin_edges(a, bins, range, weights) */
export declare function histogramBinEdges(s: Sample, bins: Bins, range: Range, weighted: boolean): Result<Float64Array>;
export type Histogram = {
    readonly counts: Float64Array;
    readonly edges: Float64Array;
};
/** np.histogram(a, bins, range, density, weights) */
export declare function histogram(s: Sample, bins: Bins, range: Range, density: boolean, weights: Option<Float64Array>): Result<Histogram>;
export type HistInput = {
    readonly data: readonly Sample[];
    readonly weights: Option<readonly Float64Array[]>;
    readonly bins: Bins;
    /** hist(range=…); none = the data's nanmin/nanmax */
    readonly range: Range;
    readonly density: boolean;
    /** 0 off, > 0 forward, < 0 reversed (hist's `cumulative=-1`) */
    readonly cumulative: number;
    readonly stacked: boolean;
    readonly inputEmpty: boolean;
};
/** The counting half of Axes.hist: bin edges over all datasets, per-dataset np.histogram, stacking, density and cumulative sums. */
export declare function histTops(h: HistInput): Result<{
    readonly tops: readonly Float64Array[];
    readonly edges: Float64Array;
}>;
