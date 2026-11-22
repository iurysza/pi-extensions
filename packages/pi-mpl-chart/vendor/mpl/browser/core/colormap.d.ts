import { CMAP_NAMES } from './data/colormaps.js';
import type { Option, Paint, Result, Rgb } from './types.js';
/** Packed LUT: trunc RGBA×(N+3) then round RGBA×(N+3), base64. */
export type CmapPack = {
    readonly name: string;
    readonly N: number;
    readonly b64: string;
};
/** A baked colormap: N LUT entries plus under / over / bad. */
export type Colormap = {
    readonly name: string;
    readonly N: number;
    /** bytes=True (trunc): RGBA uint8, length 4·(N+3) */
    readonly trunc: Uint8Array;
    /** Agg/SVG (round): RGBA uint8, length 4·(N+3) */
    readonly round: Uint8Array;
    /** Exact matplotlib float32 `_lut` for rgba-stage AGG resample; none until registerColormapRgba. */
    readonly rgba: Option<Float32Array>;
};
/** Register one or more colormap packs (each `src/colormaps/*.ts` export).
 *  `_r` variants are separate packs from matplotlib (LinearSegmentedColormap.reversed rebuilds segmentdata — a LUT
 *  flip is wrong). Registering a name again replaces it, float32 sidecar included. */
export declare function registerColormaps(...ps: readonly CmapPack[]): void;
/**
 * Rendering (or getColormap) needed a shipped colormap that has not been passed to registerColormaps().
 * Never falls back to another map.
 */
export declare class ColormapNotLoadedError extends Error {
    readonly cmap: string;
    readonly module: string;
    readonly binding: string;
    constructor(name: string);
}
/**
 * rgba-stage imshow needs the exact matplotlib float32 `_lut`. Without registerColormapRgba the
 * library must not silently use round/255 (that diverges from Agg by thousands of pixels).
 */
export declare class MissingColormapRgbaError extends Error {
    readonly cmap: string;
    readonly module: string;
    readonly binding: string;
    constructor(name: string);
}
/** Float32 `_lut` for rgba-stage; throws MissingColormapRgbaError if not registered. */
export declare function requireColormapRgba(cmap: Colormap): Float32Array;
/** Float32 LUT sidecar (matplotlib `_lut`) for rgba-stage AGG resampling. */
export type CmapRgbaPack = {
    readonly name: string;
    readonly N: number;
    readonly b64: string;
};
/**
 * Attach exact float32 `_lut` packs. Packs whose colormap is not registered are skipped
 * (so `registerColormapRgba(plasma_rgba, plasma_r_rgba)` after only `registerColormaps(plasma)` is fine).
 */
export declare function registerColormapRgba(...ps: readonly CmapRgbaPack[]): void;
/** matplotlib.pyplot.get_cmap. Unknown names and unregistered shipped names error with the import to add. */
export declare function getColormap(name: string): Result<Colormap>;
/** Like getColormap but throws ColormapNotLoadedError for an unregistered shipped name. */
export declare function requireColormap(name: string): Colormap;
export declare const availableColormaps: () => readonly string[];
export declare const registeredColormaps: () => readonly string[];
/** RGBA uint8 → Paint (hex + alpha in [0,1]). Fully transparent → none. */
export declare function rgbaToPaint(r: number, g: number, b: number, a: number): Paint;
export declare function rgbaToRgb(r: number, g: number, b: number, a: number): Rgb;
/** Colormap.__call__(X, bytes=True). */
export declare function mapBytes(cmap: Colormap, xs: ArrayLike<number>, out: Uint8Array): Uint8Array;
/** Convenience: one float → RGBA uint8 tuple (bytes=True). */
export declare function mapOneBytes(cmap: Colormap, x: number): readonly [number, number, number, number];
/** Map normalized floats to Paint[] using Agg's rounded uint8 LUT. */
export declare function mapPaints(cmap: Colormap, xs: ArrayLike<number>): readonly Paint[];
export type Norm = {
    readonly kind: 'linear';
    readonly vmin: number;
    readonly vmax: number;
    readonly clip: boolean;
} | {
    readonly kind: 'log';
    readonly vmin: number;
    readonly vmax: number;
    readonly clip: boolean;
} | {
    readonly kind: 'twoslope';
    readonly vmin: number;
    readonly vcenter: number;
    readonly vmax: number;
    readonly clip: boolean;
};
export declare const normalize: (vmin: number, vmax: number, clip?: boolean) => Norm;
export declare const logNorm: (vmin: number, vmax: number, clip?: boolean) => Norm;
export declare const twoSlopeNorm: (vmin: number, vcenter: number, vmax: number, clip?: boolean) => Norm;
export declare function autoscaleNorm(n: Norm, data: ArrayLike<number>): Norm;
/** The norm's vmin/vmax with any missing (NaN) one taken from the data (Normalize/LogNorm.autoscale_None):
 *  finite values, and for LogNorm only positive ones. A LogNorm with no positive data throws. */
export declare function normLimits(n: Norm, data: ArrayLike<number>): readonly [number, number];
export declare function applyNorm(n: Norm, xs: ArrayLike<number>, out: Float64Array): Float64Array;
export declare function scalarToPaints(cmap: Colormap, norm: Norm, data: ArrayLike<number>): readonly Paint[];
export declare function parseColormap(v: unknown): Result<Colormap>;
export declare function parseNormKw(opts: {
    readonly vmin: Option<number>;
    readonly vmax: Option<number>;
    readonly norm: Option<unknown>;
}): Result<Norm>;
export declare function isNumericColorArray(v: unknown): v is ArrayLike<number>;
export { CMAP_NAMES };
