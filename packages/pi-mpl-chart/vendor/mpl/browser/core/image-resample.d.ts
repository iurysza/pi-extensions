export type InterpName = 'nearest' | 'none' | 'antialiased' | 'auto' | 'hanning' | 'bilinear';
/** Matplotlib Affine2D matrix: x′=sx·x + shx·y + tx; y′=shy·x + sy·y + ty (input→output). */
export type Aff = {
    readonly sx: number;
    readonly shy: number;
    readonly shx: number;
    readonly sy: number;
    readonly tx: number;
    readonly ty: number;
};
export declare const affScale: (sx: number, sy: number) => Aff;
export declare class UnsupportedInterpolationError extends Error {
    readonly interpolation: string;
    constructor(interpolation: string, detail: string);
}
/** Resolve auto/antialiased → nearest | hanning (matplotlib.image._resample). */
export declare function resolveInterp(interp: InterpName, dataW: number, dataH: number, dispW: number, dispH: number): 'nearest' | 'hanning' | 'bilinear';
/** matplotlib interpolation_stage: zoom = display_px / data_px. */
export declare function interpolationStage(dataW: number, dataH: number, dispW: number, dispH: number): 'data' | 'rgba';
type FilterKind = 'hanning' | 'bilinear';
/**
 * Axis-aligned AGG span_image_resample_gray_affine for float64.
 * `aff` is the matplotlib affine (input→output), matching `_image.resample`.
 */
export declare function resampleAffineFloat(src: Float64Array, srcW: number, srcH: number, out: Float64Array, outW: number, outH: number, aff: Aff, kind: FilterKind): void;
/**
 * Axis-aligned AGG span_image_resample_rgba_affine for float32 RGBA (premultiplied).
 * src/out are tightly packed RGBA float32 in [0,1] (or premultiplied).
 */
export declare function resampleAffineRgba(src: Float32Array, srcW: number, srcH: number, out: Float32Array, outW: number, outH: number, aff: Aff, kind: FilterKind): void;
export declare function resampleHanningFloat(src: Float64Array, srcW: number, srcH: number, out: Float64Array, outW: number, outH: number, affineSx: number, affineSy: number): void;
export declare function resampleBilinearFloat(src: Float64Array, srcW: number, srcH: number, out: Float64Array, outW: number, outH: number, affineSx: number, affineSy: number): void;
export declare function resampleHanningRgba(src: Float32Array, srcW: number, srcH: number, out: Float32Array, outW: number, outH: number, aff: Aff): void;
export {};
