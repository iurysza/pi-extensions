// RGBA8 pixel buffer (straight alpha, row-major, top-left origin) and matplotlib's
// blender: fixed_comp_op_adaptor_rgba8_plain / fixed_blender_rgba_plain from
// src/agg_workaround.h, in the same integer arithmetic.
                                                  
import { err, ok } from '../../core/types.js';
import { isPlainObject, prop } from '../../core/std.js';
                                                  

/**
 * dpi is recorded so encoders can write physical size (PNG pHYs); 0 means unknown.
 *
 * Block state: each row is cut into blocks of BLOCK pixels (the last may be shorter). For block
 * `y·nb + j`, mix = 0 means every pixel in it is exactly blk[...] (a Uint32 as in u32); mix = 1
 * promises nothing. Every writer keeps this true (blendCoverage below is the only one in the
 * renderer); code that writes px or u32 itself must call invalidateBlocks. Encoders use it to
 * skip flat regions without reading them, and the blender to turn a uniform block into one fill.
 */
                      
                                                                                                                   
                                                                                                  
                           
                                                                           
                                              
                              
  
/** A color quantized like agg::rgba8(agg::rgba): uround(c * 255). */
                                                                                                       

export const quantize = (v        )         => Math.trunc(v * 255 + 0.5);

const LITTLE = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
/** One RGBA8 pixel as the Uint32 the canvas' native-endian view stores. */
export const pack = (r        , g        , b        , a        )         =>
  (LITTLE ? ((a << 24) | (b << 16) | (g << 8) | r) : ((r << 24) | (g << 16) | (b << 8) | a)) >>> 0;

export const BLOCK_SHIFT         = 5;
export const BLOCK         = 1 << BLOCK_SHIFT;

/** RendererAgg::clear fills with _fill_color = rgba(1, 1, 1, 0). */
export function newCanvas(w        , h        , dpi        )         {
  const px = new Uint8Array(w * h * 4), u32 = new Uint32Array(px.buffer), i32 = new Int32Array(px.buffer), clear = pack(255, 255, 255, 0);
  u32.fill(clear);
  const nb = (w + BLOCK - 1) >> BLOCK_SHIFT;
  const blk = new Uint32Array(nb * h).fill(clear);
  return { w, h, dpi, px, u32, i32, nb, blk, blkI32: new Int32Array(blk.buffer), mix: new Uint8Array(nb * h) };
}

/** Back to the state newCanvas returns. */
export function clearCanvas(c        )       {
  const clear = pack(255, 255, 255, 0);
  c.u32.fill(clear); c.blk.fill(clear); c.mix.fill(0);
}

/** Two views starting at the same byte of the same buffer. */
const over = (a                 , b                 )          => a.buffer === b.buffer && a.byteOffset === b.byteOffset;
/**
 * A caller's canvas (a previous toRGBA result) to render into again: every view must be the one newCanvas makes, at
 * its size and over its own buffer, so the block state and the pixels can't disagree.
 */
export function parseCanvas(v         )                 {
  const bad = err        ('out must be a canvas returned by toRGBA');
  if (!isPlainObject(v)) return bad;
  const g = (k        )          => { const o = prop(v, k); return o.kind === 'some' ? o.value : 0; };
  const w = g('w'), h = g('h'), dpi = g('dpi'), nb = g('nb'), px = g('px'), u32 = g('u32'), i32 = g('i32'), blk = g('blk'), blkI32 = g('blkI32'), mix = g('mix');
  if (typeof w !== 'number' || typeof h !== 'number' || typeof dpi !== 'number' || !Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0) return bad;
  if (!(px instanceof Uint8Array && u32 instanceof Uint32Array && i32 instanceof Int32Array && blk instanceof Uint32Array && blkI32 instanceof Int32Array && mix instanceof Uint8Array)) return bad;
  const n = w * h, nbw = (w + BLOCK - 1) >> BLOCK_SHIFT;
  if (nb !== nbw || px.length !== 4 * n || u32.length !== n || i32.length !== n || !over(u32, px) || !over(i32, px)
      || blk.length !== nbw * h || blkI32.length !== nbw * h || !over(blkI32, blk) || mix.length !== nbw * h) return bad;
  return ok({ w, h, dpi, px, u32, i32, nb: nbw, blk, blkI32, mix });
}

/** Wrap RGBA pixels written elsewhere (byteOffset must be a multiple of 4); block state is scanned. */
export function canvasOf(w        , h        , dpi        , px            )         {
  const nb = (w + BLOCK - 1) >> BLOCK_SHIFT;
  const u32 = new Uint32Array(px.buffer, px.byteOffset, w * h);
  const blk = new Uint32Array(nb * h);
  const c = { w, h, dpi, px, u32, i32: new Int32Array(px.buffer, px.byteOffset, w * h), nb, blk, blkI32: new Int32Array(blk.buffer), mix: new Uint8Array(nb * h) };
  scanBlocks(c);
  return c;
}

/** After writing px/u32 directly: drop every uniformity claim (cheap), or rescan (exact). */
export function invalidateBlocks(c        )       { c.mix.fill(1); }
export function scanBlocks(c        )       {
  for (let y = 0; y < c.h; y++) for (let j = 0; j < c.nb; j++) {
    const bi = y * c.nb + j, i0 = y * c.w + (j << BLOCK_SHIFT), i1 = y * c.w + Math.min((j + 1) << BLOCK_SHIFT, c.w), v = c.u32[i0];
    let same = true;
    for (let i = i0 + 1; i < i1 && same; i++) same = c.u32[i] === v;
    c.blk[bi] = v; c.mix[bi] = same ? 0 : 1;
  }
}

/** The block invariant, checked against the pixels (tests). Returns the first bad block or −1. */
export function checkBlocks(c        )         {
  for (let y = 0; y < c.h; y++) for (let j = 0; j < c.nb; j++) {
    const bi = y * c.nb + j;
    if (c.mix[bi] !== 0) continue;
    for (let x = j << BLOCK_SHIFT, e = Math.min(x + BLOCK, c.w); x < e; x++) if (c.u32[y * c.w + x] !== c.blk[bi]) return bi;
  }
  return -1;
}

// rgba8::multiply: (a*b + 128) scaled back with one rounding correction
const mult = (a        , b        )         => { const t = a * b + 128; return ((t >> 8) + t) >> 8; };

/** Blend one pixel at byte offset i. Exact port: opaque full-cover fast path, else 8-bit plain blend. */
function blendPix(p            , i        , cr        , cg        , cb        , ca        , cover        )       {
  if (ca === 255 && cover === 255) { p[i] = cr; p[i + 1] = cg; p[i + 2] = cb; p[i + 3] = 255; return; }
  const alpha = mult(ca, cover);
  if (alpha === 0) return;
  const da = p[i + 3];
  const r = p[i] * da, g = p[i + 1] * da, b = p[i + 2] * da;
  const a = ((alpha + da) << 8) - alpha * da;
  p[i + 3] = a >> 8;
  // In C these are unsigned 32-bit; the true values are non-negative and < 2^32, so the
  // modular arithmetic there equals plain arithmetic here. Division truncates.
  p[i] = Math.trunc((((cr << 8) - r) * alpha + (r << 8)) / a) & 255;
  p[i + 1] = Math.trunc((((cg << 8) - g) * alpha + (g << 8)) / a) & 255;
  p[i + 2] = Math.trunc((((cb << 8) - b) * alpha + (b << 8)) / a) & 255;
}

/**
 * Composite a coverage mask in one color, shifted by (dx, dy) and limited to `clip`
 * (half-open). Zero-coverage pixels are untouched, as in Agg's scanline renderers.
 */
export function blendCoverage(c        , cov          , color       , dx        , dy        , clip      )       {
  const x0 = Math.max(cov.x0 + dx, clip.x0, 0), x1 = Math.min(cov.x0 + dx + cov.w, clip.x1, c.w);
  const y0 = Math.max(cov.y0 + dy, clip.y0, 0), y1 = Math.min(cov.y0 + dy + cov.h, clip.y1, c.h);
  if (x1 <= x0 || y1 <= y0) return;
  const { r, g, b, a } = color, p = c.px, u32 = c.u32;
  const solid = a === 255 ? pack(r, g, b, 255) : 0;
  const ox = cov.x0 + dx, W = c.w, nb = c.nb, blk = c.blk, mix = c.mix;
  // The blend is a pure function of (destination pixel, cover) for a fixed color, and charts are
  // mostly flat: remember the last (dst, cover) → result and reuse it. Exact by construction.
  // On a uniform block that the run covers, every pixel gets the same result: one fill.
  let lastD = -1, lastK = -1, lastR = 0;
  for (let y = y0; y < y1; y++) {
    const row = y - dy - cov.y0, base = y * W, brow = y * nb;
    for (let s = cov.rows[row], e = cov.rows[row + 1]; s < e; s++) {
      const xs = Math.max(x0, cov.sx[s] + ox), xe = Math.min(x1, cov.sx[s] + ox + cov.sl[s]);
      if (xe <= xs) continue;
      const k = cov.sv[s];
      if (k === 255 && a === 255) { fillSpan(u32, base + xs, base + xe, solid); markSolid(c, brow, xs, xe, solid); continue; }
      // a pending fill [fa, fb) of fv, so adjacent uniform blocks with the same result are one fill
      let fa = 0, fb = 0, fv = 0;
      for (let x = xs; x < xe;) {
        const j = x >> BLOCK_SHIFT, bs = j << BLOCK_SHIFT, be = Math.min(bs + BLOCK, W), seg = Math.min(be, xe);
        const bi = brow + j;
        if (mix[bi] === 0) {
          const d = blk[bi];
          if (d !== lastD || k !== lastK) { blendPix(p, (base + x) * 4, r, g, b, a, k); lastD = d; lastK = k; lastR = u32[base + x]; }
          if (fb === base + x && fv === lastR) fb = base + seg;
          else { if (fb > fa) fillSpan(u32, fa, fb, fv); fa = base + x; fb = base + seg; fv = lastR; }
          if (x === bs && seg === be) blk[bi] = lastR; else if (lastR !== d) mix[bi] = 1;
        } else {
          for (let i = base + x, end = base + seg; i < end; i++) {
            const d = u32[i];
            if (d === lastD && k === lastK) { u32[i] = lastR; continue; }
            blendPix(p, i * 4, r, g, b, a, k);
            lastD = d; lastK = k; lastR = u32[i];
          }
        }
        x = seg;
      }
      if (fb > fa) fillSpan(u32, fa, fb, fv);
    }
  }
}

/** Block state after an opaque fill of [xs, xe) in one row: covered blocks become uniform. */
function markSolid(c        , brow        , xs        , xe        , v        )       {
  const j0 = xs >> BLOCK_SHIFT, j1 = (xe - 1) >> BLOCK_SHIFT;
  for (let j = j0; j <= j1; j++) {
    const bs = j << BLOCK_SHIFT, bi = brow + j;
    if (bs >= xs && Math.min(bs + BLOCK, c.w) <= xe) { c.blk[bi] = v; c.mix[bi] = 0; }
    else if (c.mix[bi] === 0 && c.blk[bi] !== v) c.mix[bi] = 1;
  }
}

/** TypedArray#fill has a per-call cost that dominates the short spans most runs are. */
function fillSpan(u32             , a        , b        , v        )       {
  if (b - a > 24) { u32.fill(v, a, b); return; }
  for (let i = a; i < b; i++) u32[i] = v;
}
