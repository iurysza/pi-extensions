import type { Paint, Result, Rgb } from './types.js';
/**
 * '#rgb' '#rgba' '#rrggbb' '#rrggbbaa', named, 'tab:blue', 'CN' (via cycle),
 * grayscale '0.8', [r, g, b(, a)] in 0..1, or 'none'.
 */
export declare function parsePaint(spec: unknown, cycle: readonly Rgb[]): Result<Paint>;
/** A color that must be visible-capable (not 'none'). */
export declare function parseRgb(spec: unknown, cycle: readonly Rgb[]): Result<Rgb>;
/** rc files also accept bare hex ('E5E5E5'); normalize before parsing. */
export declare const rcColorString: (s: string) => string;
