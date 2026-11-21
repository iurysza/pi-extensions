// Colormaps and norms, matching matplotlib.colors (3.11.2): LUT lookup, Normalize,
// LogNorm, TwoSlopeNorm, and Colormap.__call__(…, bytes=True).
// Each face of LUT data is its own module under src/colormaps/. The default entry (mpl) registers
// viridis; mpl/core registers nothing — pass every pack you need to registerColormaps().
import { CMAP_NAMES } from './data/colormaps.js';
import { log10 } from './libm.js';
import { isPlainObject, lookup, prop } from './std.js';
                                                             
import { assertNever, err, none, ok, some } from './types.js';

/** Packed LUT: trunc RGBA×(N+3) then round RGBA×(N+3), base64. */
                                                                                           

/** A baked colormap: N LUT entries plus under / over / bad. */
                        
                        
                     
                                                       
                             
                                                    
                             
                                                                                                      
                                      
  

const hex2 = (v        )         => v.toString(16).padStart(2, '0');
function fromB64(b64        )             {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** Decoded byte length of a pack's base64. Canonical padded base64 is measured without decoding; anything else is
 *  decoded, so atob rejects malformed input at registration exactly as an eager decode would. */
function packedLength(b64        )         {
  if (b64.length % 4 !== 0 || !B64.test(b64)) return fromB64(b64).length;
  return (b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

// Registration is lazy: a pack is validated (by length) when registered, and decoded into its LUTs on the first
// getColormap of that name. An app that registers every colormap pays only for the ones its charts use.
                                                                              
const packs = new Map               ();
const baked = new Map                  ();

function bake(pack          )           {
  const raw = fromB64(pack.b64);
  const nComp = 4 * (pack.N + 3);
  // trunc + round: nearest / data-stage / mapBytes. Exact float32 comes from registerColormapRgba.
  if (raw.length === 2 * nComp) {
    const trunc = raw.subarray(0, nComp), round = raw.subarray(nComp);
    return { name: pack.name, N: pack.N, trunc, round, rgba: none };
  }
  // float32-only pack: derive trunc/round and keep exact rgba
  if (raw.length === nComp * 4) {
    const rgba = new Float32Array(raw.buffer, raw.byteOffset, nComp);
    const trunc = new Uint8Array(nComp);
    const round = new Uint8Array(nComp);
    for (let i = 0; i < nComp; i++) {
      const v = rgba[i] * 255;
      trunc[i] = v < 0 ? 0 : v > 255 ? 255 : (v | 0);
      const r = Math.floor(v + 0.5);
      round[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    }
    return { name: pack.name, N: pack.N, trunc, round, rgba: some(rgba) };
  }
  throw new Error(`colormap ${pack.name}: packed length ${raw.length}, want ${2 * nComp} (trunc+round) or ${nComp * 4} (float32)`);
}

/** Decode a registered entry on first use; cached until its name is registered again. */
function resolve(name        )                   {
  const hit = lookup(baked, name);
  if (hit.kind === 'some') return hit;
  const e = lookup(packs, name);
  if (e.kind === 'none') return none;
  const c = bake(e.value.pack);
  const r = e.value.rgba;
  const out           = r.kind === 'none' ? c : {
    name: c.name, N: c.N, trunc: c.trunc, round: c.round,
    rgba: some(new Float32Array(fromB64(r.value.b64).buffer, 0, 4 * (r.value.N + 3))),
  };
  baked.set(name, out);
  return some(out);
}

/** Register one or more colormap packs (each `src/colormaps/*.ts` export).
 *  `_r` variants are separate packs from matplotlib (LinearSegmentedColormap.reversed rebuilds segmentdata — a LUT
 *  flip is wrong). Registering a name again replaces it, float32 sidecar included. */
export function registerColormaps(...ps                     )       {
  for (const p of ps) {
    const nComp = 4 * (p.N + 3), n = packedLength(p.b64);
    if (n !== 2 * nComp && n !== nComp * 4) {
      throw new Error(`colormap ${p.name}: packed length ${n}, want ${2 * nComp} (trunc+round) or ${nComp * 4} (float32)`);
    }
    packs.set(p.name, { pack: p, rgba: none });
    baked.delete(p.name);
  }
}


/** File stem + export name for a colormap (RdBu → rdBu / rdBu_r). */
function cmapImport(name        )                                                      {
  const base = name.endsWith('_r') ? name.slice(0, -2) : name;
  const file = base === 'RdBu' ? 'rdBu' : base.toLowerCase();
  const binding = name === 'RdBu' ? 'rdBu' : name === 'RdBu_r' ? 'rdBu_r'
    : name.toLowerCase() === name ? name : file + (name.endsWith('_r') ? '_r' : '');
  return { file, binding };
}

/**
 * Rendering (or getColormap) needed a shipped colormap that has not been passed to registerColormaps().
 * Never falls back to another map.
 */
export class ColormapNotLoadedError extends Error {
           cmap        ;
           module        ;
           binding        ;
  constructor(name        ) {
    const { file, binding } = cmapImport(name);
    const mod = `mpl/colormaps/${file}`;
    super(`mpl: colormap '${name}' is not loaded. Register it before rendering:\n` +
      `  import { registerColormaps } from 'mpl';\n` +
      `  import { ${binding} } from '${mod}';\n` +
      `  registerColormaps(${binding});`);
    this.name = 'ColormapNotLoadedError';
    this.cmap = name; this.module = mod; this.binding = binding;
  }
}

/**
 * rgba-stage imshow needs the exact matplotlib float32 `_lut`. Without registerColormapRgba the
 * library must not silently use round/255 (that diverges from Agg by thousands of pixels).
 */
export class MissingColormapRgbaError extends Error {
           cmap        ;
           module        ;
           binding        ;
  constructor(name        ) {
    const { file, binding } = cmapImport(name);
    const rgbaBinding = `${binding}_rgba`;
    const mod = `mpl/colormaps/${file}.rgba`;
    super(`mpl: colormap '${name}' has no float32 LUT for rgba-stage resampling. Register it before rendering:\n` +
      `  import { registerColormapRgba } from 'mpl';\n` +
      `  import { ${rgbaBinding} } from '${mod}';\n` +
      `  registerColormapRgba(${rgbaBinding});`);
    this.name = 'MissingColormapRgbaError';
    this.cmap = name; this.module = mod; this.binding = rgbaBinding;
  }
}

/** Float32 `_lut` for rgba-stage; throws MissingColormapRgbaError if not registered. */
export function requireColormapRgba(cmap          )               {
  if (cmap.rgba.kind === 'some') return cmap.rgba.value;
  throw new MissingColormapRgbaError(cmap.name);
}

/** Float32 LUT sidecar (matplotlib `_lut`) for rgba-stage AGG resampling. */
                                                                                               

/**
 * Attach exact float32 `_lut` packs. Packs whose colormap is not registered are skipped
 * (so `registerColormapRgba(plasma_rgba, plasma_r_rgba)` after only `registerColormaps(plasma)` is fine).
 */
export function registerColormapRgba(...ps                         )       {
  for (const p of ps) {
    const hit = lookup(packs, p.name);
    if (hit.kind === 'none') continue;
    const nComp = 4 * (p.N + 3), n = packedLength(p.b64);
    if (n !== nComp * 4) throw new Error(`registerColormapRgba ${p.name}: length ${n}, want ${nComp * 4}`);
    packs.set(p.name, { pack: hit.value.pack, rgba: some(p) });
    baked.delete(p.name);
  }
}

/** matplotlib.pyplot.get_cmap. Unknown names and unregistered shipped names error with the import to add. */
export function getColormap(name        )                   {
  const hit = resolve(name);
  if (hit.kind === 'some') return ok(hit.value);
  const base = name.endsWith('_r') ? name.slice(0, -2) : name;
  if (!CMAP_NAMES.some((n) => n === base)) {
    return err(`Unknown colormap name '${name}'. Available: ${CMAP_NAMES.join(', ')} (and _r)`);
  }
  return err(new ColormapNotLoadedError(name).message);
}

/** Like getColormap but throws ColormapNotLoadedError for an unregistered shipped name. */
export function requireColormap(name        )           {
  const hit = resolve(name);
  if (hit.kind === 'some') return hit.value;
  const base = name.endsWith('_r') ? name.slice(0, -2) : name;
  if (CMAP_NAMES.some((n) => n === base)) throw new ColormapNotLoadedError(name);
  throw new Error(`Unknown colormap name '${name}'. Available: ${CMAP_NAMES.join(', ')} (and _r)`);
}

export const availableColormaps = ()                    =>
  [...CMAP_NAMES, ...CMAP_NAMES.map((n) => `${n}_r`)];

export const registeredColormaps = ()                    => [...packs.keys()].toSorted();

/** RGBA uint8 → Paint (hex + alpha in [0,1]). Fully transparent → none. */
export function rgbaToPaint(r        , g        , b        , a        )        {
  if (a === 0) return { kind: 'none' };
  return { kind: 'solid', color: { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a / 255 } };
}

export function rgbaToRgb(r        , g        , b        , a        )      {
  return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a / 255 };
}

function lutIndex(cmap          , x        )         {
  const { N } = cmap;
  if (Number.isNaN(x)) return N + 2;
  let xa = x * N;
  if (xa === N) xa = N - 1;
  if (xa < 0) return N;
  if (xa >= N) return N + 1;
  return xa | 0;
}

/** Colormap.__call__(X, bytes=True). */
export function mapBytes(cmap          , xs                   , out            )             {
  const { trunc } = cmap;
  for (let i = 0; i < xs.length; i++) {
    const s = lutIndex(cmap, xs[i]) * 4, o = i * 4;
    out[o] = trunc[s]; out[o + 1] = trunc[s + 1]; out[o + 2] = trunc[s + 2]; out[o + 3] = trunc[s + 3];
  }
  return out;
}

/** Convenience: one float → RGBA uint8 tuple (bytes=True). */
export function mapOneBytes(cmap          , x        )                                            {
  const buf = new Uint8Array(4);
  mapBytes(cmap, [x], buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

/** Map normalized floats to Paint[] using Agg's rounded uint8 LUT. */
export function mapPaints(cmap          , xs                   )                   {
  const { round } = cmap;
  const out          = [];
  for (let i = 0; i < xs.length; i++) {
    const s = lutIndex(cmap, xs[i]) * 4;
    out.push(rgbaToPaint(round[s], round[s + 1], round[s + 2], round[s + 3]));
  }
  return out;
}

// ---------------------------------------------------------------- norms

                  
                                                                                                     
                                                                                                  
                                                                                                                                  

export const normalize = (vmin        , vmax        , clip = false)       => ({ kind: 'linear', vmin, vmax, clip });
export const logNorm = (vmin        , vmax        , clip = false)       => ({ kind: 'log', vmin, vmax, clip });
export const twoSlopeNorm = (vmin        , vcenter        , vmax        , clip = false)       =>
  ({ kind: 'twoslope', vmin, vcenter, vmax, clip });

export function autoscaleNorm(n      , data                   )       {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (n.kind === 'log' && !(v > 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(lo <= hi)) { lo = 0; hi = 1; }
  switch (n.kind) {
    case 'linear':
      return { kind: 'linear', vmin: Number.isFinite(n.vmin) ? n.vmin : lo, vmax: Number.isFinite(n.vmax) ? n.vmax : hi, clip: n.clip };
    case 'log':
      return { kind: 'log', vmin: Number.isFinite(n.vmin) ? n.vmin : lo, vmax: Number.isFinite(n.vmax) ? n.vmax : hi, clip: n.clip };
    case 'twoslope':
      return n;
    default: return assertNever(n);
  }
}

/** The norm's vmin/vmax with any missing (NaN) one taken from the data (Normalize/LogNorm.autoscale_None):
 *  finite values, and for LogNorm only positive ones. A LogNorm with no positive data throws. */
export function normLimits(n      , data                   )                            {
  const filled = autoscaleNorm(n, data);
  switch (filled.kind) {
    case 'linear': return [filled.vmin, filled.vmax];
    case 'log': {
      if (!(filled.vmin > 0) || !(filled.vmax > 0)) {
        throw new RangeError(`LogNorm: vmin and vmax must be positive (data has no positive values or a limit is <= 0), got vmin=${filled.vmin}, vmax=${filled.vmax}`);
      }
      return [filled.vmin, filled.vmax];
    }
    case 'twoslope': return [filled.vmin, filled.vmax];
    default: return assertNever(filled);
  }
}

export function applyNorm(n      , xs                   , out              )               {
  const len = xs.length;
  switch (n.kind) {
    case 'linear': {
      const { vmin, vmax, clip } = n;
      if (vmin === vmax) { for (let i = 0; i < len; i++) out[i] = Number.isNaN(xs[i]) ? NaN : 0; return out; }
      if (vmin > vmax) throw new Error('minvalue must be less than or equal to maxvalue');
      const span = vmax - vmin;
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        out[i] = (v - vmin) / span;
      }
      return out;
    }
    case 'log': {
      const { vmin, vmax, clip } = n;
      if (vmin > vmax) throw new Error('vmin must be less or equal to vmax');
      if (vmin === vmax) { for (let i = 0; i < len; i++) out[i] = Number.isNaN(xs[i]) ? NaN : 0; return out; }
      const tMin = log10(vmin), tMax = log10(vmax);
      if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) throw new Error('Invalid vmin or vmax');
      const span = tMax - tMin;
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        const t = log10(v);
        out[i] = Number.isFinite(t) ? (t - tMin) / span : NaN;
      }
      return out;
    }
    case 'twoslope': {
      const { vmin, vcenter, vmax, clip } = n;
      if (!(vmin < vcenter && vcenter < vmax)) throw new Error('vmin, vcenter, and vmax must be in ascending order');
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        if (v < vmin) out[i] = -Infinity;
        else if (v > vmax) out[i] = Infinity;
        else if (v < vcenter) out[i] = 0.5 * (v - vmin) / (vcenter - vmin);
        else out[i] = 0.5 + 0.5 * (v - vcenter) / (vmax - vcenter);
      }
      return out;
    }
    default: return assertNever(n);
  }
}

export function scalarToPaints(cmap          , norm      , data                   )                   {
  const n = autoscaleNorm(norm, data);
  const mid = new Float64Array(data.length);
  applyNorm(n, data, mid);
  return mapPaints(cmap, mid);
}

export function parseColormap(v         )                   {
  if (typeof v !== 'string') return err(`cmap must be a colormap name string, got ${typeof v}`);
  const hit = resolve(v);
  if (hit.kind === 'some') return ok(hit.value);
  const base = v.endsWith('_r') ? v.slice(0, -2) : v;
  if (CMAP_NAMES.some((n) => n === base)) throw new ColormapNotLoadedError(v);
  return getColormap(v);
}

export function parseNormKw(opts   
                                                               
                                 
 )               {
  const vmin = opts.vmin.kind === 'some' ? opts.vmin.value : NaN;
  const vmax = opts.vmax.kind === 'some' ? opts.vmax.value : NaN;
  if (opts.norm.kind === 'none') return ok(normalize(vmin, vmax, false));
  const n = opts.norm.value;
  if (n === 'linear') return ok(normalize(vmin, vmax, false));
  // a missing vmin/vmax is NaN here and autoscales from the data's positive values (LogNorm.autoscale_None)
  if (n === 'log') return ok(logNorm(vmin, vmax, false));
  if (isPlainObject(n)) {
    const kindO = prop(n, 'kind');
    const kind = kindO.kind === 'some' ? kindO.value : 'linear';
    const numProp = (k        )                 => {
      const p = prop(n, k);
      return p.kind === 'some' && typeof p.value === 'number' ? some(p.value) : none;
    };
    const clipP = prop(n, 'clip');
    const clip = clipP.kind === 'some' && clipP.value === true;
    const lo = numProp('vmin'); const hi = numProp('vmax');
    if (kind === 'linear') return ok(normalize(lo.kind === 'some' ? lo.value : vmin, hi.kind === 'some' ? hi.value : vmax, clip));
    if (kind === 'log') {
      return ok(logNorm(lo.kind === 'some' ? lo.value : vmin, hi.kind === 'some' ? hi.value : vmax, clip));
    }
    if (kind === 'twoslope') {
      const vc = numProp('vcenter');
      if (lo.kind === 'none' || vc.kind === 'none' || hi.kind === 'none') return err('TwoSlopeNorm requires vmin, vcenter, vmax');
      return ok(twoSlopeNorm(lo.value, vc.value, hi.value, clip));
    }
  }
  return err(`norm must be 'linear', 'log', or { kind, vmin, vmax, … }, got ${JSON.stringify(n)}`);
}

export function isNumericColorArray(v         )                         {
  if (v instanceof Float64Array || v instanceof Float32Array) return true;
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((x) => typeof x === 'number');
}

export { CMAP_NAMES };
