// Text metrics modelled on matplotlib's Agg renderer + Text._get_layout, and a
// mathtext model for the one construct tick labels use: [c\times]b^{e}.
//
// Plain text: FT2Font._layout (HarfBuzz shaping, 26.6 advances + kerning) gives the width;
// FT2Font.set_text's ink box gives h and d; _get_layout then floors the ascent and descent at
// the face's OS/2 typo metrics (matplotlib 3.11): a = max(h − d, min_ascent), d = max(d, min_descent).
//
// Mathtext (matplotlib._mathtext, DejaVuSansFontConstants), derived from source and
// checked against VectorParse dumps: glyphs advance by linearHoriAdvance (unrounded);
// a superscript is set at 0.7× after Kern(δ·x_height)·0.7, raised by sup1·x_height,
// followed by script_space·x_height; binary operators get 0.2·quad each side, where
// quad is the advance of 'm'. The box is ceil(width) × (ceil(height) + ceil(depth)).
                                       
import { ftScale, glyphOf, inkExtent, mathMetrics, minMetrics, penPositions, shapeGlyphs } from './fonts.js';
                                                                                
import { assertNever } from './types.js';
export const pxPerPt = (dpi        )         => dpi / 72;
/**
 * A gc linewidth in px, as RendererAgg::points_to_pixels computes it: points * dpi / 72.0.
 * points * (dpi / 72) can be 1 ulp off (1.5 pt at 100 dpi gives 2.083333333333333, not
 * 2.0833333333333335). That moves every stroke offset, and Agg's 24.8 rounding then shifts AA
 * coverage. k = dpi / 72 gives (k * 72) === dpi for every integer dpi up to 1000, so dpi is recovered exactly.
 */
export const strokePx = (points        , k        )         => (points * (k * 72)) / 72;


/** A run of glyphs drawn at one size; (dx, dy) from the pen origin, dy < 0 is up. */
                                                                                                                                                                         
/** What Text._get_layout needs: box width and the lp-clamped ascent/descent, plus how to draw it. */
/** ascent: block top to the last line's baseline; descent: that baseline to the block bottom; lastDescent: the last line's
 *  own descent and height the stacked total, both as Text._get_layout keeps them (ascent + descent can differ by an ulp). */
                                                                                                                                                                                              

/** The face each character draws from: the first of the face and its fallback chain that has it (FT2Font::layout
 *  re-lays out missing clusters with each fallback in turn); none has it → the face's own .notdef. */
function faceFor(face      , ch        )       {
  if (face.cmap.has(ch)) return face;
  for (const f of face.fallback) if (f.cmap.has(ch)) return f;
  return face;
}

/**
 * Text that needs font fallback: libraqm shapes each run of one face on its own (GSUB and kerning stay inside a run)
 * and the pen carries on across runs in 26.6. The ink box is the union of every glyph's box in its own face; the
 * minimum ascent and descent stay the first face's. Glyph offsets are from the text's start, so every run sits at dx 0.
 */
function measureFallback(text        , sizePt        , dpi        , face      )              {
  const groups                                          = [];
  for (const ch of text) {
    const f = faceFor(face, ch), last = groups.length > 0 ? groups[groups.length - 1] : { face, text: '' };
    if (groups.length > 0 && last.face === f) last.text += ch; else groups.push({ face: f, text: ch });
  }
  let pen = 0, lo = Infinity, hi = -Infinity;
  const runs        = groups.map((g) => {
    const scale = ftScale(g.face, sizePt, dpi), gids = shapeGlyphs(g.face, g.text), pens = penPositions(g.face, gids, scale);
    const glyphs = gids.map((gid, i)        => ({ gid, dx: (pen + pens[i]) / 64 }));
    if (gids.length > 0) { const ink = inkExtent(g.face, gids, scale); lo = Math.min(lo, ink.yMin); hi = Math.max(hi, ink.yMax); }
    pen += pens[gids.length];
    return { text: g.text, dx: 0, dy: 0, sizePt, face: g.face.id, glyphs };
  });
  const min = minMetrics(face, sizePt, dpi);
  const h = lo > hi ? 0 : hi - lo, d = lo > hi ? 0 : -lo;
  const descent = Math.max(d, min.descent);
  return { width: pen / 64, ascent: Math.max(h - d, min.ascent), descent, height: Math.max(h - d, min.ascent) + descent, lastDescent: descent, runs };
}

/** Plain single-line text (Agg path): FT2Font pen positions, 26.6 exact. */
function measurePlain(text        , sizePt        , dpi        , face      )              {
  if (face.fallback.length > 0 && [...text].some((ch) => !face.cmap.has(ch))) return measureFallback(text, sizePt, dpi, face);
  const scale = ftScale(face, sizePt, dpi);
  const gids = shapeGlyphs(face, text), pens = penPositions(face, gids, scale);
  const glyphs = gids.map((gid, i)        => ({ gid, dx: pens[i] / 64 }));
  const ink = inkExtent(face, gids, scale), min = minMetrics(face, sizePt, dpi);
  const h = text === '' ? 0 : ink.yMax - ink.yMin, d = text === '' ? 0 : -ink.yMin;
  const descent = Math.max(d, min.descent);
  return { width: text === '' ? 0 : pens[pens.length - 1] / 64, ascent: Math.max(h - d, min.ascent), descent, height: Math.max(h - d, min.ascent) + descent, lastDescent: descent,
           runs: [{ text, dx: 0, dy: 0, sizePt, face: face.id, glyphs }] };
}

/** Multi-line text as Text._get_layout lays it out (linespacing 'normal', the 3.11 default): each line
 *  keeps its ink ascent and descent floored at the face's typo metrics, plus half the typo line gap
 *  above and below; lines stack with no further leading. Lines align within the block by the
 *  multialignment, which defaults to the horizontal alignment. The block's anchor baseline is the
 *  last line's (va='baseline' puts the last baseline on y). */
function measureMultiline(text        , sizePt        , dpi        , face      , malign        )              {
  const lines = text.split('\n');
  const scale = 1 / face.upm * sizePt * dpi / 72;
  const gap = face.data.typo[2] * scale;
  const m = lines.map((t) => measurePlain(t, sizePt, dpi, face));          // ascent/descent already floored
  const a = m.map((mm) => mm.ascent + gap / 2), d = m.map((mm) => mm.descent + gap / 2);
  const width = Math.max(...m.map((mm) => mm.width));
  const baselines           = [];
  let y = 0;
  for (let i = 0; i < m.length; i++) { y += a[i]; baselines.push(y); y += d[i]; }
  const H = y, last = baselines[baselines.length - 1];
  const shift = (w        )         => (malign === 'left' ? 0 : malign === 'right' ? width - w : width / 2 - w / 2);
  const runs        = m.flatMap((mm, i) => mm.runs.map((r) => ({ ...r, dx: r.dx + shift(mm.width), dy: r.dy + baselines[i] - last })));
  return { width, ascent: last, descent: H - last, height: H, lastDescent: d[d.length - 1], runs };
}

/** Plain or multi-line text; `malign` aligns the lines of a multi-line block. */
export function measure(text        , sizePt        , dpi        , face      , malign         = 'left')              {
  return text.includes('\n') ? measureMultiline(text, sizePt, dpi, face, malign) : measurePlain(text, sizePt, dpi, face);
}

/**
 * The renderer's h − d for "lp" (raw ink ascent, without _get_layout's floors). TextArea.get_bbox
 * floors a legend label's height above the baseline at it: h_d = max(h_lp − d_lp, h − yd).
 */
export function lpAscent(sizePt        , dpi        , face      )         {
  return inkExtent(face, shapeGlyphs(face, 'lp'), ftScale(face, sizePt, dpi)).yMax;
}

// ---- mathtext
const SHRINK = 0.7;
const X_HEIGHT = 1120 / 2048;                       // DejaVuSansFontConstants.x_height
const SUP1 = 845.824 / 1120, DELTA = 0.025, SCRIPT_SPACE = 0.05;
const MINUS = '−', TIMES = '×';

                                                                            
/**
 * Append glyphs at FreeType's linearHoriAdvance; track the box height (iceberg + raise) and
 * depth relative to the baseline, as mathtext's Hlist packing does.
 */
// \mathdefault{} selects mathtext's 'default' font: findfont(the Text's FontProperties), i.e. the
// label's own face (DejaVuFonts looks in DejaVu Sans Display first, which has none of these
// characters). The layout constants (x_height, sup1, ...) stay the dejavusans fontset's.
function place(acc     , face      , text        , sizePt        , dpi        , raise        , shrink        )       {
  // Scripts are built at the parent size and then Char.shrink()-ed: metrics scale by the factor.
  const x0 = acc.x, glyphs          = [];
  for (const ch of text) {
    const m = mathMetrics(face, ch, sizePt, dpi);
    glyphs.push({ gid: glyphOf(face, ch), dx: acc.x - x0 });
    acc.x += m.advance * shrink;
    acc.top = Math.max(acc.top, m.iceberg * shrink + raise);
    acc.bottom = Math.max(acc.bottom, m.depth * shrink - raise);
  }
  acc.runs.push({ text, dx: x0, dy: -raise, sizePt: sizePt * shrink, face: face.id, glyphs });
}

function mathPower(coeff        , base        , exponent        , sizePt        , dpi        , face      )              {
  const em = sizePt * pxPerPt(dpi);
  const xh = X_HEIGHT * em;
  const acc      = { x: 0, top: 0, bottom: 0, runs: [] };
  if (coeff !== '') {
    place(acc, face, coeff, sizePt, dpi, 0, 1);
    const space = 0.2 * mathMetrics(face, 'm', sizePt, dpi).advance;
    acc.x += space;
    place(acc, face, TIMES, sizePt, dpi, 0, 1);
    acc.x += space;
  }
  place(acc, face, base, sizePt, dpi, 0, 1);
  acc.x += DELTA * xh * SHRINK;
  place(acc, face, String(exponent).replace('-', MINUS), sizePt, dpi, SUP1 * xh, SHRINK);
  acc.x += SCRIPT_SPACE * xh;
  const h = Math.ceil(acc.top) + Math.ceil(acc.bottom), d = Math.ceil(acc.bottom);
  // VectorParse puts glyphs at ceil(height) - oy: the baseline sits ceil(H) - H above the box's.
  const lift = Math.ceil(acc.top) - acc.top;
  const runs = acc.runs.map((r) => ({ ...r, dy: r.dy - lift }));
  // Text._get_layout clamps ascent and descent separately: a = max(h - d, min_ascent), d = max(d, min_descent)
  const min = minMetrics(face, sizePt, dpi);
  const ascent = Math.max(h - d, min.ascent), descent = Math.max(d, min.descent);
  return { width: Math.ceil(acc.x), ascent, descent, height: ascent + descent, lastDescent: descent, runs };
}

/** A tick label; `malign` is its horizontal alignment, which also aligns the lines of a multi-line label. */
export function measureLabel(l           , sizePt        , dpi        , face      , malign        )              {
  switch (l.kind) {
    case 'plain': return measure(l.text, sizePt, dpi, face, malign);
    case 'power': return mathPower(l.coeff.kind === 'some' ? l.coeff.value : '', l.base, l.exponent, sizePt, dpi, face);
    default: return assertNever(l);
  }
}

/** Layout box (top-left coords), pen/baseline origin, and the runs to draw. */
                       
                                                                                     
                                                                                                           
  

export function placeLayout(m             , x        , y        , p           )          {
  const H = m.ascent + m.descent;
  switch (p.kind) {
    case 'horizontal': {
      const x0 = p.ha === 'left' ? x : p.ha === 'right' ? x - m.width : x - m.width / 2;
      const top = verticalTop(p.va, y, H, m.ascent);
      return { x0, y0: top, x1: x0 + m.width, y1: top + H, penX: x0, penY: top + m.ascent, rotation: 'horizontal', runs: m.runs };
    }
    case 'ylabel': {
      // rotation=90, ha=center, va=bottom (measured on 3.11.2): the rotated box spans
      // x ∈ [x-H, x], centred vertically on the anchor; baseline is the line x - descent.
      const top = y - m.width / 2;
      return { x0: x - H, y0: top, x1: x, y1: top + m.width, penX: x - m.descent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    case 'ylabelRight': {
      // rotation=90, ha=center, va=top (label_position='right'): box spans x ∈ [x, x+H]; baseline at x + ascent.
      const top = y - m.width / 2;
      return { x0: x, y0: top, x1: x + H, y1: top + m.width, penX: x + m.ascent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    case 'vertical': {
      // rotation=90, rotation_mode='default' (Text._get_layout): rotate first, then ha/va align the rotated box.
      // The rotated box is H wide and m.width tall; the text runs upward with its baseline at x0 + ascent.
      const x0 = p.ha === 'left' ? x : p.ha === 'right' ? x - H : x - H / 2;
      const top = verticalTop(p.va === 'baseline' || p.va === 'center_baseline' ? 'center' : p.va, y, m.width, m.width / 2);
      return { x0, y0: top, x1: x0 + H, y1: top + m.width, penX: x0 + m.ascent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    case 'angled': {
      // Text._get_layout rotation_mode='default': rotate the unrotated AABB, then ha/va-align that box on (x, y).
      const W = m.width, Ht = m.height;
      const xmin0 = 0, xmax0 = W, ymin0 = -Ht, ymax0 = 0;
      const rad = (p.deg * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
      const rotPt = (px        , py        )                            => [px * c - py * s, px * s + py * c];
      const corners = [rotPt(xmin0, ymin0), rotPt(xmin0, ymax0), rotPt(xmax0, ymax0), rotPt(xmax0, ymin0)];
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      for (const [cx, cy] of corners) {
        if (cx < xmin) xmin = cx; if (cx > xmax) xmax = cx;
        if (cy < ymin) ymin = cy; if (cy > ymax) ymax = cy;
      }
      const ox = p.ha === 'left' ? xmin : p.ha === 'right' ? xmax : (xmin + xmax) / 2;
      const oy = p.va === 'bottom' ? ymin
        : p.va === 'top' ? ymax
        : p.va === 'center' ? (ymin + ymax) / 2
        : p.va === 'baseline' ? ymin + m.lastDescent
        : (ymin + (ymax - ymin)) - m.ascent / 2; // center_baseline
      // placeLayout anchors are y-down (SVG); matplotlib's offset math is y-up — flip oy.
      // Baseline in the unrotated box is (0, -ascent) (ymax=0 at the top). Text.draw passes
      // rotate(0, -ascent)-(ox, oy)+anchor into Agg; placeLayout anchors are y-down so flip by.
      const [bx, by] = rotPt(0, -m.ascent);
      const penX = x + bx - ox, penY = y - by + oy;
      return {
        x0: x + xmin - ox, y0: y - ymax + oy, x1: x + xmax - ox, y1: y - ymin + oy,
        penX, penY, rotation: { kind: 'angled', deg: p.deg }, runs: m.runs,
      };
    }
    default: return assertNever(p);
  }
}

/**
 * Text.get_window_extent for unrotated text anchored at display (x, y), y up, in matplotlib's own arithmetic order
 * (Text._get_layout's offsets, Bbox.from_bounds, then translated), so the corners match to the last bit. A top-left
 * layout flipped with H - y can differ by an ulp, which moves an annotation arrow's antialiased edge.
 */
export function windowExtent(m             , x        , y        , ha        , va                                                              )                                                                                         {
  const width = m.width, height = m.height;                   // xmax - xmin and ymax - ymin, with xmin = ymax = 0
  const ymin = -height;                                        // ys[-1] - descent: the negated stack, which rounds alike
  const offsetx = ha === 'left' ? 0 : ha === 'right' ? width : width / 2;
  const offsety = va === 'bottom' ? ymin : va === 'top' ? 0 : va === 'center' ? ymin / 2
    : va === 'baseline' ? ymin + m.lastDescent : (ymin + height) - m.ascent / 2;
  const x0 = 0 - offsetx, y0 = ymin - offsety;
  return { x0: x0 + x, y0: y0 + y, x1: (x0 + width) + x, y1: (y0 + height) + y };
}

/** Text._get_multialignment: the horizontal alignment (rotated axis labels are centred). */
const malignOf = (p           )         => {
  switch (p.kind) {
    case 'horizontal': case 'vertical': case 'angled': return p.ha;
    case 'ylabel': case 'ylabelRight': return 'center';
    default: return assertNever(p);
  }
};
export const placeText = (text        , sizePt        , dpi        , face      , x        , y        , p           )          =>
  placeLayout(measure(text, sizePt, dpi, face, malignOf(p)), x, y, p);

function verticalTop(va                                                              , y        , H        , ascent        )         {
  switch (va) {
    case 'top': return y;
    case 'bottom': return y - H;
    case 'center': return y - H / 2;
    case 'baseline': return y - ascent;
    case 'center_baseline': return y - ascent / 2;
    default: return assertNever(va);
  }
}
