// numpy.histogram and numpy.histogram_bin_edges (numpy 2.5), ported operation for
// operation: the same float expressions in the same order, so bin edges and counts
// match bit for bit. matplotlib's Axes.hist calls these (see api.ts).
                                                 
import { assertNever, err, ok } from './types.js';

/** The bin estimators np.histogram_bin_edges accepts by name. */
                                                                                                     
export const BIN_ESTIMATORS                          = ['auto', 'fd', 'doane', 'scott', 'stone', 'rice', 'sturges', 'sqrt'];
/** hist(bins=…): a count of equal-width bins, explicit edges, or an estimator name. */
                  
                                                  
                                                            
                                                                
/** A 1-D sample and its numpy dtype class: a list of Python ints is an integer array, which changes
 *  the estimators (bin width ≥ 1) and how reductions accumulate (buffered casts to float64). */
                                                                                  
                                                      

// ---------------------------------------------------------------- reductions
/** pairwise_sum_DOUBLE (numpy/_core/src/umath/loops_utils.h): 8 accumulators per 128-block, halves above. */
function pairwise(a              , lo        , n        )         {
  if (n < 8) {
    let res = 0;
    for (let i = 0; i < n; i++) res += a[lo + i];
    return res;
  }
  if (n <= 128) {
    const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
    let i = 8;
    for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j++) r[j] += a[lo + i + j];
    let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
    for (; i < n; i++) res += a[lo + i];
    return res;
  }
  let n2 = Math.floor(n / 2);
  n2 -= n2 % 8;
  return pairwise(a, lo, n2) + pairwise(a, lo + n2, n - n2);
}
/** np.add.reduce over float64. An integer array is cast to float64 through 8192-element buffers,
 *  each reduced pairwise and accumulated in order. */
export function npSum(a              , integer          = false)         {
  if (!integer) return pairwise(a, 0, a.length);
  let acc = 0;
  for (let i = 0; i < a.length; i += 8192) acc += pairwise(a, i, Math.min(8192, a.length - i));
  return acc;
}
const npMean = (s        )         => npSum(s.values, s.integer) / s.values.length;
/** np.std (ddof 0): sqrt(sum((x - mean)²) / n). */
function npStd(s        )         {
  const m = npMean(s);
  const d = s.values.map((v) => { const t = v - m; return t * t; });
  return Math.sqrt(npSum(d) / s.values.length);
}
/** np.percentile(x, q), method 'linear': virtual index n·q + (1 − q) − 1, then _lerp. */
function npPercentile(sorted              , q        )         {
  const n = sorted.length;
  const virt = n * q + (1 + q * (1 - 1 - 1)) - 1;
  if (virt >= n - 1) return sorted[n - 1];
  if (virt < 0) return sorted[0];
  const prev = Math.floor(virt), gamma = virt - prev;
  const a = sorted[prev], b = sorted[prev + 1], diff = b - a;
  return gamma >= 0.5 ? b - diff * (1 - gamma) : a + diff * gamma;
}
/** np.sort order: NaN after every number. */
const npSorted = (v              )               => v.toSorted((p, q) => (Number.isNaN(p) ? (Number.isNaN(q) ? 0 : 1) : Number.isNaN(q) ? -1 : p - q));
const ptp = (v              )         => { let lo = Infinity, hi = -Infinity; for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; } return hi - lo; };

// ---------------------------------------------------------------- estimators (_hist_bin_*)
function binWidth(name              , s        , range                           )         {
  const x = s.values, n = x.length;
  const sqrtW = ()         => ptp(x) / Math.sqrt(n);
  const sturges = ()         => ptp(x) / (Math.log2(n) + 1.0);
  const fd = ()         => {
    const sorted = npSorted(x);
    const iqr = npPercentile(sorted, 0.75) - npPercentile(sorted, 0.25);
    return 2.0 * iqr * Math.pow(n, -1.0 / 3.0);
  };
  switch (name) {
    case 'sqrt': return sqrtW();
    case 'sturges': return sturges();
    case 'rice': return ptp(x) / (2.0 * Math.pow(n, 1.0 / 3));
    case 'scott': return Math.pow(24.0 * Math.pow(Math.PI, 0.5) / n, 1.0 / 3.0) * npStd(s);
    case 'fd': return fd();
    case 'auto': return Math.min(Math.max(fd(), sqrtW() / 2), sturges());
    case 'doane': {
      if (n > 2) {
        const sg1 = Math.sqrt(6.0 * (n - 2) / ((n + 1.0) * (n + 3)));
        const sigma = npStd(s);
        if (sigma > 0.0) {
          const m = npMean(s);
          const temp = x.map((v) => Math.pow((v - m) / sigma, 3));
          const g1 = npSum(temp) / n;
          return ptp(x) / (1.0 + Math.log2(n) + Math.log2(1.0 + Math.abs(g1) / sg1));
        }
      }
      return 0.0;
    }
    case 'stone': {
      const ptpX = ptp(x);
      if (n <= 1 || ptpX === 0) return 0;
      const jhat = (nbins        )         => {
        const hh = ptpX / nbins;
        const counts = uniformCounts(x, new Float64Array(0), false, range[0], range[1], nbins, linspace(range[0], range[1], nbins + 1));
        let dot = 0;
        for (const c of counts) { const p = c / n; dot += p * p; }
        return (2 - (n + 1) * dot) / hh;
      };
      const upper = Math.max(100, Math.trunc(Math.sqrt(n)));
      let best = 1, bestV = jhat(1);
      for (let k = 2; k <= upper; k++) { const v = jhat(k); if (v < bestV) { best = k; bestV = v; } }
      if (best === upper) console.warn('RuntimeWarning: The number of bins estimated may be suboptimal.');
      return ptpX / best;
    }
    default: return assertNever(name);
  }
}

// ---------------------------------------------------------------- edges
/** np.linspace(start, stop, num) for float64. */
export function linspace(start        , stop        , num        )               {
  const div = num - 1, delta = stop - start;
  const y = Float64Array.from({ length: num }, (_, i) => i);
  if (div > 0) {
    const step = delta / div;
    if (step === 0) for (let i = 0; i < num; i++) y[i] = (y[i] / div) * delta;
    else for (let i = 0; i < num; i++) y[i] *= step;
  } else for (let i = 0; i < num; i++) y[i] *= delta;
  for (let i = 0; i < num; i++) y[i] += start;
  if (num > 1) y[num - 1] = stop;
  return y;
}

/** _get_outer_edges */
function outerEdges(a              , range       )                                    {
  let first        , last        ;
  if (range.kind === 'some') {
    [first, last] = range.value;
    if (first > last) return err('max must be larger than min in range parameter.');
    if (!(Number.isFinite(first) && Number.isFinite(last))) return err(`supplied range of [${first}, ${last}] is not finite`);
  } else if (a.length === 0) {
    first = 0; last = 1;
  } else {
    first = Infinity; last = -Infinity;
    let nan = false;
    for (const v of a) { if (Number.isNaN(v)) nan = true; else { if (v < first) first = v; if (v > last) last = v; } }
    if (nan) { first = NaN; last = NaN; }
    if (!(Number.isFinite(first) && Number.isFinite(last))) return err(`autodetected range of [${pyFloat(first)}, ${pyFloat(last)}] is not finite`);
  }
  if (first === last) { first -= 0.5; last += 0.5; }
  return ok([first, last]);
}
const pyFloat = (v        )         => (Number.isNaN(v) ? 'nan' : v === Infinity ? 'inf' : v === -Infinity ? '-inf' : String(v));

                                                                                                                                               
/** _get_bin_edges */
function binEdgesOf(s        , bins      , range       , weighted         )                {
  let nEqual        ;
  let outer                           ;
  switch (bins.kind) {
    case 'estimator': {
      if (weighted) return err('Automated estimation of the number of bins is not supported for weighted data');
      const oe = outerEdges(s.values, range);
      if (!oe.ok) return oe;
      outer = oe.value;
      const [first, last] = outer;
      const a = range.kind === 'some' ? s.values.filter((v) => v >= first && v <= last) : s.values;
      if (a.length === 0) nEqual = 1;
      else {
        let width = binWidth(bins.name, { values: a, integer: s.integer }, outer);
        if (width) {
          if (s.integer && width < 1) width = 1;
          nEqual = Math.trunc(Math.ceil((last - first) / width));
        } else nEqual = 1;
      }
      break;
    }
    case 'count': {
      if (!Number.isInteger(bins.n)) return err('`bins` must be an integer, a string, or an array');
      if (bins.n < 1) return err('`bins` must be positive, when an integer');
      nEqual = bins.n;
      const oe = outerEdges(s.values, range);
      if (!oe.ok) return oe;
      outer = oe.value;
      break;
    }
    case 'edges': {
      const e = bins.edges;
      for (let i = 1; i < e.length; i++) if (e[i - 1] > e[i]) return err('`bins` must increase monotonically, when an array');
      return ok({ edges: e, uniform: { kind: 'none' } });
    }
    default: return assertNever(bins);
  }
  const edges = linspace(outer[0], outer[1], nEqual + 1);
  for (let i = 1; i < edges.length; i++) if (!(edges[i - 1] < edges[i])) return err(`Too many bins for data range. Cannot create ${nEqual} finite-sized bins.`);
  return ok({ edges, uniform: { kind: 'some', value: { first: outer[0], last: outer[1], n: nEqual } } });
}

/** np.histogram_bin_edges(a, bins, range, weights) */
export function histogramBinEdges(s        , bins      , range       , weighted         )                       {
  const e = binEdgesOf(s, bins, range, weighted);
  return e.ok ? ok(e.value.edges) : e;
}

// ---------------------------------------------------------------- counts
/** The uniform-bin fast path: index by (a − first) / (last − first) · n, corrected against the edges. */
function uniformCounts(a              , w              , weighted         , first        , last        , n        , edges              )               {
  const out = new Float64Array(n);
  const denom = last - first;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (!(v >= first && v <= last)) continue;
    let idx = Math.trunc((v - first) / denom * n);
    if (idx === n) idx -= 1;
    if (v < edges[idx]) idx -= 1;
    if (v >= edges[idx + 1] && idx !== n - 1) idx += 1;
    out[idx] += weighted ? w[i] : 1;   // np.bincount: in input order
  }
  return out;
}
/** searchsorted on an np.sort-ed array (NaN last). */
function searchSorted(sa              , v        , side                  )         {
  let lo = 0, hi = sa.length;
  const before = (x        )          => (Number.isNaN(x) ? false : side === 'left' ? x < v : (Number.isNaN(v) ? true : x <= v));
  while (lo < hi) { const mid = (lo + hi) >> 1; if (before(sa[mid])) lo = mid + 1; else hi = mid; }
  return lo;
}
/** The general path: sorted data, cumulative counts (or weights) at each edge, then np.diff. */
function edgeCounts(a              , w              , weighted         , edges              )               {
  const idx = a.length === 0 ? [] : Array.from(a.keys()).toSorted((p, q) => {
    const x = a[p], y = a[q];
    return Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : Number.isNaN(y) ? -1 : x - y;
  });
  const sa = Float64Array.from(idx, (i) => a[i]);
  const cw = new Float64Array(sa.length + 1);
  for (let i = 0; i < idx.length; i++) cw[i + 1] = cw[i] + (weighted ? w[idx[i]] : 1);   // cumsum, sequential
  const at = (j        )         => cw[searchSorted(sa, edges[j], j === edges.length - 1 ? 'right' : 'left')];
  const out = new Float64Array(Math.max(0, edges.length - 1));
  for (let j = 0; j + 1 < edges.length; j++) out[j] = at(j + 1) - at(j);
  return out;
}

                                                                                        
/** np.histogram(a, bins, range, density, weights) */
export function histogram(s        , bins      , range       , density         , weights                      )                    {
  const a = s.values;
  if (weights.kind === 'some' && weights.value.length !== a.length) return err('weights should have the same shape as a.');
  const weighted = weights.kind === 'some';
  const w = weights.kind === 'some' ? weights.value : new Float64Array(0);
  const be = binEdgesOf(s, bins, range, weighted);
  if (!be.ok) return be;
  const { edges, uniform } = be.value;
  const n = uniform.kind === 'some'
    ? uniformCounts(a, w, weighted, uniform.value.first, uniform.value.last, uniform.value.n, edges)
    : edgeCounts(a, w, weighted, edges);
  if (!density) return ok({ counts: n, edges });
  // n / db / n.sum(); integer counts sum exactly, weights pairwise
  const total = npSum(n);
  return ok({ counts: n.map((c, i) => c / (edges[i + 1] - edges[i]) / total), edges });
}

// ---------------------------------------------------------------- Axes.hist's counting
                         
                                                                                                           
                                                       
                                                   
                                                                  
                                                                                       
  
const pyMin = (a        , b        )         => (b < a ? b : a);   // builtins.min keeps a when b is nan
const pyMax = (a        , b        )         => (b > a ? b : a);
const nanReduce = (a              , f                                  )         => {
  let out = NaN;
  for (const v of a) if (!Number.isNaN(v)) out = Number.isNaN(out) ? v : f(out, v);
  return out;
};
const cumsum = (a              )               => { const o = new Float64Array(a.length); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; o[i] = s; } return o; };

/** The counting half of Axes.hist: bin edges over all datasets, per-dataset np.histogram, stacking, density and cumulative sums. */
export function histTops(h           )                                                                                   {
  const nx = h.data.length;
  let range        = h.range;
  if (range.kind === 'none') {
    let lo = Infinity, hi = -Infinity;
    for (const d of h.data) if (d.values.length > 0) { lo = pyMin(lo, nanReduce(d.values, Math.min)); hi = pyMax(hi, nanReduce(d.values, Math.max)); }
    if (lo <= hi) range = { kind: 'some', value: [lo, hi] };
  }
  let bins       = h.bins;
  let histRange        = range;
  if (!h.inputEmpty && nx > 1) {
    const total = h.data.reduce((s, d) => s + d.values.length, 0);
    const cat = new Float64Array(total);
    let off = 0;
    for (const d of h.data) { cat.set(d.values, off); off += d.values.length; }
    const e = histogramBinEdges({ values: cat, integer: h.data.every((d) => d.integer) }, bins, range, h.weights.kind === 'some');
    if (!e.ok) return e;
    bins = { kind: 'edges', edges: e.value };
    histRange = { kind: 'none' };
  }
  const tops                 = [];
  let edges               = new Float64Array(0);
  for (let i = 0; i < nx; i++) {
    const r = histogram(h.data[i], bins, histRange, h.density && !h.stacked, h.weights.kind === 'some' ? { kind: 'some', value: h.weights.value[i] } : { kind: 'none' });
    if (!r.ok) return r;
    tops.push(Float64Array.from(r.value.counts));
    edges = r.value.edges;
    bins = { kind: 'edges', edges };   // np.histogram returns the edges, and later datasets reuse them
  }
  const diff = edges.slice(1).map((e, i) => e - edges[i]);
  let out                 = tops;
  if (h.stacked) {
    out = [];
    tops.forEach((t, k) => out.push(k === 0 ? Float64Array.from(t) : t.map((v, i) => out[k - 1][i] + v)));
    if (h.density && out.length > 0) {
      const s = npSum(out[out.length - 1]);
      out = out.map((t) => t.map((v, i) => v / diff[i] / s));
    }
  }
  if (h.cumulative !== 0) {
    const rev = h.cumulative < 0;
    out = out.map((t0) => {
      const t = h.density ? t0.map((v, i) => v * diff[i]) : t0;
      return rev ? cumsum(t.toReversed()).toReversed() : cumsum(t);
    });
  }
  return ok({ tops: out, edges });
}
