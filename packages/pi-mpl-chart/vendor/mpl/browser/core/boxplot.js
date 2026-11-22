// matplotlib.cbook.boxplot_stats (matplotlib 3.11) + numpy.percentile method='linear'.
// Quartiles, whiskers, notches (Gaussian asymptotic CI; bootstrap is refused at the Axes API),
// fliers. Empty or all-NaN samples match matplotlib: every stat is NaN and fliers is empty.

                                                 
import { err, none, ok } from './types.js';

/** Whisker rule: Tukey's IQR multiple, or an explicit (lo, hi) percentile pair. */
                  
                                                   
                                                                               

/** One column's boxplot statistics, as cbook.boxplot_stats returns. */
                            
                        
                       
                      
                      
                       
                        
                        
                          
                          
                                
                                 
  

const nanStats = (label                )               => ({
  mean: NaN, med: NaN, q1: NaN, q3: NaN, iqr: NaN,
  cilo: NaN, cihi: NaN, whislo: NaN, whishi: NaN,
  fliers: new Float64Array(0), label,
});

/** numpy._lerp: a + (b-a)*t, but when t≥0.5 uses b − (b-a)*(1−t) for the last ULP. */
function lerp(a        , b        , t        )         {
  const d = b - a;
  return t >= 0.5 ? b - d * (1 - t) : a + d * t;
}

/** numpy.percentile(a, q, method='linear') for a finite sorted sample (q in [0, 100]). */
export function percentileLinear(sorted              , q        )         {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const p = q / 100;
  const i = p * (n - 1);
  const lo = Math.floor(i), hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return lerp(sorted[lo], sorted[hi], i - lo);
}

/** numpy.mean for float64: Neumaier compensated sum (matches numpy 2.x on these lengths). NaN if any is NaN. */
function meanOf(xs              )         {
  const n = xs.length;
  if (n === 0) return NaN;
  let sum = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i];
    if (Number.isNaN(x)) return NaN;
    const t = sum + x;
    c += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
    sum = t;
  }
  return (sum + c) / n;
}

/** True when any element is NaN (numpy.percentile then returns NaN). */
function anyNaN(xs              )          {
  for (let i = 0; i < xs.length; i++) if (Number.isNaN(xs[i])) return true;
  return false;
}

/** Parse whis: a float, or a length-2 percentile pair. */
export function parseWhis(v         )               {
  if (typeof v === 'number' && Number.isFinite(v)) return ok({ kind: 'iqr', coef: v });
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
    && Number.isFinite(v[0]) && Number.isFinite(v[1])) {
    return ok({ kind: 'percentiles', lo: v[0], hi: v[1] });
  }
  return err('whis must be a float or list of percentiles');
}

/**
 * cbook.boxplot_stats for one already-reshaped sample (1-D values).
 * Matches matplotlib when bootstrap is None (Gaussian notch).
 */
export function boxplotStatsOne(
  values              ,
  whis      ,
  autorange         ,
  label                ,
)               {
  if (values.length === 0) return nanStats(label);
  // matplotlib: np.ma.asarray then ravel; NaNs stay and poison percentile/mean
  if (anyNaN(values)) return nanStats(label);

  const sorted = Float64Array.from(values);
  sorted.sort((a, b) => a - b);

  const q1 = percentileLinear(sorted, 25);
  const med = percentileLinear(sorted, 50);
  const q3 = percentileLinear(sorted, 75);
  const iqr = q3 - q1;
  let rule = whis;
  if (iqr === 0 && autorange) rule = { kind: 'percentiles', lo: 0, hi: 100 };

  const n = sorted.length;
  const cilo = med - 1.57 * iqr / Math.sqrt(n);
  const cihi = med + 1.57 * iqr / Math.sqrt(n);

  let loval        , hival        ;
  switch (rule.kind) {
    case 'percentiles':
      loval = percentileLinear(sorted, rule.lo);
      hival = percentileLinear(sorted, rule.hi);
      break;
    case 'iqr':
      loval = q1 - rule.coef * iqr;
      hival = q3 + rule.coef * iqr;
      break;
  }

  // highest datum ≤ hival (else q3); lowest datum ≥ loval (else q1)
  let whishi = q3, whislo = q1, hasHi = false, hasLo = false;
  for (let i = 0; i < n; i++) {
    const x = sorted[i];
    if (x <= hival) { whishi = x; hasHi = true; }
    if (x >= loval && !hasLo) { whislo = x; hasLo = true; }
  }
  if (!hasHi || whishi < q3) whishi = q3;
  if (!hasLo || whislo > q1) whislo = q1;

  // matplotlib concatenates x[x < whislo] then x[x > whishi] in original order
  const fliers           = [];
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (x < whislo) fliers.push(x);
  }
  for (let i = 0; i < values.length; i++) {
    const x = values[i];
    if (x > whishi) fliers.push(x);
  }

  return {
    mean: meanOf(values), med, q1, q3, iqr, cilo, cihi, whislo, whishi,
    fliers: Float64Array.from(fliers), label,
  };
}

/**
 * Reshape X the way cbook._reshape_2D does for lists: a list of arrays is several datasets;
 * a flat numeric array is one. 2-D typed arrays are not accepted (JS has no ndarray columns).
 */
export function reshapeBoxplotData(x         )                                  {
  if (typeof x === 'number') return err("object of type 'float' has no len()");
  if (x instanceof Float64Array) return ok([x]);
  if (x instanceof Float32Array || x instanceof Int8Array || x instanceof Uint8Array || x instanceof Uint8ClampedArray
    || x instanceof Int16Array || x instanceof Uint16Array || x instanceof Int32Array || x instanceof Uint32Array) {
    return ok([Float64Array.from(x)]);
  }
  if (!Array.isArray(x)) return err('x must be an array');
  if (x.length === 0) return ok([new Float64Array(0)]);
  const multi = x.every((el) => Array.isArray(el) || ArrayBuffer.isView(el));
  if (multi) {
    const out                 = [];
    for (let i = 0; i < x.length; i++) {
      const el = x[i];
      if (el instanceof Float64Array) { out.push(el); continue; }
      if (el instanceof Float32Array || el instanceof Int8Array || el instanceof Uint8Array || el instanceof Uint8ClampedArray
        || el instanceof Int16Array || el instanceof Uint16Array || el instanceof Int32Array || el instanceof Uint32Array) {
        out.push(Float64Array.from(el)); continue;
      }
      if (Array.isArray(el)) {
        if (!el.every((v) => typeof v === 'number')) return err(`x[${i}] must be numeric`);
        out.push(Float64Array.from(el)); continue;
      }
      return err(`x[${i}] must be an array`);
    }
    return ok(out);
  }
  if (!x.every((v) => typeof v === 'number')) return err('x must be numeric');
  return ok([Float64Array.from(x)]);
}

/** boxplot_stats(X, whis, labels, autorange) with bootstrap off. */
export function boxplotStats(
  datasets                         ,
  whis      ,
  labels                                   ,
  autorange         ,
)                                  {
  if (labels.kind === 'some' && labels.value.length !== datasets.length) {
    return err(`The number of labels (${labels.value.length}) must match the number of columns (${datasets.length}).`);
  }
  return ok(datasets.map((d, i) => {
    const lbl                 = labels.kind === 'some' ? labels.value[i] : none;
    return boxplotStatsOne(d, whis, autorange, lbl);
  }));
}
