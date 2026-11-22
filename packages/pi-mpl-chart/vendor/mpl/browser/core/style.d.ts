import type { RcLayer, RcValue } from './rc.js';
import type { Result } from './types.js';
export type StyleSpec = {
    readonly kind: 'bundled';
    readonly name: string;
} | {
    readonly kind: 'text';
    readonly text: string;
} | {
    readonly kind: 'layer';
    readonly layer: RcLayer;
};
/** cycler('color', ['E24A33', '348ABD']) -> ['#e24a33', '#348abd'] */
export declare function parsePropCycle(v: string): Result<RcValue>;
/** Parse .mplstyle / matplotlibrc text. */
export declare function parseStyle(text: string): Result<RcLayer>;
export declare function bundledStyle(name: string): Result<RcLayer>;
/** Compose DEFAULTS and style layers; later wins. */
export declare function composeStyles(specs: readonly StyleSpec[]): Result<RcLayer>;
export declare const availableStyles: () => readonly string[];
