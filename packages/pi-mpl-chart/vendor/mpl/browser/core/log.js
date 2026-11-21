// Port of matplotlib.ticker LogLocator / LogFormatterSciNotation (3.11.2, non-classic).
import { autoTicks, pow10 } from './ticker.js';
                                                    
import { assertNever, none, some } from './types.js';

const logB = (b        , x        )         => (b === 10 ? Math.log10(x) : b === 2 ? Math.log2(x) : Math.log(x) / Math.log(b));
const powB = (b        , e        )         => (b === 10 && Number.isInteger(e) ? pow10(e) : Math.pow(b, e));
/** Python's floor-mod for ints: (-emin) % stride. */
const pyMod = (a        , n        )         => ((a % n) + n) % n;
/** Python round(): half to even. */
export const pyRound = (x        )         => { const r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
/** math.isclose(a, b) with default rel_tol=1e-9, abs_tol=0. */
const isClose = (a        , b        )          => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
const isCloseToInt = (x        )          => isClose(x, pyRound(x));
/** math.nextafter(x, -inf) */
function nextDown(x        )         {
  if (Number.isNaN(x) || x === -Infinity) return x;
  if (x === 0) return -Number.MIN_VALUE;
  const f = new Float64Array([x]), u = new BigInt64Array(f.buffer);
  u[0] += x > 0 ? -1n : 1n;
  return f[0];
}

// _decade_less_equal / _decade_greater_equal / _decade_less / _decade_greater (x > 0 here)
const decadeLE = (x        , b        )         => (x === 0 ? x : powB(b, Math.floor(Math.log(x) / Math.log(b))));
const decadeGE = (x        , b        )         => (x === 0 ? x : powB(b, Math.ceil(Math.log(x) / Math.log(b))));
const decadeLess = (x        , b        )         => { const l = decadeLE(x, b); return l === x ? l / b : l; };
const decadeGreater = (x        , b        )         => { const g = decadeGE(x, b); return g === x ? g * b : g; };

/** LogLocator.nonsingular; minpos = smallest positive data value on the axis (Infinity if none). */
export function logNonsingular(v0        , v1        , base        , minpos        )                            {
  let vmin = Math.min(v0, v1), vmax = Math.max(v0, v1);
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return [1, 10];
  if (vmax <= 0) return [1, 10];
  const mp = Number.isFinite(minpos) ? minpos : 1e-300;
  if (vmin <= 0) vmin = mp;
  if (vmin === vmax) { vmin = decadeLess(vmin, base); vmax = decadeGreater(vmax, base); }
  return [vmin, vmax];
}

                                                                                  

/** LogLocator.tick_values with numticks='auto' (n_request = clip(tick_space, 2, 9)). */
export function logTicks(vminIn        , vmaxIn        , base        , subs         , tickSpace        , minpos        )           {
  const b = base;
  let vmin = vminIn, vmax = vmaxIn;
  if (vmin <= 0) vmin = minpos;
  if (!(vmin > 0) || !Number.isFinite(vmin)) throw new Error('Data cannot be log-scaled because all values are <= 0.');
  if (vmax < vmin) [vmin, vmax] = [vmax, vmin];
  let nRequest = Math.min(Math.max(tickSpace, 2), 9);
  const efmin = logB(b, vmin), efmax = logB(b, vmax);
  const emin = Math.ceil(efmin), emax = Math.floor(efmax);
  const nAvail = emax - emin + 1;

  let subsArr                   ;
  if (subs.kind === 'minorAuto') {
    if (nAvail >= 10 || b < 3) return [];
    subsArr = Array.from({ length: Math.ceil(b) - 2 }, (_, i) => i + 2);   // np.arange(2.0, b)
  } else subsArr = [1];

  let stride = Math.floor(nAvail / (nRequest + 1)) + 1;
  const nr = Math.ceil(nAvail / stride);
  if (nr <= nRequest) nRequest = nr;
  let decades          ;
  if (nRequest === 0) {
    decades = [emin - 1, emax + 1];
    stride = decades[1] - decades[0];
  } else if (nRequest === 1) {
    const mid = pyRound((efmin + efmax) / 2);
    stride = Math.max(mid - (emin - 1), (emax + 1) - mid);
    decades = [mid - stride, mid, mid + stride];
  } else {
    stride = Math.floor((nAvail - 1) / (nRequest - 1));
    if (stride < nAvail / nRequest) stride = Math.floor(nAvail / nRequest);
    const olo = Math.max(nAvail - stride * nRequest, 0);
    const ohi = Math.min(nAvail - stride * (nRequest - 1), stride);
    let offset = pyMod(-emin, stride);
    if (!(olo <= offset && offset < ohi)) offset = olo;
    decades = [];
    for (let d = emin + offset - stride; d < emax + stride + 1; d += stride) decades.push(d);
  }

  const isMinor = subsArr.length > 1 || (subsArr.length === 1 && subsArr[0] !== 1);
  let locs          ;
  if (isMinor) {
    locs = [];
    if (stride === 1 || nAvail <= 1) for (let d = emin - 1; d < emax + 1; d++) for (const s of subsArr) locs.push(s * powB(b, d));
  } else locs = decades.map((d) => powB(b, d));

  if (subsArr.length > 1 && stride === 1 && decades.length - 2 + locs.filter((t) => vmin <= t && t <= vmax).length <= 1) {
    return autoTicks(vmin, vmax, 9);   // a fresh AutoLocator() has no axis, so nbins = 9
  }
  return locs;
}

// LogFormatter.set_locs: which coefficients get labels (minor_thresholds = (1, 0.4))
function sublabels(view                           , b        )                              {
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  if (vmin <= 0) return some(new Set([1]));
  const lmin = Math.log(vmin) / Math.log(b), lmax = Math.log(vmax) / Math.log(b);
  const numticks = Math.floor(lmax) - Math.floor(nextDown(lmin));
  const numdec = Math.abs(lmax - lmin);
  if (numticks > 1) return some(new Set([1]));
  if (numdec > 0.4) {
    const n = Math.floor(Math.floor(b) / 2) + 1;            // np.round(np.geomspace(1, b, int(b)//2 + 1))
    return some(new Set(Array.from({ length: n }, (_, i) => pyRound(Math.pow(b, i / (n - 1))))));
  }
  return some(new Set(Array.from({ length: Math.floor(b) }, (_, i) => i + 1)));
}

/** '%g' (6 significant digits, trailing zeros stripped). */
export function pyG(x        )         {
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  const s = e < -4 || e >= 6 ? x.toExponential(5) : x.toPrecision(6);
  const at = s.indexOf('e');
  const m = at >= 0 ? s.slice(0, at) : s;
  const mant = m.includes('.') ? m.replace(/\.?0+$/, '') : m;
  if (at < 0) return mant;
  const en = Number(s.slice(at + 1));
  return `${mant}e${en < 0 ? '-' : '+'}${String(Math.abs(en)).padStart(2, '0')}`;
}

/** LogFormatterSciNotation.__call__ for each loc (labelOnlyBase = False). */
export function logFormat(locs                   , view                           , base        )                       {
  const subl = sublabels(view, base);
  const baseStr = base % 1 === 0 ? String(base) : String(base);
  return locs.map((x0)            => {
    if (x0 === 0) return { kind: 'plain', text: '0' };
    const x = Math.abs(x0);
    const fx = Math.log(x) / Math.log(base);
    const decade = isCloseToInt(fx);
    const exponent = decade ? pyRound(fx) : Math.floor(fx);
    const coeff = pyRound(Math.pow(base, fx - exponent));
    if (subl.kind === 'some' && !subl.value.has(coeff)) return { kind: 'plain', text: '' };
    if (decade) return { kind: 'power', coeff: none, base: baseStr, exponent: pyRound(fx) };
    const e = Math.floor(fx);
    const c = Math.pow(base, fx - e);
    return { kind: 'power', coeff: some(pyG(isCloseToInt(c) ? pyRound(c) : c)), base: baseStr, exponent: e };
  });
}

/** The exact string matplotlib produces for a tick label (for metadata and tests). */
export function tickLabelText(l           )         {
  switch (l.kind) {
    case 'plain': return l.text;
    case 'power': return `$\\mathdefault{${l.coeff.kind === 'some' ? `${l.coeff.value}\\times` : ''}${l.base}^{${l.exponent}}}$`;
    default: return assertNever(l);
  }
}
