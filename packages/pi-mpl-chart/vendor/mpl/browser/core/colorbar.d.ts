/** The norm a colorbar follows. 'log' is LogNorm (base 10): the long axis takes the norm's LogScale. */
export type ColorbarNorm = {
    readonly kind: 'linear';
    readonly vmin: number;
    readonly vmax: number;
} | {
    readonly kind: 'log';
    readonly vmin: number;
    readonly vmax: number;
};
/** The bar's geometry along its long axis: band edges (N + 1, low to high), each band's colour position in
 *  [0, 1] (what the cmap is indexed with), the view interval, and the long axis' scale. */
export type ColorbarBands = {
    readonly edges: Float64Array;
    readonly colorAt: Float64Array;
    readonly lim: readonly [number, number];
    readonly scale: 'linear' | 'log';
};
/**
 * Colorbar._process_values / _mesh. Linear: edges at lo + span * i/N, colours at band centres (unchanged
 * from before LogNorm support). Log: _uniform_y's linspace through LogNorm.inverse gives the boundaries;
 * vmin/vmax become the first and last boundary (so 10 → 10.000000000000002, as matplotlib's ylim reads);
 * the mesh is _proportional_y renormalized and sent back through the norm at those limits; each band's
 * colour is norm(value) at the arithmetic mean of its boundaries (Colorbar._values).
 */
export declare function colorbarBands(norm: ColorbarNorm, N: number): ColorbarBands;
/** Long-axis axes fraction → data under the bar's scale (extend tips and outline are drawn in axes coordinates). */
export declare function colorbarAxesToData(bands: ColorbarBands, v: number): number;
