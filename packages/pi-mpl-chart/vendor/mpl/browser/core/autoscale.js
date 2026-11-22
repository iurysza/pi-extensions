// Axes.autoscale_view: one fused pass over all artists (of an axes and its shared
// twins) for finite min/max, the smallest positive value (minpos) and sticky edges;
// then nonsingular -> limit_range_for_scale -> margins in transformed space -> stickies.
import { logNonsingular } from './log.js';
import { forward, inverse } from './scale.js';
import { nonsingular } from './ticker.js';
import { stepped } from './steps.js';
import { dateNonsingular } from './dates.js';
                                                          
import { assertNever } from './types.js';

                                                                                                                                                         
                                                                     

function scan(v              , acc     )       {
  let lo = acc.lo, hi = acc.hi, mp = acc.minpos, count = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x === x && x !== Infinity && x !== -Infinity) { if (x < lo) lo = x; if (x > hi) hi = x; if (x > 0 && x < mp) mp = x; count++; }
  }
  acc.lo = lo; acc.hi = hi; acc.minpos = mp; acc.count += count;
}
function scanSpans(start              , len              , acc     )       {
  let lo = acc.lo, hi = acc.hi, mp = acc.minpos;
  for (let i = 0; i < start.length; i++) {
    const p = start[i], q = p + len[i];
    if (p < lo) lo = p; if (p > hi) hi = p; if (q < lo) lo = q; if (q > hi) hi = q;
    if (p > 0 && p < mp) mp = p; if (q > 0 && q < mp) mp = q;
  }
  acc.lo = lo; acc.hi = hi; acc.minpos = mp; acc.count += 2 * start.length;
}
/** Bbox.update_from_path on a line: _path.update_path_extents reads the path through PathNanRemover, so a vertex
 *  counts only when both of its coordinates are finite (along the data branches `ux` / `uy`). */
function scanPairs(xs              , ys              , X     , Y     , ux         , uy         )       {
  let xlo = X.lo, xhi = X.hi, xmp = X.minpos, ylo = Y.lo, yhi = Y.hi, ymp = Y.minpos, count = 0;
  const n = Math.min(xs.length, ys.length);
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!(x - x === 0 && y - y === 0)) continue;   // NaN or ±Infinity in either coordinate
    if (ux) { if (x < xlo) xlo = x; if (x > xhi) xhi = x; if (x > 0 && x < xmp) xmp = x; }
    if (uy) { if (y < ylo) ylo = y; if (y > yhi) yhi = y; if (y > 0 && y < ymp) ymp = y; }
    count++;
  }
  X.lo = xlo; X.hi = xhi; X.minpos = xmp; Y.lo = ylo; Y.hi = yhi; Y.minpos = ymp;
  if (ux) X.count += count;
  if (uy) Y.count += count;
}
const uniqSorted = (v                   )                    => [...new Set(v)].toSorted((p, q) => p - q);
const emptyAcc = ()      => ({ lo: Infinity, hi: -Infinity, minpos: Infinity, count: 0 });

/** nanmin and nanmax over two arrays, as a 2-point extent (empty when all are NaN). */
const nanExtent = (u              , v              )               => {
  let lo = Infinity, hi = -Infinity;
  for (const w of [u, v]) for (const t of w) if (!Number.isNaN(t)) { if (t < lo) lo = t; if (t > hi) hi = t; }
  return lo <= hi ? Float64Array.of(lo, hi) : new Float64Array(0);
};

export function dataExtents(artists                   )                                             {
  const X = emptyAcc(), Y = emptyAcc();
  const sx           = [], sy           = [];
  for (const a of artists) {
    switch (a.kind) {
      case 'line': {
        // _update_line_limits: the drawn (stepped) path, only along the data-coordinate branches
        const p = stepped(a.x, a.y, a.drawstyle);
        scanPairs(p.x, p.y, X, Y, a.coords.x === 'data', a.coords.y === 'data');
        break;
      }
      case 'axline':                                 // update_datalim([xy1, xy2])
        scan(a.through.kind === 'point' ? Float64Array.of(a.x1, a.through.x2) : Float64Array.of(a.x1), X);
        scan(a.through.kind === 'point' ? Float64Array.of(a.y1, a.through.y2) : Float64Array.of(a.y1), Y);
        break;
      case 'segments': {                             // hlines/vlines: update_datalim of the two extreme corners
        scan(nanExtent(a.x0, a.x1), X); scan(nanExtent(a.y0, a.y1), Y);
        break;
      }
      case 'polygon': {                              // every vertex; hist's stickyBase appends 0 on the value axis
        scan(a.x, X); scan(a.y, Y);
        if (a.stickyBase.kind === 'some') {
          if (a.stickyBase.value.axis === 'x') sx.push(a.stickyBase.value.value);
          else sy.push(a.stickyBase.value.value);
        }
        break;
      }
      case 'sticky':                                 // boxplot manage_ticks: extent + sticky at positions ± 0.5
        scan(Float64Array.from(a.xs), X); scan(Float64Array.from(a.ys), Y);
        for (const v of a.xs) sx.push(v);
        for (const v of a.ys) sy.push(v);
        break;
      case 'errorbar': break;                        // a container: its lines are artists of their own
      case 'bar':
        scanSpans(a.x, a.w, X); scanSpans(a.y, a.h, Y);
        if (a.sticky) switch (a.orientation) {      // the base is a sticky edge
          case 'vertical': for (const v of a.y) sy.push(v); break;
          case 'horizontal': for (const v of a.x) sx.push(v); break;
          default: assertNever(a.orientation);
        }
        break;
      case 'fill': scan(a.x, X); scan(a.y1, Y); scan(a.y2, Y); break;
      case 'scatter': scan(a.x, X); scan(a.y, Y); break;
      case 'image': { const [l,r,b,tp] = a.extent; scan(Float64Array.of(l,r), X); scan(Float64Array.of(b,tp), Y); break; }
      case 'annotation': break;
      case 'span':
        if (a.orientation === 'vertical') { scan(new Float64Array([a.a0, a.a1]), X); }
        else { scan(new Float64Array([a.a0, a.a1]), Y); }
        break;
      case 'text': break;                            // text does not update data limits
      case 'wedge': break;                           // pie fixes both limits (frame=False), so wedges never autoscale
      default: assertNever(a);
    }
  }
  return { x: { ...X, stickies: uniqSorted(sx) }, y: { ...Y, stickies: uniqSorted(sy) } };
}

/** Shared axes autoscale over the union of their data limits. */
export const unionExtent = (es                   )         => ({
  lo: Math.min(...es.map((e) => e.lo)), hi: Math.max(...es.map((e) => e.hi)), minpos: Math.min(...es.map((e) => e.minpos)),
  count: es.reduce((a, e) => a + e.count, 0), stickies: uniqSorted(es.flatMap((e) => e.stickies)),
});

/**
 * Which locator's limit rules apply: the axis' default major locator (Axis._set_scale / unit converter).
 * Derived from the whole AxisSpec, so a new axis kind or scale is a compile error here.
 */
                 
                                                                                  
                                                                   
                                                                                                    
                                                      // AutoDateLocator

function rulesFor(spec          )             {
  switch (spec.kind) {
    case 'numeric':
      switch (spec.scale.kind) {
        case 'linear': return { kind: 'maxn' };
        case 'log': return { kind: 'log', base: spec.scale.base };
        default: return assertNever(spec.scale);
      }
    case 'category': return { kind: 'base' };
    case 'datetime': return { kind: 'date' };
    default: return assertNever(spec);
  }
}

/** Locator.nonsingular */
function locatorNonsingular(r            , lo        , hi        , minpos        )                            {
  switch (r.kind) {
    case 'maxn': case 'base': return nonsingular(lo, hi, 0.05, 1e-15, true);
    case 'log': return logNonsingular(lo, hi, r.base, minpos);
    case 'date': return dateNonsingular(lo, hi);
    default: return assertNever(r);
  }
}
/** Locator.view_limits (autolimit_mode 'data') */
function locatorViewLimits(r            , lo        , hi        , minpos        )                            {
  switch (r.kind) {
    case 'maxn': return nonsingular(lo, hi, 1e-12, 1e-13, true);
    case 'base': case 'date': return nonsingular(lo, hi, 0.001, 1e-15, true);
    case 'log': return logNonsingular(lo, hi, r.base, minpos);
    default: return assertNever(r);
  }
}
/** Scale.limit_range_for_scale */
function limitRange(s       , lo        , hi        , minpos        )                            {
  switch (s.kind) {
    case 'linear': return [lo, hi];
    case 'log': { const mp = Number.isFinite(minpos) ? minpos : 1e-300; return [lo <= 0 ? mp : lo, hi <= 0 ? mp : hi]; }
    default: return assertNever(s);
  }
}

/** handle_single_axis */
export function autoscaleExtent(e        , spec          , s       , margin        )                            {
  const rules = rulesFor(spec);
  const [n0, n1] = locatorNonsingular(rules, e.count > 0 ? e.lo : -Infinity, e.count > 0 ? e.hi : Infinity, e.minpos);
  const tol = 1e-5 * Math.abs(n1 - n0);
  const stickies = s.kind === 'log' ? e.stickies.filter((v) => v > 0) : e.stickies;   // log scales drop nonpositive stickies
  const below = stickies.filter((v) => v < n0 + tol);         // searchsorted(x0 + tol) - 1
  const above = stickies.filter((v) => v >= n1 - tol);        // searchsorted(x1 - tol)
  const [r0, r1] = limitRange(s, n0, n1, e.minpos);
  const t0 = forward(s, r0), t1 = forward(s, r1);
  let delta = (t1 - t0) * margin;
  if (!Number.isFinite(delta)) delta = 0;
  let lo = inverse(s, t0 - delta), hi = inverse(s, t1 + delta);
  if (below.length > 0) lo = Math.max(lo, below[below.length - 1]);
  if (above.length > 0) hi = Math.min(hi, above[0]);
  return locatorViewLimits(rules, lo, hi, e.minpos);
}

export function viewLimits(spec          , s       , e        , margin        )                            {
  switch (spec.limits.kind) {
    case 'fixed': case 'view': return [spec.limits.lo, spec.limits.hi];
    case 'auto': {
      // handle_single_axis ends in set_bound, which keeps an inverted axis inverted
      const [lo, hi] = autoscaleExtent(e, spec, s, margin);
      return spec.limits.inverted ? [hi, lo] : [lo, hi];
    }
    default: return assertNever(spec.limits);
  }
}
