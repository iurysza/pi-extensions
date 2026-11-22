// The compact, lossless encoding of baked font faces. Every table of a face is a flat list of
// integers written as base64 VLQ (the source-map alphabet: 5 bits per character, a continuation
// bit, sign in the lowest bit), delta-coded where neighbours are close. Decoding yields exactly
// the FaceData that scripts/gen_fonts.py baked: same numbers, same key order (test/fontcodec.test.ts
// pins each face's JSON hash). scripts/encode_fonts.ts is the inverse.
//
//   cmap      per entry, in baked order: Δcode point, gid
//   cover     per run: first − previous last, last − first
//   glyphs    per gid, ascending: Δgid, advance, xMin, xMax − xMin, yMin, yMax − yMin
//   outlines  per gid, ascending: Δgid, contours; per contour: points; per point: 3·Δx + tag, Δy
//             (Δ from the previous point of the glyph, across contours; tags are 0, 1, 2)
//   offsets   per gid, ascending: Δgid, contours; per contour: length, then the values
//   kern      per pair, in baked order: Δleft, right, value
                                                     
import { lookup } from './std.js';
import { none, some,             } from './types.js';

/** The faces mpl ships. Families and weights are matplotlib's names for them. */
export const FACE_CATALOG = [
  { id: 'DejaVu Sans:400', family: 'DejaVu Sans', weight: 400, module: 'dejavu-sans', binding: 'dejavuSans' },
  { id: 'DejaVu Sans:700', family: 'DejaVu Sans', weight: 700, module: 'dejavu-sans-bold', binding: 'dejavuSansBold' },
  { id: 'DejaVu Serif:400', family: 'DejaVu Serif', weight: 400, module: 'dejavu-serif', binding: 'dejavuSerif' },
  { id: 'DejaVu Serif:700', family: 'DejaVu Serif', weight: 700, module: 'dejavu-serif-bold', binding: 'dejavuSerifBold' },
  { id: 'Inter:400', family: 'Inter', weight: 400, module: 'inter-regular', binding: 'interRegular' },
  { id: 'Inter:500', family: 'Inter', weight: 500, module: 'inter-medium', binding: 'interMedium' },
  { id: 'Inter:600', family: 'Inter', weight: 600, module: 'inter-semibold', binding: 'interSemibold' },
  { id: 'Inter:700', family: 'Inter', weight: 700, module: 'inter-bold', binding: 'interBold' },
]         ;
                                                         
/** "Family:weight" of a shipped face. */
                                        

/** One face as its module (mpl/fonts/<name>) exports it: metadata plus encoded tables. */
                         
                      
                       
                                                   
                                                                         
                                                                             
                                                                                                                                                                                                                     
  

export const VLQ_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) DIGIT[VLQ_ALPHABET.charCodeAt(i)] = i;

/** base64 VLQ → integers. */
export function decodeVlq(s        )             {
  const out = new Int32Array(s.length);
  // mul is 2^(5·digits so far); a product, not 2 ** shift, which unoptimized code runs as a call
  let n = 0, v = 0, mul = 1;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i), d = c < 128 ? DIGIT[c] : -1;
    if (d < 0) throw new Error(`font data: bad VLQ character ${JSON.stringify(s[i])} at ${i}`);
    v += (d & 31) * mul;
    if ((d & 32) !== 0) { mul *= 32; continue; }
    out[n++] = v % 2 === 1 ? -(v - 1) / 2 : v / 2;
    v = 0; mul = 1;
  }
  if (mul !== 1) throw new Error('font data: truncated VLQ');
  return out.subarray(0, n);
}

/** A cursor over a decoded table. */
class Ints {
          i = 0;
                   a            ;
  constructor(a            ) { this.a = a; }
  get done()          { return this.i >= this.a.length; }
  next()         {
    if (this.i >= this.a.length) throw new Error('font data: table ends early');
    return this.a[this.i++];
  }
}

/** The baked FaceData of an encoded face, exactly as it was baked. */
export function decodeFace(b           , entry              )           {
  const cmap                         = {};
  for (let r = new Ints(decodeVlq(b.cmap)), cp = 0; !r.done;) { cp += r.next(); cmap[String.fromCodePoint(cp)] = r.next(); }

  const cover                                = [];
  for (let r = new Ints(decodeVlq(b.cover)), last = 0; !r.done;) { const first = last + r.next(); last = first + r.next(); cover.push([first, last]); }

  const glyphs                                                                    = {};
  for (let r = new Ints(decodeVlq(b.glyphs)), g = 0; !r.done;) {
    g += r.next();
    const adv = r.next(), x0 = r.next(), x1 = x0 + r.next(), y0 = r.next(), y1 = y0 + r.next();
    glyphs[g] = [adv, x0, x1, y0, y1];
  }

  const outlines                                                 = {};
  for (let r = new Ints(decodeVlq(b.outlines)), g = 0; !r.done;) {
    g += r.next();
    const contours             = [];
    let x = 0, y = 0;
    for (let c = r.next(); c > 0; c--) {
      const pts           = [];
      for (let p = r.next(); p > 0; p--) {
        const v = r.next(), tag = ((v % 3) + 3) % 3;
        x += (v - tag) / 3; y += r.next();
        pts.push(x, y, tag);
      }
      contours.push(pts);
    }
    outlines[g] = contours;
  }

  const offsets                                                 = {};
  for (let r = new Ints(decodeVlq(b.offsets)), g = 0; !r.done;) {
    g += r.next();
    const contours             = [];
    for (let c = r.next(); c > 0; c--) { const vals           = []; for (let k = r.next(); k > 0; k--) vals.push(r.next()); contours.push(vals); }
    offsets[g] = contours;
  }

  const kern                         = {};
  for (let r = new Ints(decodeVlq(b.kern)), left = 0; !r.done;) { left += r.next(); const right = r.next(); kern[`${left},${right}`] = r.next(); }

  return { family: entry.family, weight: entry.weight, upm: b.upm, typo: b.typo, cmap, cover, glyphs, outlines, offsets, kern, gsub: b.gsub };
}

/** gid → contours: outline points (flat [x, y, tag]) or a composite's component offsets. */
                                                      

/**
 * The outlines or offsets table of a face, decoded per glyph on first use. A chart draws a few dozen
 * of a face's ~1200 glyphs, so building every glyph's arrays up front (decodeFace) is most of a face's
 * load time, paid by every cold isolate. The first lookup decodes the table's integers and records
 * where each gid starts; a glyph's arrays are built, exactly as decodeFace builds them, when first asked.
 */
export class GlyphContours {
                   src        ;
                   points         ;
          ints             = new Int32Array(0);
                   start = new Map                ();
          indexed = false;
                   memo = new Map                  ();
  /** points: an outlines table (per point 3·Δx + tag, Δy); else an offsets table (per contour, length then values). */
  constructor(src        , points         ) { this.src = src; this.points = points; }
          index()       {
    const a = decodeVlq(this.src), n = a.length;
    let i = 0, g = 0;
    while (i < n) {
      g += a[i++];
      this.start.set(g, i);
      for (let c = a[i++]; c > 0; c--) { const k = a[i++]; i += this.points ? 2 * k : k; }
    }
    if (i !== n) throw new Error('font data: table ends early');
    this.ints = a; this.indexed = true;
  }
  /** The gids the table has, ascending. */
  gids()                    { if (!this.indexed) this.index(); return [...this.start.keys()]; }
  get(gid        )                   {
    const m = lookup(this.memo, gid);
    if (m.kind === 'some') return m;
    if (!this.indexed) this.index();
    const s = lookup(this.start, gid);
    if (s.kind === 'none') return none;
    const a = this.ints, contours             = [];
    let i = s.value, x = 0, y = 0;
    for (let c = a[i++]; c > 0; c--) {
      const vals           = [];
      if (this.points) {
        for (let p = a[i++]; p > 0; p--) {
          const v = a[i++], tag = ((v % 3) + 3) % 3;
          x += (v - tag) / 3; y += a[i++];
          vals.push(x, y, tag);
        }
      } else {
        for (let k = a[i++]; k > 0; k--) vals.push(a[i++]);
      }
      contours.push(vals);
    }
    this.memo.set(gid, contours);
    return some(contours);
  }
}

/** A face's lookup tables straight from its encoded form: the Maps getFace needs, without decodeFace's records. */
                          
                                             
                                                         
                                                                                          
                                             
                                   
                                  
  
/** A table's integers, checked to be whole records of `k`. */
const records = (s        , k        )             => {
  const a = decodeVlq(s);
  if (a.length % k !== 0) throw new Error('font data: table ends early');
  return a;
};
export function decodeTables(b           )             {
  const cmap = new Map                ();
  for (let a = records(b.cmap, 2), i = 0, cp = 0; i < a.length; i += 2) { cp += a[i]; cmap.set(String.fromCodePoint(cp), a[i + 1]); }
  const cover                                = [];
  for (let a = records(b.cover, 2), i = 0, last = 0; i < a.length; i += 2) { const first = last + a[i]; last = first + a[i + 1]; cover.push([first, last]); }
  const glyphs = new Map                                                           ();
  for (let a = records(b.glyphs, 6), i = 0, g = 0; i < a.length; i += 6) {
    g += a[i];
    const x0 = a[i + 2], y0 = a[i + 4];
    glyphs.set(g, [a[i + 1], x0, x0 + a[i + 3], y0, y0 + a[i + 5]]);
  }
  const kern = new Map                ();
  for (let a = records(b.kern, 3), i = 0, left = 0; i < a.length; i += 3) { left += a[i]; kern.set(left * 65536 + a[i + 1], a[i + 2]); }
  return { cmap, cover, glyphs, kern, outlines: new GlyphContours(b.outlines, true), offsets: new GlyphContours(b.offsets, false) };
}
