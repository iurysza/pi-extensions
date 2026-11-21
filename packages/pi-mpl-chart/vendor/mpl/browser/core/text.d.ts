import type { Face } from './fonts.js';
import type { Glyph, HAlign, Placement, Rotation, TickLabel } from './types.js';
export declare const pxPerPt: (dpi: number) => number;
/**
 * A gc linewidth in px, as RendererAgg::points_to_pixels computes it: points * dpi / 72.0.
 * points * (dpi / 72) can be 1 ulp off (1.5 pt at 100 dpi gives 2.083333333333333, not
 * 2.0833333333333335). That moves every stroke offset, and Agg's 24.8 rounding then shifts AA
 * coverage. k = dpi / 72 gives (k * 72) === dpi for every integer dpi up to 1000, so dpi is recovered exactly.
 */
export declare const strokePx: (points: number, k: number) => number;
/** A run of glyphs drawn at one size; (dx, dy) from the pen origin, dy < 0 is up. */
export type Run = {
    readonly text: string;
    readonly dx: number;
    readonly dy: number;
    readonly sizePt: number;
    readonly face: string;
    readonly glyphs: readonly Glyph[];
};
/** What Text._get_layout needs: box width and the lp-clamped ascent/descent, plus how to draw it. */
/** ascent: block top to the last line's baseline; descent: that baseline to the block bottom; lastDescent: the last line's
 *  own descent and height the stacked total, both as Text._get_layout keeps them (ascent + descent can differ by an ulp). */
export type LabelLayout = {
    readonly width: number;
    readonly ascent: number;
    readonly descent: number;
    readonly height: number;
    readonly lastDescent: number;
    readonly runs: readonly Run[];
};
/** Plain or multi-line text; `malign` aligns the lines of a multi-line block. */
export declare function measure(text: string, sizePt: number, dpi: number, face: Face, malign?: HAlign): LabelLayout;
/**
 * The renderer's h − d for "lp" (raw ink ascent, without _get_layout's floors). TextArea.get_bbox
 * floors a legend label's height above the baseline at it: h_d = max(h_lp − d_lp, h − yd).
 */
export declare function lpAscent(sizePt: number, dpi: number, face: Face): number;
/** A tick label; `malign` is its horizontal alignment, which also aligns the lines of a multi-line label. */
export declare function measureLabel(l: TickLabel, sizePt: number, dpi: number, face: Face, malign: HAlign): LabelLayout;
/** Layout box (top-left coords), pen/baseline origin, and the runs to draw. */
export type TextBox = {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
    readonly penX: number;
    readonly penY: number;
    readonly rotation: Rotation;
    readonly runs: readonly Run[];
};
export declare function placeLayout(m: LabelLayout, x: number, y: number, p: Placement): TextBox;
/**
 * Text.get_window_extent for unrotated text anchored at display (x, y), y up, in matplotlib's own arithmetic order
 * (Text._get_layout's offsets, Bbox.from_bounds, then translated), so the corners match to the last bit. A top-left
 * layout flipped with H - y can differ by an ulp, which moves an annotation arrow's antialiased edge.
 */
export declare function windowExtent(m: LabelLayout, x: number, y: number, ha: HAlign, va: 'top' | 'bottom' | 'center' | 'baseline' | 'center_baseline'): {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
};
export declare const placeText: (text: string, sizePt: number, dpi: number, face: Face, x: number, y: number, p: Placement) => TextBox;
