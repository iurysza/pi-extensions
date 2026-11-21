import type { Canvas } from './agg/canvas.js';
/** Palette entries as RGBA bytes (4 per entry), and one palette index per pixel, row-major. */
export type Indexed = {
    readonly palette: Uint8Array;
    readonly size: number;
    readonly index: Uint8Array;
};
/**
 * The canvas as palette indices with at most `max` (1..256) entries. Exact when the canvas has that few colors;
 * otherwise quantized as described above. Entries are ordered most frequent first.
 */
export declare function quantize(c: Canvas, max: number): Indexed;
