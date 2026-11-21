// Glyph rendering as matplotlib 3.11's Agg backend does it: one FreeType bitmap per
// glyph (RendererAgg._draw_text_glyphs_and_boxes, text.hinting = 'no_hinting').
// Ported from FreeType 2.14.3 so the integer arithmetic matches:
//   - FT_Set_Char_Size → x_scale = FT_DivFix(ppem26, upem); points via FT_MulFix
//   - FT_Set_Transform matrix/delta (26.6) applied by FT_Load_Glyph
//   - FT_Outline_Decompose (implied on-curve midpoints, C truncating division)
//   - ftgrays: 24.8 cells, the DDA conic, the bisecting cubic (CFF faces), gray_render_line with FT_UDIV reciprocals,
//     and FT_FILL_RULE for the non-zero winding rule.
                                             
import { mulFix } from '../core/fonts.js';
import { lookup } from '../core/std.js';
import { assertNever } from '../core/types.js';
                                                     
import { blendCoverage } from './agg/canvas.js';
                                                
import { denseCoverage } from './agg/raster.js';

// ------------------------------------------------------------------ ftgrays
const PIXEL_BITS = 8, ONE_PIXEL = 256;
const TRUNC = (x        )         => x >> PIXEL_BITS;
const FRACT = (x        )         => x & (ONE_PIXEL - 1);
const UPSCALE = (x        )         => x * (ONE_PIXEL >> 6);
const TWO32 = 4294967296;
const recip = (d        )         => Math.trunc(0xffffffff / Math.abs(d));
const udiv = (a        , r        )         => Math.floor(a * r / TWO32);
/** An integer v (exact double) as v = hi32(v)·2^32 + lo32(v), 0 ≤ lo32(v) < 2^32; both exact. */
const hi32 = (v        )         => Math.floor(v / TWO32);
const lo32 = (v        )         => v - hi32(v) * TWO32;

/** conicSteps' output: (x, y) pairs, 24.8. d < 2^31 bounds the count by 2^13. */
export const CONIC_STEPS               = new Float64Array(2 << 13);
/**
 * gray_render_conic's subdivision of the conic p0 → p1 → p2 (24.8): 0 when it is flat enough for one line to
 * p2, else the count of DDA points, written to CONIC_STEPS. FreeType steps in 64-bit fixed point (values scaled
 * by 2^32); here each value is two integer words, v = h·2^32 + l with 0 ≤ l < 2^32. Every word stays far below
 * 2^53, so each double sum is exact, and a point is p's high word, FreeType's p >> 32 (arithmetic: floor).
 * Scaling by a power of two is exact. (test/conic.test.ts checks it against the 64-bit arithmetic in BigInt.)
 */
export function conicSteps(p0x        , p0y        , p1x        , p1y        , p2x        , p2y        )         {
  const bx = p1x - p0x, by = p1y - p0y;
  const ax = p2x - p1x - bx, ay = p2y - p1y - by;
  let d = Math.max(Math.abs(ax), Math.abs(ay));
  if (d <= ONE_PIXEL / 4) return 0;
  let shift = 16;
  do { d >>= 2; shift--; } while (d > ONE_PIXEL / 4);
  const count = 0x10000 >>> shift;
  const r0x = ax * 2 ** (2 * shift), r0y = ay * 2 ** (2 * shift);
  const b0x = bx * 2 ** (shift + 17), b0y = by * 2 ** (shift + 17);
  // q = b·2^(shift+17) + r, and r doubles after
  let qxh = hi32(b0x) + hi32(r0x), qxl = lo32(b0x) + lo32(r0x);
  let qyh = hi32(b0y) + hi32(r0y), qyl = lo32(b0y) + lo32(r0y);
  let c = Math.floor(qxl / TWO32); qxh += c; qxl -= c * TWO32;
  c = Math.floor(qyl / TWO32); qyh += c; qyl -= c * TWO32;
  const rxh = hi32(2 * r0x), rxl = lo32(2 * r0x), ryh = hi32(2 * r0y), ryl = lo32(2 * r0y);
  let pxh = p0x, pxl = 0, pyh = p0y, pyl = 0;
  for (let i = 0; i < 2 * count; i += 2) {
    pxl += qxl; pxh += qxh; c = Math.floor(pxl / TWO32); pxh += c; pxl -= c * TWO32;
    pyl += qyl; pyh += qyh; c = Math.floor(pyl / TWO32); pyh += c; pyl -= c * TWO32;
    qxl += rxl; qxh += rxh; c = Math.floor(qxl / TWO32); qxh += c; qxl -= c * TWO32;
    qyl += ryl; qyh += ryh; c = Math.floor(qyl / TWO32); qyh += c; qyl -= c * TWO32;
    CONIC_STEPS[i] = pxh; CONIC_STEPS[i + 1] = pyh;
  }
  return count;
}

/** One glyph's worth of ftgrays state over a pixel box (FreeType y-up rows). */
class Gray {
           w        ;          h        ;
           cover            ;          area            ;
  x = 0; y = 0;
  cell = -1;
           minEx        ;          minEy        ;          maxEx        ;          maxEy        ;
  constructor(minEx        , minEy        , maxEx        , maxEy        ) {
    this.minEx = minEx; this.minEy = minEy; this.maxEx = maxEx; this.maxEy = maxEy;
    // column 0 holds cells left of the box (FreeType's min_ex - 1)
    this.w = maxEx - minEx + 1; this.h = maxEy - minEy;
    this.cover = new Int32Array(this.w * this.h); this.area = new Int32Array(this.w * this.h);
  }
  setCell(ex        , ey        )       {
    if (ey < this.minEy || ey >= this.maxEy || ex >= this.maxEx) { this.cell = -1; return; }
    const c = Math.max(ex, this.minEx - 1) - (this.minEx - 1);
    this.cell = (ey - this.minEy) * this.w + c;
  }
  integrate(a        , b        )       {
    if (this.cell < 0) return;
    this.cover[this.cell] += a; this.area[this.cell] += a * b;
  }
  moveTo(x26        , y26        )       {
    const x = UPSCALE(x26), y = UPSCALE(y26);
    this.setCell(TRUNC(x), TRUNC(y));
    this.x = x; this.y = y;
  }
  lineTo(x26        , y26        )       { this.renderLine(UPSCALE(x26), UPSCALE(y26)); }

  renderLine(toX        , toY        )       {
    let ey1 = TRUNC(this.y);
    const ey2 = TRUNC(toY);
    if ((ey1 >= this.maxEy && ey2 >= this.maxEy) || (ey1 < this.minEy && ey2 < this.minEy)) { this.x = toX; this.y = toY; return; }
    let ex1 = TRUNC(this.x);
    const ex2 = TRUNC(toX);
    let fx1 = FRACT(this.x), fy1 = FRACT(this.y);
    let fx2        , fy2        ;
    const dx = toX - this.x, dy = toY - this.y;
    if (ex1 === ex2 && ey1 === ey2) {
      // inside one cell
    } else if (dy === 0) {
      this.setCell(ex2, ey2); this.x = toX; this.y = toY; return;
    } else if (dx === 0) {
      if (dy > 0) {
        do { fy2 = ONE_PIXEL; this.integrate(fy2 - fy1, fx1 * 2); fy1 = 0; ey1++; this.setCell(ex1, ey1); } while (ey1 !== ey2);
      } else {
        do { fy2 = 0; this.integrate(fy2 - fy1, fx1 * 2); fy1 = ONE_PIXEL; ey1--; this.setCell(ex1, ey1); } while (ey1 !== ey2);
      }
    } else {
      let prod = dx * fy1 - dy * fx1;
      const dxr = ex1 !== ex2 ? recip(dx) : 0, dyr = ey1 !== ey2 ? recip(dy) : 0;
      do {
        if (prod - dx * ONE_PIXEL > 0 && prod <= 0) {                                   // left
          fx2 = 0; fy2 = udiv(-prod, dxr);
          prod -= dy * ONE_PIXEL;
          this.integrate(fy2 - fy1, fx1 + fx2);
          fx1 = ONE_PIXEL; fy1 = fy2; ex1--;
        } else if (prod - dx * ONE_PIXEL + dy * ONE_PIXEL > 0 && prod - dx * ONE_PIXEL <= 0) {   // up
          prod -= dx * ONE_PIXEL;
          fx2 = udiv(-prod, dyr); fy2 = ONE_PIXEL;
          this.integrate(fy2 - fy1, fx1 + fx2);
          fx1 = fx2; fy1 = 0; ey1++;
        } else if (prod + dy * ONE_PIXEL >= 0 && prod - dx * ONE_PIXEL + dy * ONE_PIXEL <= 0) {  // right
          prod += dy * ONE_PIXEL;
          fx2 = ONE_PIXEL; fy2 = udiv(prod, dxr);
          this.integrate(fy2 - fy1, fx1 + fx2);
          fx1 = 0; fy1 = fy2; ex1++;
        } else {                                                                          // down
          fx2 = udiv(prod, dyr); fy2 = 0;
          prod += dx * ONE_PIXEL;
          this.integrate(fy2 - fy1, fx1 + fx2);
          fx1 = fx2; fy1 = ONE_PIXEL; ey1--;
        }
        this.setCell(ex1, ey1);
      } while (ex1 !== ex2 || ey1 !== ey2);
    }
    fx2 = FRACT(toX); fy2 = FRACT(toY);
    this.integrate(fy2 - fy1, fx1 + fx2);
    this.x = toX; this.y = toY;
  }

  conicTo(cx26        , cy26        , tx26        , ty26        )       {
    const p0x = this.x, p0y = this.y;
    const p1x = UPSCALE(cx26), p1y = UPSCALE(cy26), p2x = UPSCALE(tx26), p2y = UPSCALE(ty26);
    if ((TRUNC(p0y) >= this.maxEy && TRUNC(p1y) >= this.maxEy && TRUNC(p2y) >= this.maxEy) ||
        (TRUNC(p0y) < this.minEy && TRUNC(p1y) < this.minEy && TRUNC(p2y) < this.minEy)) { this.x = p2x; this.y = p2y; return; }
    const count = conicSteps(p0x, p0y, p1x, p1y, p2x, p2y);
    if (count === 0) { this.renderLine(p2x, p2y); return; }
    for (let i = 0; i < 2 * count; i += 2) this.renderLine(CONIC_STEPS[i], CONIC_STEPS[i + 1]);
  }

  /** gray_render_cubic: bisect until the control points sit within half a pixel of the chord trisections. */
  cubicTo(c1x        , c1y        , c2x        , c2y        , tx        , ty        )       {
    const ax = new Float64Array(16 * 3 + 1), ay = new Float64Array(16 * 3 + 1);
    ax[0] = UPSCALE(tx); ay[0] = UPSCALE(ty);
    ax[1] = UPSCALE(c2x); ay[1] = UPSCALE(c2y);
    ax[2] = UPSCALE(c1x); ay[2] = UPSCALE(c1y);
    ax[3] = this.x; ay[3] = this.y;
    if ((TRUNC(ay[0]) >= this.maxEy && TRUNC(ay[1]) >= this.maxEy && TRUNC(ay[2]) >= this.maxEy && TRUNC(ay[3]) >= this.maxEy) ||
        (TRUNC(ay[0]) < this.minEy && TRUNC(ay[1]) < this.minEy && TRUNC(ay[2]) < this.minEy && TRUNC(ay[3]) < this.minEy)) { this.x = ax[0]; this.y = ay[0]; return; }
    const half = ONE_PIXEL / 2;
    let k = 0;
    for (;;) {
      if (Math.abs(2 * ax[k] - 3 * ax[k + 1] + ax[k + 3]) > half || Math.abs(2 * ay[k] - 3 * ay[k + 1] + ay[k + 3]) > half ||
          Math.abs(ax[k] - 3 * ax[k + 2] + 2 * ax[k + 3]) > half || Math.abs(ay[k] - 3 * ay[k + 2] + 2 * ay[k + 3]) > half) {
        splitCubic(ax, k); splitCubic(ay, k);
        k += 3;
        continue;
      }
      this.renderLine(ax[k], ay[k]);
      if (k === 0) return;
      k -= 3;
    }
  }

  /** gray_sweep with FT_FILL_RULE (non-zero): returns coverage rows top-down (y-down). */
  sweep()             {
    const W = this.maxEx - this.minEx, H = this.h, out = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) {
      const o = r * this.w, dst = (H - 1 - r) * W;
      let cover = 0;
      for (let c = 0; c < this.w; c++) {
        cover += this.cover[o + c] * (ONE_PIXEL * 2);
        if (c === 0) continue;                 // the min_ex - 1 column only carries cover
        let v = (cover - this.area[o + c]) >> (PIXEL_BITS * 2 + 1 - 8);
        if (v < 0) v = ~v;
        out[dst + c - 1] = v > 255 ? 255 : v;
      }
    }
    return out;
  }
}

/** gray_split_cubic on one coordinate, at stack offset k (integer >> as in C). */
function splitCubic(b              , k        )       {
  b[k + 6] = b[k + 3];
  let a = b[k] + b[k + 1];
  const bb = b[k + 1] + b[k + 2];
  let c = b[k + 2] + b[k + 3];
  b[k + 5] = c >> 1;
  c += bb;
  b[k + 4] = c >> 2;
  b[k + 1] = a >> 1;
  a += bb;
  b[k + 2] = a >> 2;
  b[k + 3] = (a + c) >> 3;
}

// ------------------------------------------------------------------ outlines
/** FreeType point tags: on-curve, conic (quadratic) control, cubic control. */
                                    
                                             
const tagOf = (t        )      => (t === 1 ? 'on' : t === 2 ? 'cubic' : 'conic');

/** FT_Set_Transform 16.16 matrix [[xx, xy], [yx, yy]] (identity when upright). */
                                                                                                            
export const ROT_ID         = { xx: 0x10000, xy: 0, yx: 0, yy: 0x10000 };
export const ROT_90         = { xx: 0, xy: -0x10000, yx: 0x10000, yy: 0 };
/** matplotlib Agg: round(0x10000 * [[cos,-sin],[sin,cos]]) for angle degrees CCW in y-down screen space. */
export function rotMatDeg(deg        )         {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  return {
    xx: Math.round(0x10000 * c),
    xy: Math.round(0x10000 * -s),
    yx: Math.round(0x10000 * s),
    yy: Math.round(0x10000 * c),
  };
}
const applyMat = (m        , x        , y        )                            =>
  [mulFix(x, m.xx) + mulFix(y, m.xy), mulFix(x, m.yx) + mulFix(y, m.yy)];

/** Scaled (26.6), transformed and translated outline points per contour. */
function loadGlyph(face      , gid        , scale        , rot        , ox        , oy        )         {
  const o = face.outlines.get(gid);
  if (o.kind === 'none') return [];
  const offs = face.offsets.get(gid);
  return o.value.map((flat, ci) => {
    // a composite's component offsets are scaled one by one and added to the scaled points
    let dx = 0, dy = 0;
    if (offs.kind === 'some') { const d = offs.value[ci]; for (let j = 0; j < d.length; j += 2) { dx += mulFix(d[j], scale); dy += mulFix(d[j + 1], scale); } }
    const pts       = [];
    for (let i = 0; i < flat.length; i += 3) {
      const x = mulFix(flat[i], scale) + dx, y = mulFix(flat[i + 1], scale) + dy;
      const [tx, ty] = applyMat(rot, x, y);
      pts.push({ x: tx + ox, y: ty + oy, tag: tagOf(flat[i + 2]) });
    }
    return pts;
  });
}

/** FT_Outline_Decompose into the gray rasterizer. */
function decompose(contours                 , g      )       {
  for (const pts of contours) {
    const n = pts.length;
    if (n === 0) continue;
    let limit = n - 1;
    let start = { x: pts[0].x, y: pts[0].y };
    let idx = 0;
    if (pts[0].tag === 'conic') {
      const last = pts[n - 1];
      if (last.tag === 'on') { start = { x: last.x, y: last.y }; limit--; }
      else start = { x: Math.trunc((pts[0].x + last.x) / 2), y: Math.trunc((pts[0].y + last.y) / 2) };
      idx = -1;
    }
    g.moveTo(start.x, start.y);
    let closedByConic = false;
    while (idx < limit) {
      idx++;
      const p = pts[idx];
      if (p.tag === 'on') { g.lineTo(p.x, p.y); continue; }
      if (p.tag === 'cubic') {
        // two cubic controls, then an on-curve point (or the contour start)
        const q = pts[idx + 1];
        idx += 2;
        if (idx <= limit) { const e = pts[idx]; g.cubicTo(p.x, p.y, q.x, q.y, e.x, e.y); continue; }
        g.cubicTo(p.x, p.y, q.x, q.y, start.x, start.y);
        closedByConic = true;
        break;
      }
      let cx = p.x, cy = p.y;
      for (;;) {
        if (idx < limit) {
          idx++;
          const q = pts[idx];
          if (q.tag === 'on') { g.conicTo(cx, cy, q.x, q.y); break; }
          const mx = Math.trunc((cx + q.x) / 2), my = Math.trunc((cy + q.y) / 2);
          g.conicTo(cx, cy, mx, my);
          cx = q.x; cy = q.y;
          continue;
        }
        g.conicTo(cx, cy, start.x, start.y);
        closedByConic = true;
        break;
      }
      if (closedByConic) break;
    }
    if (!closedByConic) g.lineTo(start.x, start.y);
  }
}

const cboxOf = (contours                 )                                                     => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0: Math.floor(x0 / 64), y0: Math.floor(y0 / 64), x1: Math.ceil(x1 / 64), y1: Math.ceil(y1 / 64) };
};

/**
 * Render one glyph whose origin is (ox, oy) in 26.6 FreeType space (y up from the
 * canvas bottom) and blend it like RendererAgg::draw_text_image.
 */
export function drawGlyph(c        , face      , gid        , scale        , rot                  , ox        , oy        , color       )       {
  const m         = typeof rot === 'boolean' ? (rot ? ROT_90 : ROT_ID) : rot;
  const all = { x0: 0, y0: 0, x1: c.w, y1: c.h };
  const g = cachedGlyph(face, gid, scale, m, ox & 63, oy & 63);
  switch (g.kind) {
    case 'empty': return;
    case 'mask': {
      const px = ox >> 6, py = oy >> 6;
      // translation by whole pixels is exact while every coordinate stays ≥ 0 (see cachedGlyph)
      if (g.minX + 64 * px >= 0 && g.minY + 64 * py >= 0) { blendCoverage(c, g.cov, color, px, c.h - py, all); return; }
      drawGlyphDirect(c, face, gid, scale, m, ox, oy, color);
      return;
    }
    default: assertNever(g);
  }
}

/** The uncached path: load, rasterize and blend at the real origin. */
export function drawGlyphDirect(c        , face      , gid        , scale        , rot                  , ox        , oy        , color       )       {
  const m         = typeof rot === 'boolean' ? (rot ? ROT_90 : ROT_ID) : rot;
  const contours = loadGlyph(face, gid, scale, m, ox, oy);
  if (contours.length === 0) return;
  const b = cboxOf(contours);
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return;
  blendCoverage(c, rasterize(contours, b, c.h, 0), color, 0, 0, { x0: 0, y0: 0, x1: c.w, y1: c.h });
}

                                                                                                   
/**
 * ftgrays over the outline; bitmap.top = y1 and draw_text_image puts its first row at canvas row
 * H − top. The mask is placed `shift` pixels left and down of where it was rasterized.
 */
function rasterize(contours                 , b      , H        , shift        )           {
  const g = new Gray(b.x0, b.y0, b.x1, b.y1);
  decompose(contours, g);
  return denseCoverage(b.x0 - shift, H - (b.y1 - shift), b.x1 - b.x0, b.y1 - b.y0, g.sweep());
}

// ------------------------------------------------------------------ glyph cache
// A glyph's coverage depends on (face, gid, scale, rotation) and its origin's 26.6 fraction only:
// ftgrays works on cell indices and differences, so moving the outline by whole pixels moves the
// mask by whole pixels. The one exception is FT_Outline_Decompose's `(a + b) / 2` for a contour
// that starts off-curve, which truncates toward zero and so is translation-invariant only where
// coordinates are non-negative. Masks are therefore rendered at a far, positive origin, and reused
// only when the real placement keeps every coordinate ≥ 0 (always, for glyphs on the canvas);
// otherwise drawGlyph renders in place. Exactness is checked against the uncached path by
// test/glyphcache.test.mjs.
                  
                              
                                                                                                    
const FAR = 1 << 14;                              // canonical origin, whole pixels
const GLYPHS = new Map                     ();
const GLYPH_LIMIT = 8192;
let glyphHits = 0, glyphMisses = 0;

function cachedGlyph(face      , gid        , scale        , rot        , fx        , fy        )              {
  const key = `${face.id}|${gid}|${scale}|${rot.xx},${rot.xy},${rot.yx},${rot.yy}|${fx}|${fy}`;
  const hit = lookup(GLYPHS, key);
  if (hit.kind === 'some') { glyphHits++; return hit.value; }
  glyphMisses++;
  const g = renderCanonical(face, gid, scale, rot, fx, fy);
  if (GLYPHS.size >= GLYPH_LIMIT) GLYPHS.clear();
  GLYPHS.set(key, g);
  return g;
}

function renderCanonical(face      , gid        , scale        , rot        , fx        , fy        )              {
  const base = 64 * FAR;
  const contours = loadGlyph(face, gid, scale, rot, base + fx, base + fy);
  if (contours.length === 0) return { kind: 'empty' };
  const b = cboxOf(contours);
  if (b.x1 <= b.x0 || b.y1 <= b.y0) return { kind: 'empty' };
  let minX = Infinity, minY = Infinity;
  for (const ct of contours) for (const p of ct) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; }
  // stored relative to an origin pixel of (0, 0) with H = 0: blend at (ox >> 6, H − (oy >> 6))
  return { kind: 'mask', cov: rasterize(contours, b, 0, FAR), minX: minX - base, minY: minY - base };
}

export function clearGlyphCache()       { GLYPHS.clear(); }

/** Cache counters since the last call (for traces). */
export function glyphCacheStats()                                                                            {
  const r = { hits: glyphHits, misses: glyphMisses, size: GLYPHS.size };
  glyphHits = 0; glyphMisses = 0;
  return r;
}
