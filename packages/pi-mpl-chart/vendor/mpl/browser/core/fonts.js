// Font faces and text shaping, as matplotlib 3.11 does it through FreeType 2.14 + HarfBuzz (libraqm),
// unhinted. Faces are baked by scripts/gen_fonts.py and packed by scripts/encode_fonts.ts (src/fonts/); everything here is integer-exact against
// FT2Font._layout for the supported character set:
//   - char size: FT_Set_Char_Size(pt·64, dpi) → 16.16 x_scale = FT_DivFix(ppem26, upem)
//   - advances: FT_MulFix(hAdvance, x_scale), in 26.6
//   - kerning: HarfBuzz em_mult on the hb-ft font scale, in 26.6
//   - substitutions: the GSUB lookups behind ccmp/locl/rlig/calt/clig/liga for Latin text
import { decodeTables, FACE_CATALOG,                                                                    } from './fontcodec.js';
import { lookup } from './std.js';
import { assertNever, none, some,             } from './types.js';
import { tracer } from '../trace.js';

const getOr =       (m                   , k   , d   )    => { const o = lookup(m, k); return o.kind === 'some' ? o.value : d; };

// ------------------------------------------------------------------ baked data shapes
                                                   
                      
                                                                           
                                                                    
                                                                                                       
                                                                                                                                                                                                             
                                                                                                                                                                    
                                                                                                                                                                                                                               
                                                                                                                                                                                                  
                        
                                                                         
                                                                                  
                                                   
                                                  
                                                                                                    
                                                         
                                                                               
                                                                                               
                                                                                     
                                                                              
                                                                                                              
                                                                             
                                                  
                                                                                                                                                                                                                     
  

// ------------------------------------------------------------------ compiled GSUB
// The baked subtables are lists (what the font stores); shaping wants membership tests. Each face
// compiles them once at load into Sets and Maps, and each lookup gets the set of glyphs it can
// start on, so the common case (this lookup does nothing to this glyph) is one Set probe.
                                
                                                                                                                                      
           
                                                                
                                                                                         
                                                                         
                                                                             
                                                                                                                               
                                                                                                        
                                                                                                                                       
                                                                                              

const numMap = (o                                  )                              => new Map(Object.entries(o).map(([k, v]) => [Number(k), v]         ));
function groupBy   (xs              , key                  )                                    {
  const m = new Map             ();
  for (const x of xs) { const k = key(x); const o = lookup(m, k); if (o.kind === 'some') o.value.push(x); else m.set(k, [x]); }
  return m;
}
/** One subtable compiled, plus the glyphs it can start on (for 6.2, its coverage). */
function compileSub(st          )                                                            {
  switch (st.t) {
    case 1: return { sub: { t: 1, map: new Map(st.map.map(([a, b]) => [a, b]         )) }, first: st.map.map((p) => p[0]) };
    case 4: return { sub: { t: 4, ligs: groupBy(st.ligs, (l) => l[0]) }, first: st.ligs.map((l) => l[0]) };
    case 5: return { sub: { t: 5, inp: st.inp.map((c) => new Set(c)), recs: st.recs }, first: st.inp.length > 0 ? st.inp[0] : [] };
    case 6:
      switch (st.f) {
        case 1: return { sub: { t: 61, rules: groupBy(st.rules.map((r) => ({ g: r.g, bt: r.bt, inp: r.inp, la: r.la, recs: r.recs })), (r) => r.g) }, first: st.rules.map((r) => r.g) };
        case 2: return { sub: { t: 62, cov: new Set(st.cov), bcd: numMap(st.bcd), icd: numMap(st.icd), lcd: numMap(st.lcd), rules: groupBy(st.rules, (r) => r.c) }, first: st.cov };
        case 3: return { sub: { t: 63, bt: st.bt.map((c) => new Set(c)), inp: st.inp.map((c) => new Set(c)), la: st.la.map((c) => new Set(c)), recs: st.recs }, first: st.inp.length > 0 ? st.inp[0] : [] };
        default: return assertNever(st);
      }
    default: return assertNever(st);
  }
}
function compileLookup(l                                                               )         {
  const cs = l.subs.map(compileSub);
  return { flag: l.flag, subs: cs.map((c) => c.sub), first: new Set(cs.flatMap((c) => c.first)) };
}

/** A loaded face: baked data plus lookup structures. `id` is "Family:weight". */
                    
                                                                                              
                                             
                                                                                          
                                                                            
                                   
                                                                                               
                                  
                                                                                     
                                                
                                                      
                                               
                                                           
                                                                  
                                                          
                                                                                                                  
                                     
  

/** The same tables decodeFace bakes, built as Maps directly; glyph outlines wait until drawn. */
function load(b           , e              )       {
  const t = decodeTables(b);
  return {
    id: `${e.family}:${e.weight}`, family: e.family, weight: e.weight, upm: b.upm, cmap: t.cmap, glyphs: t.glyphs,
    outlines: t.outlines, offsets: t.offsets, kern: t.kern,
    lookups: new Map(Object.entries(b.gsub.lookups).map(([k, v]) => [Number(k), compileLookup(v)]         )),
    gclass: numMap(b.gsub.gclass),
    data: { cover: t.cover, typo: b.typo, gsub: b.gsub }, minAscent: b.typo[0], minDescent: b.typo[1], fallback: [],
  };
}

// ------------------------------------------------------------------ the face registry
// Each shipped face is its own module (mpl/fonts/<name>), so a bundle carries only the faces an
// application imports. The default entry (mpl) registers DejaVu Sans; mpl/core registers nothing —
// pass every face you need to registerFonts(). A face decodes on first use. Font selection always
// runs over the whole catalog, as matplotlib's does over its installed fonts, so registering faces
// never changes which face a text gets; selecting a face that is not registered throws
// FontNotLoadedError instead of silently drawing another one.

/** Rendering needed a shipped face that has not been passed to registerFonts(). */
export class FontNotLoadedError extends Error {
           face        ;
           family        ;
           weight        ;
  /** the module that exports it, e.g. "mpl/fonts/dejavu-sans-bold" */
           module        ;
  /** its export name in that module, e.g. "dejavuSansBold" */
           binding        ;
  constructor(e              ) {
    super(`mpl: font ${e.family} weight ${e.weight} is not loaded. Register it before rendering:\n` +
      `  import { registerFonts } from 'mpl';\n  import { ${e.binding} } from 'mpl/fonts/${e.module}';\n  registerFonts(${e.binding});`);
    this.name = 'FontNotLoadedError';
    this.face = e.id; this.family = e.family; this.weight = e.weight; this.module = `mpl/fonts/${e.module}`; this.binding = e.binding;
  }
}

/** When each face was decoded (performance.now() ms), in order; the live demo turns these into spans. */
                                                                                                                          
const faceLoads             = [];
export const FACE_LOADS                      = faceLoads;

                                                                                                                                                           
const registry = new Map              ();
const entryOf = (id        )               => {
  for (const e of FACE_CATALOG) if (e.id === id) return e;
  return FACE_CATALOG[0];
};

/** Make faces available to rendering. Registering a face twice is harmless. */
export function registerFonts(...faces                      )       {
  for (const b of faces) if (!registry.has(b.id)) registry.set(b.id, { entry: entryOf(b.id), baked: b, face: { kind: 'none' } });
}

/** The ids of the registered faces, in catalog order. */
export const registeredFonts = ()                    => FACE_CATALOG.filter((e) => registry.has(e.id)).map((e) => e.id);

/** A shipped face, decoded on first use; FontNotLoadedError if it is not registered. */
export function getFace(e              )       {
  const o = lookup(registry, e.id);
  if (o.kind === 'none') throw new FontNotLoadedError(e);
  const slot = o.value;
  if (slot.face.kind === 'some') return slot.face.value;
  const f = tracer.span('font.decode', { face: e.id }, () => {
    const t = performance.now(), face = load(slot.baked, e);
    faceLoads.push({ id: face.id, startMs: t, endMs: performance.now(), glyphs: face.glyphs.size });
    return face;
  });
  slot.face = { kind: 'some', value: f };
  return f;
}

/** matplotlib's named weights. */
const WEIGHTS                              = new Map([
  ['ultralight', 100], ['light', 200], ['normal', 400], ['regular', 400], ['book', 400], ['roman', 400], ['medium', 500],
  ['semibold', 600], ['demibold', 600], ['demi', 600], ['bold', 700], ['heavy', 800], ['extra bold', 800], ['black', 800],
]);
/** matplotlib's weights: a number, or a named weight (unknown names read as normal). */
export const parseWeight = (v         )         => (typeof v === 'number' ? v : typeof v === 'string' ? getOr(WEIGHTS, v, 400) : 400);

/** findfont for one font.family entry: its first name we ship, at the nearest weight (over every shipped face). */
function findEntry(names                   , weight        )                       {
  for (const fam of names) {
    // matplotlib's generic families resolve through font.sans-serif / font.serif, whose first entries we ship
    const name = fam === 'sans-serif' ? 'DejaVu Sans' : fam === 'serif' ? 'DejaVu Serif' : fam;
    const cands = FACE_CATALOG.filter((f) => f.family.toLowerCase() === name.toLowerCase());
    if (cands.length > 0) return some(cands.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a)));
  }
  return none;
}
const chains = new Map              ();
/**
 * font_manager._find_fonts_by_props + get_font: each font.family entry resolves to one font, the first is the face and
 * the rest its fallback chain (FT2Font _fallback_list), duplicates dropped; none found → DejaVu Sans
 * (fallback_to_default). matplotlib ends the chain with LastResort, which mpl does not ship: a character no face has
 * draws the first face's .notdef. Throws FontNotLoadedError if a face it picks is not registered.
 */
export function resolveFace(families                                , weight        )       {
  const ids                 = [];
  for (const names of families) {
    const e = findEntry(names, weight);
    if (e.kind === 'some' && !ids.includes(e.value)) ids.push(e.value);
  }
  if (ids.length === 0) return getFace(weight >= 600 ? FACE_CATALOG[1] : FACE_CATALOG[0]);
  const primary = getFace(ids[0]);
  if (ids.length === 1) return primary;
  const key = ids.map((e) => e.id).join('|');
  const hit = lookup(chains, key);
  if (hit.kind === 'some' && hit.value.cmap === primary.cmap) return hit.value;
  const chained       = { ...primary, fallback: ids.slice(1).map(getFace) };
  chains.set(key, chained);
  return chained;
}
/** The face a laid-out text node names (its Face.id). */
export function faceById(id        )       {
  for (const e of FACE_CATALOG) if (e.id === id) return getFace(e);
  throw new Error(`mpl: unknown font face ${JSON.stringify(id)}`);
}

// ------------------------------------------------------------------ FreeType fixed point
export function mulFix(a        , b        )         {
  let s = 1;
  if (a < 0) { a = -a; s = -s; }
  if (b < 0) { b = -b; s = -s; }
  const c = Math.floor((a * b + 0x8000) / 65536);
  return s > 0 ? c : -c;
}
export function divFix(a        , b        )         {
  let s = 1;
  if (a < 0) { a = -a; s = -s; }
  if (b < 0) { b = -b; s = -s; }
  const q = b > 0 ? Math.floor((a * 65536 + Math.floor(b / 2)) / b) : 0x7fffffff;
  return s > 0 ? q : -q;
}
export const mulDiv = (a        , b        , c        )         => {
  const s = (a < 0 ? -1 : 1) * (b < 0 ? -1 : 1);
  return s * Math.floor((Math.abs(a) * Math.abs(b) + Math.floor(c / 2)) / c);
};
/** FT_Set_Char_Size(face, (FT_F26Dot6)(pt·64), 0, dpi, dpi) → 16.16 scale. */
export function ftScale(face      , sizePt        , dpi        )         {
  const ppem26 = Math.trunc((Math.trunc(sizePt * 64) * Math.trunc(dpi) + 36) / 72);
  return divFix(ppem26, face.upm);
}
/** hb-ft's font scale and HarfBuzz em_mult: (v · ((xs << 16) / upem) + 32768) >> 16. */
function hbKern(face      , v        , scale        )         {
  const xs = Math.floor((scale * face.upm + 32768) / 65536);
  const mult = Math.floor(xs * 65536 / face.upm);
  return Math.floor((v * mult + 32768) / 65536);
}

// ------------------------------------------------------------------ GSUB
const LOOKUP_IGNORE_MARKS = 8, LOOKUP_IGNORE_BASE = 2, LOOKUP_IGNORE_LIGS = 4;

function ignorable(face      , flag        , g        )          {
  if (flag === 0) return false;
  const c = getOr(face.gclass, g, 0);
  return ((flag & LOOKUP_IGNORE_MARKS) !== 0 && c === 3) || ((flag & LOOKUP_IGNORE_BASE) !== 0 && c === 1) || ((flag & LOOKUP_IGNORE_LIGS) !== 0 && c === 2);
}

/** Next non-ignorable index after i (or before, with dir −1); −1 if none. */
function step(face      , flag        , buf                   , i        , dir        )         {
  for (let j = i + dir; j >= 0 && j < buf.length; j += dir) if (!ignorable(face, flag, buf[j])) return j;
  return -1;
}

                                                 
/** Match a sequence starting at (or around) i; returns the matched buffer indices or empty. */
function matchSeq(face      , flag        , buf                   , start        , n        , m         , dir        , first         )           {
  const out           = [];
  let j = first ? start : step(face, flag, buf, start, dir);
  for (let k = 0; k < n; k++) {
    if (j < 0 || !m(buf[j], k)) return [];
    out.push(j);
    if (k < n - 1) j = step(face, flag, buf, j, dir);
  }
  return out;
}

function applyLookup(face      , li        , buf          , i        )         {
  const found = lookup(face.lookups, li);
  if (found.kind === 'none') return -1;                  // a lookup outside the baked closure
  const L = found.value;
  if (!L.first.has(buf[i]) || ignorable(face, L.flag, buf[i])) return -1;
  for (const st of L.subs) {
    const r = applySub(face, L.flag, st, buf, i);
    if (r >= 0) return r;
  }
  return -1;
}

const inSets = (sets                 )          => (x, k) => sets[k].has(x);

/** Apply one subtable at i. Returns the index to continue from, or −1 if it didn't apply. */
function applySub(face      , flag        , st      , buf          , i        )         {
  const g = buf[i];
  switch (st.t) {
    case 1: { const o = lookup(st.map, g); if (o.kind === 'none') return -1; buf[i] = o.value; return i + 1; }
    case 4: {
      for (const lig of getOr(st.ligs, g, [])) {
        const comps = lig.slice(1, -1);
        const idx = matchSeq(face, flag, buf, i, comps.length, (x, k) => x === comps[k], 1, false);
        if (comps.length > 0 && idx.length === 0) continue;
        for (const j of idx.toReversed()) buf.splice(j, 1);
        buf[i] = lig[lig.length - 1];
        return i + 1;
      }
      return -1;
    }
    case 5: {
      const inp = matchSeq(face, flag, buf, i, st.inp.length, inSets(st.inp), 1, true);
      if (inp.length === 0) return -1;
      return context(face, buf, inp, st.recs);
    }
    case 61: {
      for (const r of getOr(st.rules, g, [])) {
        const inp = matchSeq(face, flag, buf, i, r.inp.length + 1, (x, k) => (k === 0 ? x === g : x === r.inp[k - 1]), 1, true);
        if (inp.length === 0) continue;
        if (r.bt.length > 0 && matchSeq(face, flag, buf, i, r.bt.length, (x, k) => x === r.bt[k], -1, false).length === 0) continue;
        if (r.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], r.la.length, (x, k) => x === r.la[k], 1, false).length === 0) continue;
        return context(face, buf, inp, r.recs);
      }
      return -1;
    }
    case 62: {
      if (!st.cov.has(g)) return -1;
      const cls = (cd                             , x        )         => getOr(cd, x, 0);
      for (const r of getOr(st.rules, cls(st.icd, g), [])) {
        const inp = matchSeq(face, flag, buf, i, r.inp.length + 1, (x, k) => (k === 0 ? true : cls(st.icd, x) === r.inp[k - 1]), 1, true);
        if (inp.length === 0) continue;
        if (r.bt.length > 0 && matchSeq(face, flag, buf, i, r.bt.length, (x, k) => cls(st.bcd, x) === r.bt[k], -1, false).length === 0) continue;
        if (r.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], r.la.length, (x, k) => cls(st.lcd, x) === r.la[k], 1, false).length === 0) continue;
        return context(face, buf, inp, r.recs);
      }
      return -1;
    }
    case 63: {
      const inp = matchSeq(face, flag, buf, i, st.inp.length, inSets(st.inp), 1, true);
      if (inp.length === 0) return -1;
      if (st.bt.length > 0 && matchSeq(face, flag, buf, i, st.bt.length, inSets(st.bt), -1, false).length === 0) return -1;
      if (st.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], st.la.length, inSets(st.la), 1, false).length === 0) return -1;
      return context(face, buf, inp, st.recs);
    }
    default: return assertNever(st);
  }
}

/** Apply nested lookups at matched input positions; continue after the match. */
function context(face      , buf          , inp                   , recs      )         {
  let end = inp[inp.length - 1] + 1;
  for (const [seq, li] of recs) {
    if (seq >= inp.length) continue;
    const before = buf.length;
    applyLookup(face, li, buf, inp[seq]);
    end += buf.length - before;                         // ligatures shrink the buffer
  }
  return end;
}

// ------------------------------------------------------------------ missing glyphs
/** Is code point `cp` mapped by the font file itself (not just by the baked subset)? */
const inFontFile = (face      , cp        )          => {
  const runs = face.data.cover;
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1, [a, b] = runs[mid];
    if (cp < a) hi = mid - 1; else if (cp > b) lo = mid + 1; else return true;
  }
  return false;
};
/** Why a character has no baked glyph: the font lacks it (matplotlib warns and draws .notdef), or
 *  matplotlib would draw a real glyph that mpl does not bundle (we draw .notdef, so say so). */
                          
                                                                                  
                                                                                   
export const missingGlyphMessage = (m              )         => {
  const ch = String.fromCodePoint(m.cp);
  switch (m.kind) {
    // ft2font.cpp ft_glyph_warn: "Glyph %lu (%s) missing from font(s) %s." (Python adds \N{NAME})
    case 'not-in-font': return `Glyph ${m.cp} (${ch}) missing from font(s) ${m.family}.`;
    case 'not-bundled': return `Glyph ${m.cp} (${ch}) is in ${m.family} but not bundled with mpl; drawing .notdef. See scripts/gen_fonts.py.`;
    default: return assertNever(m);
  }
};
/** Each message once per process, as Python's default warnings filter does. Replaceable for tests. */
const warned = new Set        ();
let glyphWarn                        = (msg) => { console.warn(`UserWarning: ${msg}`); };
export function setGlyphWarningSink(sink                       )       { glyphWarn = sink; warned.clear(); }
function noteMissing(face      , ch        )       {
  const cp = Number(ch.codePointAt(0));                          // ch is one code point from [...text]
  const msg = missingGlyphMessage({ kind: inFontFile(face, cp) ? 'not-bundled' : 'not-in-font', cp, family: face.family });
  if (warned.has(msg)) return;
  warned.add(msg);
  glyphWarn(msg);
}

/** Characters → glyph ids, with the default GSUB features applied in lookup order. */
export function shapeGlyphs(face      , text        )           {
  const buf = [...text].map((ch) => {
    const g = lookup(face.cmap, ch);
    if (g.kind === 'some') return g.value;
    noteMissing(face, ch);
    return 0;                                                       // .notdef, as FreeType returns
  });
  for (const li of face.data.gsub.order) {
    for (let i = 0; i < buf.length;) {
      const r = applyLookup(face, li, buf, i);
      i = r > i ? r : i + 1;
    }
  }
  return buf;
}

// ------------------------------------------------------------------ positions
const advanceUnits = (face      , g        )         => getOr(face.glyphs, g, [0, 0, 0, 0, 0]         )[0];

/** Pen positions in 26.6 for shaped glyphs; n+1 entries, the last is the total advance. */
export function penPositions(face      , gids                   , scale        )             {
  const pens = new Int32Array(gids.length + 1);
  let pen = 0;
  for (let i = 0; i < gids.length; i++) {
    if (i > 0) pen += hbKern(face, getOr(face.kern, gids[i - 1] * 65536 + gids[i], 0), scale);
    pens[i] = pen;
    // hb-ft: FT_Get_Advance (unhinted) is FT_MulDiv(adv, x_scale, 64) in 16.16, rounded to 26.6
    pen += Math.floor((mulDiv(advanceUnits(face, gids[i]), scale, 64) + 512) / 1024);
  }
  pens[gids.length] = pen;
  return pens;
}

/** `table[key] * scale` with scale = 1 / upem * size * dpi / 72, as _get_layout computes it. */
export function minMetrics(face      , sizePt        , dpi        )                                                        {
  const scale = 1 / face.upm * sizePt * dpi / 72;
  return { ascent: face.minAscent * scale, descent: face.minDescent * scale };
}

/** Ink extent of shaped glyphs (union of scaled outline cboxes, 26.6 → px): what FT2Font.set_text measures. */
export function inkExtent(face      , gids                   , scale        )                                                   {
  let lo = 32000 * 64, hi = -32000 * 64;
  for (const g of gids) {
    const b = getOr(face.glyphs, g, [0, 0, 0, 0, 0]         );
    const y0 = mulFix(b[3], scale), y1 = mulFix(b[4], scale);
    if (y0 < lo) lo = y0; if (y1 > hi) hi = y1;
  }
  return gids.length === 0 || lo > hi ? { yMax: 0, yMin: 0 } : { yMax: hi / 64, yMin: lo / 64 };
}

/** Mathtext glyph metrics (by character): linearHoriAdvance and the scaled outline's cbox, in px. */
export function mathMetrics(face      , ch        , sizePt        , dpi        )                                                                                 {
  const [adv, , , yMin, yMax] = getOr(face.glyphs, getOr(face.cmap, ch, 0), [0, 0, 0, 0, 0]         );
  const scale = ftScale(face, sizePt, dpi);
  return { advance: mulDiv(adv, scale, 64) / 65536, iceberg: mulFix(yMax, scale) / 64, depth: -mulFix(yMin, scale) / 64 };
}
export const glyphOf = (face      , ch        )         => getOr(face.cmap, ch, 0);
