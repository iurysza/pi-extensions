import type { Scale } from './types.js';
export declare function forward(s: Scale, v: number): number;
/** InvertedLogTransform: np.exp(v * np.log(base)) for base 10 (numpy has no exp10 in its table). */
export declare function inverse(s: Scale, v: number): number;
/** Typed-array forward transform; the switch is outside the loop. */
export declare function forwardAll(s: Scale, src: Float64Array): Float64Array;
