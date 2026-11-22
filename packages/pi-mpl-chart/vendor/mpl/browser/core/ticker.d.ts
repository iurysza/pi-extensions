export declare function pyDivmod(a: number, b: number): readonly [number, number];
export declare const pyFloorDiv: (a: number, b: number) => number;
export declare const pow10: (n: number) => number;
export declare function nonsingular(vmin: number, vmax: number, expander: number, tiny: number, increasing: boolean): readonly [number, number];
export declare function scaleRange(vmin: number, vmax: number, n: number, threshold: number): readonly [number, number];
export type NBins = {
    readonly kind: 'auto';
} | {
    readonly kind: 'fixed';
    readonly n: number;
};
export type Prune = 'none' | 'lower' | 'upper' | 'both';
export type MaxNParams = {
    readonly nbins: NBins;
    readonly steps: readonly number[];
    readonly integer: boolean;
    readonly symmetric: boolean;
    readonly prune: Prune;
    readonly minNTicks: number;
};
export declare const AUTO_LOCATOR: MaxNParams;
export declare function maxNTickValues(p: MaxNParams, vmin: number, vmax: number, tickSpace: number): number[];
export declare const autoTicks: (vmin: number, vmax: number, tickSpace: number) => number[];
export type ScalarOptions = {
    readonly useOffset: boolean;
    readonly offsetThreshold: number;
    readonly powerlimits: readonly [number, number];
    readonly unicodeMinus: boolean;
};
export type ScalarFormat = {
    readonly labels: readonly string[];
    readonly offset: string;
};
/** ScalarFormatter.set_locs + __call__ + get_offset, as one pure function. */
export declare function scalarFormat(locs: readonly number[], view: readonly [number, number], o: ScalarOptions): ScalarFormat;
