import type { Scene } from '../core/types.js';
import type { Tracer } from '../trace.js';
import type { Canvas } from './agg/canvas.js';
import type { PngOptions, PngSyncOptions } from './png.js';
export type { Canvas } from './agg/canvas.js';
/** Rasterize a Scene. Canvas size truncates like RendererAgg(int(w), int(h)). */
export declare function renderRGBA(scene: Scene, tracer: Tracer): Canvas;
/**
 * Rasterize a Scene into `out` (a canvas the caller owns and is done with, e.g. the previous frame's) when it has the
 * scene's size: its pixels are cleared and overwritten, and the result shares its buffers. Any other size renders
 * into a fresh canvas, as renderRGBA. A re-render loop (pan, zoom, animation) then skips allocating and first-touching
 * a new buffer every frame.
 */
export declare function renderRGBAInto(out: Canvas, scene: Scene, tracer: Tracer): Canvas;
/**
 * Rasterize into the kept scratch canvas. The result is only valid until the next call: encode it
 * and drop it (toPNGSync). Callers that keep pixels use renderRGBA.
 */
export declare function renderScratch(scene: Scene, tracer: Tracer): Canvas;
/** Drop the scratch canvas kept by toPNGSync (memory back to the GC). */
export declare function releaseScratch(): void;
/** Scene to PNG bytes (CompressionStream); opts.colors writes a palette PNG (see png.ts). */
export declare const toPNG: (scene: Scene, tracer: Tracer, opts?: PngOptions) => Promise<Uint8Array>;
/** Scene to PNG bytes with the built-in deflate; opts.level sets its effort (1..9). */
export declare const toPNGSync: (scene: Scene, tracer: Tracer, opts?: PngSyncOptions) => Uint8Array;
export declare const toPNGStream: (scene: Scene, tracer: Tracer, opts?: PngOptions) => ReadableStream<Uint8Array>;
