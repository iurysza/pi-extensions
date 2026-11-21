// Scene → RGBA8 pixels, reproducing matplotlib's RendererAgg: paths through
// conv_curve/conv_dash/conv_stroke into the scanline AA rasterizer, markers
// rasterized once and stamped at integer offsets, text as FreeType glyph bitmaps.
                                                                                                
import { assertNever, none, some } from '../core/types.js';
import { faceById, ftScale } from '../core/fonts.js';
import { pyRound } from '../core/log.js';
import { lookup } from '../core/std.js';
                                          
import { blendCoverage, clearCanvas, invalidateBlocks, newCanvas, quantize } from './agg/canvas.js';
                                                     
import { EMPTY, Rasterizer } from './agg/raster.js';
                                                      
import { dashPath, fillPath, flatten, strokePath, stroker } from './agg/stroke.js';
                                           
import { drawGlyph, rotMatDeg, ROT_ID, ROT_90 } from './ft.js';
                                                           
import { encodePNG, encodePNGSync, pngStream, RGBA } from './png.js';

                                              

function rgba8(c     )        {
  const h = c.hex.replace('#', '');
  const v = (i        )         => parseInt(h.slice(i, i + 2), 16);
  const a = h.length >= 8 ? v(6) / 255 * c.alpha : c.alpha;
  return { r: v(0), g: v(2), b: v(4), a: quantize(a) };
}

/** set_clipbox: floor(v + 0.5) on each edge, clamped to the canvas. */
function clipBox(clip      , outer      )       {
  switch (clip.kind) {
    case 'none': return outer;
    case 'rect': {
      const x0 = Math.floor(clip.x + 0.5), x1 = Math.floor(clip.x + clip.w + 0.5);
      const y0 = Math.floor(clip.y + 0.5), y1 = Math.floor(clip.y + clip.h + 0.5);
      return { x0: Math.max(outer.x0, Math.min(x0, x1)), y0: Math.max(outer.y0, Math.min(y0, y1)),
               x1: Math.min(outer.x1, Math.max(x0, x1)), y1: Math.min(outer.y1, Math.max(y0, y1)) };
    }
    default: return assertNever(clip);
  }
}

                                                                                                                                  

const rectSegs = (x        , y        , w        , h        )                 =>
  [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];

function strokeCoverage(ras            , clip      , subs                , s        )           {
  ras.reset(clip);
  const st = stroker(s.width, s.cap, s.join, s.width);
  switch (s.dash.kind) {
    case 'solid': strokePath(subs, st, ras); break;
    case 'dashed': strokePath(dashPath(subs, s.dash.pattern, s.dash.offset), st, ras); break;
    default: assertNever(s.dash);
  }
  return ras.sweep('nonzero');
}

function fillCoverage(ras            , clip      , subs                )           {
  ras.reset(clip);
  fillPath(subs, ras);
  return ras.sweep('nonzero');
}

/** Agg scanline_bin-style: any AA coverage → 255 (Patch.antialiased=False / RendererAgg mono). */
function toMono(cov          )           {
  const sv = new Uint8Array(cov.sv.length);
  for (let i = 0; i < cov.sv.length; i++) sv[i] = cov.sv[i] > 0 ? 255 : 0;
  return { x0: cov.x0, y0: cov.y0, w: cov.w, h: cov.h, rows: cov.rows, sx: cov.sx, sl: cov.sl, sv };
}

/** RendererAgg::_draw_path: face, then stroke (each its own rasterizer pass). */
function drawPath(x     , subs                , ink     , clip      , antialiased = true)       {
  x.tracer.span('raster.path', { ink: ink.kind, subpaths: subs.length, vertices: subs.reduce((n, s) => n + s.xs.length, 0) }, (sp) => {
    const fill = ()       => {
      let cov = fillCoverage(x.ras, clip, subs);
      if (!antialiased) cov = toMono(cov);
      sp.setAttribute('fill.runs', cov.sx.length);
      blendCoverage(x.c, cov, rgba8(ink.kind === 'stroke' ? ink.stroke.color : ink.fill), 0, 0, clip);
    };
    const stroke = (s        )       => {
      let cov = strokeCoverage(x.ras, clip, subs, s);
      if (!antialiased) cov = toMono(cov);
      sp.setAttribute('stroke.runs', cov.sx.length).setAttribute('stroke.w', +s.width.toFixed(3));
      blendCoverage(x.c, cov, rgba8(s.color), 0, 0, clip);
    };
    switch (ink.kind) {
      case 'fill': fill(); return;
      case 'stroke': stroke(ink.stroke); return;
      case 'fillStroke': fill(); stroke(ink.stroke); return;
      default: assertNever(ink);
    }
  });
}

/**
 * RendererAgg::draw_markers: the marker is rasterized once (no clipping) relative to
 * its origin and each instance is stamped at the integer floor of its position; the
 * renderer clip box is inclusive of its right/bottom edge, hence the +1.
 */
function drawMarkers(x     , outline                , xs              , ys              , ink     , clip      )       {
  x.tracer.span('raster.markers', { count: xs.length, ink: ink.kind }, (sp) => { sp.setAttribute('masks', stampMarkers(x, outline, xs, ys, ink, clip)); });
}
/** Returns how many distinct sub-pixel phases were rasterized (one per cache entry). */
function stampMarkers(x     , outline                , xs              , ys              , ink     , clip      )         {
  const cache = new Map                                       ();
  const free       = { x0: -1e6, y0: -1e6, x1: 1e6, y1: 1e6 };
  const mclip       = { x0: clip.x0, y0: clip.y0, x1: clip.x1 + 1, y1: clip.y1 + 1 };
  const masks = (fx        , fy        )                                => {
    const key = `${fx},${fy}`;
    const hit = lookup(cache, key);
    if (hit.kind === 'some') return hit.value;
    const subs = flatten(outline, fx, fy);
    const r                                = (() => {
      switch (ink.kind) {
        case 'fill': return [fillCoverage(x.ras, free, subs), EMPTY]         ;
        case 'stroke': return [EMPTY, strokeCoverage(x.ras, free, subs, ink.stroke)]         ;
        case 'fillStroke': return [fillCoverage(x.ras, free, subs), strokeCoverage(x.ras, free, subs, ink.stroke)]         ;
        default: return assertNever(ink);
      }
    })();
    cache.set(key, r);
    return r;
  };
  const face        = ink.kind === 'stroke' ? { r: 0, g: 0, b: 0, a: 0 } : rgba8(ink.fill);
  const edge        = ink.kind === 'fill' ? { r: 0, g: 0, b: 0, a: 0 } : rgba8(ink.stroke.color);
  for (let i = 0; i < xs.length; i++) {
    const px = Math.floor(xs[i]), py = Math.floor(ys[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const [f, s] = masks(xs[i] - px, ys[i] - py);
    if (f.w > 0) blendCoverage(x.c, f, face, px, py, mclip);
    if (s.w > 0) blendCoverage(x.c, s, edge, px, py, mclip);
  }
  return cache.size;
}

/** Per-glyph placement from _draw_text_glyphs_and_boxes; y is FreeType-up from the canvas bottom. */
function drawText(x     , n                                 )       {
  x.tracer.span('raster.text', { text: n.text, glyphs: n.glyphs.length, pt: n.sizePt, rot: typeof n.rotation === 'string' ? n.rotation : n.rotation.deg }, () => drawGlyphs(x, n));
}
function drawGlyphs(x     , n                                 )       {
  const face = faceById(n.face);
  const scale = ftScale(face, n.sizePt, x.dpi);
  const color = rgba8(n.color);
  // Agg RendererAgg.height is the float figsize*dpi (may be *.5); canvas truncates. Flip with figH.
  const H = x.figH;
  const rot = n.rotation;
  // Agg _draw_text_glyphs_and_boxes: FT y-up = (H - y_baseline) + dy_up, with dy_up = -n.dy.
  // Must use that association (not H - (y_baseline + n.dy)) so *.5 26.6 pens match banker's round.
  for (const { gid, dx } of n.glyphs) {
    if (rot === 'horizontal') {
      drawGlyph(x.c, face, gid, scale, ROT_ID, pyRound(64 * (n.x + dx)), pyRound(64 * ((H - n.y) - n.dy)), color);
    } else if (rot === 'vertical') {
      drawGlyph(x.c, face, gid, scale, ROT_90, pyRound(64 * n.x), pyRound(64 * (H - n.y + dx)), color);
    } else {
      // angled: matplotlib RendererAgg._draw_text_glyphs_and_boxes (y-down angle, FT y-up delta)
      const rad = (rot.deg * Math.PI) / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      const ox = pyRound(64 * (n.x + dx * c));
      const oy = pyRound(64 * ((H - n.y) - n.dy + dx * s));
      drawGlyph(x.c, face, gid, scale, rotMatDeg(rot.deg), ox, oy, color);
    }
  }
}


/** Straight-alpha RGBA blit with the renderer clip box (inclusive right/bottom as Agg). */
function blitImage(c        , x0        , y0        , w        , h        , rgba            , clip      )       {
  invalidateBlocks(c);
  const x1 = Math.min(x0 + w, clip.x1), y1 = Math.min(y0 + h, clip.y1);
  const xs = Math.max(x0, clip.x0), ys = Math.max(y0, clip.y0);
  if (x1 <= xs || y1 <= ys) return;
  const cw = c.w, px = c.px, u32 = c.u32;
  const srcU = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  for (let y = ys; y < y1; y++) {
    const sBase = (y - y0) * w - x0;   // src pixel index = sBase + x
    const dBase = y * cw;               // dest pixel index = dBase + x
    let x = xs;
    while (x < x1) {
      const si = sBase + x;
      const a = rgba[si * 4 + 3];
      if (a === 0) { x++; continue; }
      if (a === 255) {
        let e = x + 1;
        while (e < x1 && rgba[(sBase + e) * 4 + 3] === 255) e++;
        u32.set(srcU.subarray(si, si + (e - x)), dBase + x);
        x = e; continue;
      }
      const di = (dBase + x) * 4, so = si * 4;
      const aa = a / 255, ia = 1 - aa, da = px[di + 3] / 255, outA = aa + da * ia;
      if (outA > 0) {
        px[di] = Math.round((rgba[so] * aa + px[di] * da * ia) / outA);
        px[di + 1] = Math.round((rgba[so + 1] * aa + px[di + 1] * da * ia) / outA);
        px[di + 2] = Math.round((rgba[so + 2] * aa + px[di + 2] * da * ia) / outA);
        px[di + 3] = Math.round(outA * 255);
      }
      x++;
    }
  }
}

function drawNode(x     , n      , clip      )       {
  switch (n.kind) {
    case 'rect': drawPath(x, flatten(rectSegs(n.x, n.y, n.w, n.h), 0, 0), n.ink, clip); return;
    case 'path': drawPath(x, flatten(n.segs, 0, 0), n.ink, clip, n.antialiased); return;
    case 'polyline': {
      const subs        = [];
      for (let m = 0; m < n.moves.length; m++) {
        const a = n.moves[m], b = m + 1 < n.moves.length ? n.moves[m + 1] : n.xs.length;
        subs.push({ xs: Array.from(n.xs.subarray(a, b)), ys: Array.from(n.ys.subarray(a, b)), closed: false });
      }
      if (subs.length > 0) x.tracer.span('raster.polyline', { vertices: n.xs.length, w: +n.stroke.width.toFixed(3), dash: n.stroke.dash.kind }, (sp) => {
        const cov = strokeCoverage(x.ras, clip, subs, n.stroke);
        sp.setAttribute('runs', cov.sx.length);
        blendCoverage(x.c, cov, rgba8(n.stroke.color), 0, 0, clip);
      });
      return;
    }
    case 'markers': drawMarkers(x, n.shape, n.xs, n.ys, n.ink, clip); return;
    case 'text': drawText(x, n); return;
    case 'image': {
      x.tracer.span('raster.image', { w: n.w, h: n.h }, () => blitImage(x.c, n.x, n.y, n.w, n.h, n.rgba, clip));
      return;
    }
    case 'collection': for (const ch of n.nodes) drawNode(x, ch, clip); return;
    case 'group': { const inner = clipBox(n.clip, clip); for (const ch of n.nodes) drawNode(x, ch, inner); return; }
    default: assertNever(n);
  }
}

function background(x     , p       , full      )       {
  switch (p.kind) {
    case 'none': return;
    case 'solid': drawPath(x, flatten(rectSegs(0, 0, x.c.w, x.c.h), 0, 0), { kind: 'fill', fill: p.color }, full); return;
    default: assertNever(p);
  }
}

/** Rasterize a Scene. Canvas size truncates like RendererAgg(int(w), int(h)). */
export function renderRGBA(scene       , tracer        )         {
  return renderInto(newCanvas(Math.trunc(scene.width), Math.trunc(scene.height), scene.dpi), scene, tracer);
}

/**
 * Rasterize a Scene into `out` (a canvas the caller owns and is done with, e.g. the previous frame's) when it has the
 * scene's size: its pixels are cleared and overwritten, and the result shares its buffers. Any other size renders
 * into a fresh canvas, as renderRGBA. A re-render loop (pan, zoom, animation) then skips allocating and first-touching
 * a new buffer every frame.
 */
export function renderRGBAInto(out        , scene       , tracer        )         {
  if (out.w !== Math.trunc(scene.width) || out.h !== Math.trunc(scene.height)) return renderRGBA(scene, tracer);
  const c = out.dpi === scene.dpi ? out : { ...out, dpi: scene.dpi };
  clearCanvas(c);
  return renderInto(c, scene, tracer);
}

// toPNGSync throws its canvas away once encoded, so it renders into one kept scratch canvas
// (synchronous: nothing else can hold it meanwhile). A fresh 11 MB buffer costs ~8 ms in first-touch
// page faults plus GC pressure; clearing a reused one costs ~1.5 ms. Only the latest size is kept.
let scratch                 = none;
function scratchCanvas(w        , h        , dpi        )         {
  if (scratch.kind === 'some' && scratch.value.w === w && scratch.value.h === h) {
    const c = { ...scratch.value, dpi };
    clearCanvas(c);
    return c;
  }
  const c = newCanvas(w, h, dpi);
  scratch = some(c);
  return c;
}
/**
 * Rasterize into the kept scratch canvas. The result is only valid until the next call: encode it
 * and drop it (toPNGSync). Callers that keep pixels use renderRGBA.
 */
export function renderScratch(scene       , tracer        )         {
  return renderInto(scratchCanvas(Math.trunc(scene.width), Math.trunc(scene.height), scene.dpi), scene, tracer);
}
/** Drop the scratch canvas kept by toPNGSync (memory back to the GC). */
export function releaseScratch()       { scratch = none; }

function renderInto(c        , scene       , tracer        )         {
  const full       = { x0: 0, y0: 0, x1: c.w, y1: c.h };
  const x      = { c, ras: new Rasterizer(full), dpi: scene.dpi, figH: scene.height, tracer };
  tracer.span('raster.background', {}, () => background(x, scene.background, full));
  scene.nodes.forEach((n, i) => tracer.span('raster.node', { i, kind: n.kind }, () => drawNode(x, n, full)));
  return c;
}

/** Scene to PNG bytes (CompressionStream); opts.colors writes a palette PNG (see png.ts). */
export const toPNG = (scene       , tracer        , opts             = RGBA)                      =>
  encodePNG(tracer.span('png.rasterize', { w: scene.width, h: scene.height }, () => renderRGBA(scene, tracer)), opts);
/** Scene to PNG bytes with the built-in deflate; opts.level sets its effort (1..9). */
export const toPNGSync = (scene       , tracer        , opts                 = RGBA)             => {
  const c = tracer.span('png.rasterize', { w: scene.width, h: scene.height },
    () => renderScratch(scene, tracer));
  return tracer.span('png.encode', { sync: true }, (sp) => { const b = encodePNGSync(c, opts); sp.setAttribute('bytes', b.length); return b; });
};
export const toPNGStream = (scene       , tracer        , opts             = RGBA)                             =>
  pngStream(tracer.span('png.rasterize', { w: scene.width, h: scene.height }, () => renderRGBA(scene, tracer)), opts);
