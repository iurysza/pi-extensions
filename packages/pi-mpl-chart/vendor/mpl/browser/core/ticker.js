// Line-for-line port of matplotlib/ticker.py (3.11.2) MaxNLocator / AutoLocator /
// ScalarFormatter and transforms._nonsingular, made pure: no axis back-pointer,
// no mutable formatter state. Comments cite the Python.

const FLOAT_TINY = 2.2250738585072014e-308; // np.finfo(float).tiny
const MINUS = '−';

// ---------------------------------------------------------------- Python numeric semantics
// CPython float_divmod (Objects/floatobject.c): the quotient comes from fmod, not
// floor(a / b); they differ in the last ulp (16.0 // 0.01 == 1599.0 in Python).
export function pyDivmod(a        , b        )                            {
  let mod = a % b;                 // JS % is fmod
  let div = (a - mod) / b;
  if (mod !== 0) {
    if ((b < 0) !== (mod < 0)) { mod += b; div -= 1.0; }
  } else {
    mod = (b < 0 || Object.is(b, -0)) ? -0 : 0;
  }
  let floordiv        ;
  if (div !== 0) {
    floordiv = Math.floor(div);
    if (div - floordiv > 0.5) floordiv += 1.0;
  } else {
    floordiv = (a / b < 0 || Object.is(a / b, -0)) ? -0 : 0;
  }
  return [floordiv, mod];
}
export const pyFloorDiv = (a        , b        )         => pyDivmod(a, b)[0];
// V8's 10 ** n is not correctly rounded for negative integer n (10 ** -17 === 9.999999999999999e-18);
// C pow() — hence Python — is. A decimal literal parses with correct rounding.
export const pow10 = (n        )         => (Number.isInteger(n) ? Number(`1e${n}`) : Math.pow(10, n));
// np.round(x, d): scale, round half to even, unscale.
const rint = (v        )         => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };
const npRound = (v        , d        )         => { const f = pow10(d); return rint(v * f) / f; };
const copysign = (x        , y        )         => ((y < 0 || Object.is(y, -0)) ? -Math.abs(x) : Math.abs(x));

// ---------------------------------------------------------------- transforms._nonsingular
export function nonsingular(vmin        , vmax        , expander        , tiny        , increasing         )                            {
  if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return [-expander, expander];
  let lo = vmin, hi = vmax, swapped = false;
  if (hi < lo) { [lo, hi] = [hi, lo]; swapped = true; }
  const maxabs = Math.max(Math.abs(lo), Math.abs(hi));
  if (maxabs < (1e6 / tiny) * FLOAT_TINY) {
    lo = -expander; hi = expander;
  } else if (hi - lo <= maxabs * tiny) {
    if (hi === 0 && lo === 0) { lo = -expander; hi = expander; }
    else { lo -= expander * Math.abs(lo); hi += expander * Math.abs(hi); }
  }
  return swapped && !increasing ? [hi, lo] : [lo, hi];
}

// ticker.scale_range
export function scaleRange(vmin        , vmax        , n        , threshold        )                            {
  const dv = Math.abs(vmax - vmin);
  const meanv = (vmax + vmin) / 2;
  const offset = Math.abs(meanv) / dv < threshold ? 0 : copysign(pow10(pyFloorDiv(Math.log10(Math.abs(meanv)), 1)), meanv);
  return [pow10(pyFloorDiv(Math.log10(dv / n), 1)), offset];
}

// ticker._Edge_integer
function edgeTol(step        , offset        )         {
  const off = Math.abs(offset);
  if (off > 0) return Math.min(0.4999, Math.max(1e-10, pow10(Math.log10(off / step) - 12)));
  return 1e-10;
}
const edgeLe = (step        , offset        , x        )         => { const [d, m] = pyDivmod(x, step); return Math.abs(m / step - 1) < edgeTol(step, offset) ? d + 1 : d; };
const edgeGe = (step        , offset        , x        )         => { const [d, m] = pyDivmod(x, step); return Math.abs(m / step) < edgeTol(step, offset) ? d : d + 1; };

// ---------------------------------------------------------------- MaxNLocator
                                                                                               
                                                        
                          
                                                                                      
                                                                                 
  

/** _validate_steps + _staircase */
function extendedSteps(steps                   )                    {
  const s = [...(steps[0] === 1 ? [] : [1]), ...steps, ...(steps[steps.length - 1] === 10 ? [] : [10])];
  return [...s.slice(0, -1).map((v) => 0.1 * v), ...s, 10 * s[1]];
}

// ticker.AutoLocator (non-classic mode)
export const AUTO_LOCATOR             = { nbins: { kind: 'auto' }, steps: [1, 2, 2.5, 5, 10], integer: false, symmetric: false, prune: 'none', minNTicks: 2 };

function rawTicks(p            , vmin        , vmax        , tickSpace        )           {
  const minN = Math.max(1, p.minNTicks);
  const nbins = p.nbins.kind === 'auto' ? Math.min(Math.max(tickSpace, Math.max(1, minN - 1)), 9) : p.nbins.n;
  const [scale, offset] = scaleRange(vmin, vmax, nbins, 100);
  const lo = vmin - offset, hi = vmax - offset;
  let steps = extendedSteps(p.steps).map((s) => s * scale);
  if (p.integer) steps = steps.filter((s) => s < 1 || Math.abs(s - Math.round(s)) < 0.001);
  const rawStep = (hi - lo) / nbins;
  let istep = steps.findIndex((s) => s >= rawStep);       // autolimit_mode == 'data'
  if (istep === -1) istep = steps.length - 1;
  let ticks           = [];
  for (const s0 of steps.slice(0, istep + 1).toReversed()) {
    const step = p.integer && Math.floor(hi) - Math.ceil(lo) >= minN - 1 ? Math.max(1, s0) : s0;
    const best = pyFloorDiv(lo, step) * step;
    const low = edgeLe(step, offset, lo - best), high = edgeGe(step, offset, hi - best);
    ticks = [];
    for (let i = low; i <= high; i++) ticks.push(i * step + best);
    if (ticks.filter((t) => t <= hi && t >= lo).length >= minN) break;
  }
  return ticks.map((t) => t + offset);
}

export function maxNTickValues(p            , vmin        , vmax        , tickSpace        )           {
  const sym = p.symmetric ? Math.max(Math.abs(vmin), Math.abs(vmax)) : 0;
  const [lo, hi] = nonsingular(p.symmetric ? -sym : vmin, p.symmetric ? sym : vmax, 1e-13, 1e-14, true);
  const locs = rawTicks(p, lo, hi, tickSpace);
  switch (p.prune) {
    case 'none': return locs;
    case 'lower': return locs.slice(1);
    case 'upper': return locs.slice(0, -1);
    case 'both': return locs.slice(1, -1);
  }
}

export const autoTicks = (vmin        , vmax        , tickSpace        )           => maxNTickValues(AUTO_LOCATOR, vmin, vmax, tickSpace);

// ---------------------------------------------------------------- ScalarFormatter
                             
                                                                
                                                                                  
  
                                                                                           

// ScalarFormatter._compute_offset
function computeOffset(visible                   , threshold        )         {
  if (visible.length === 0) return 0;
  let lmin = Infinity, lmax = -Infinity;
  for (const l of visible) { if (l < lmin) lmin = l; if (l > lmax) lmax = l; }
  if (lmin === lmax || (lmin <= 0 && 0 <= lmax)) return 0;
  const absMin = Math.min(Math.abs(lmin), Math.abs(lmax)), absMax = Math.max(Math.abs(lmin), Math.abs(lmax));
  const sign = copysign(1, lmin);
  const oomMax = Math.ceil(Math.log10(absMax));
  let o = oomMax;
  while (pyFloorDiv(absMin, pow10(o)) === pyFloorDiv(absMax, pow10(o))) o -= 1;
  let oom = 1 + o;
  if ((absMax - absMin) / pow10(oom) <= 1e-2) {
    let o2 = oomMax;
    while (!(pyFloorDiv(absMax, pow10(o2)) - pyFloorDiv(absMin, pow10(o2)) > 1)) o2 -= 1;
    oom = 1 + o2;
  }
  return pyFloorDiv(absMax, pow10(oom)) >= pow10(threshold - 1) ? sign * pyFloorDiv(absMax, pow10(oom)) * pow10(oom) : 0;
}

// ScalarFormatter._set_order_of_magnitude (scientific = True)
function orderOfMagnitude(visible                   , offset        , vmin        , vmax        , limits                           )         {
  if (limits[0] === limits[1] && limits[0] !== 0) return limits[0];
  if (visible.length === 0) return 0;
  let oom        ;
  if (offset !== 0) oom = Math.floor(Math.log10(vmax - vmin));
  else { const val = Math.max(...visible.map(Math.abs)); oom = val === 0 ? 0 : Math.floor(Math.log10(val)); }
  return oom <= limits[0] || oom >= limits[1] ? oom : 0;
}

// ScalarFormatter._set_format -> number of decimals in '%1.Nf'
function formatDigits(locs                   , view                           , offset        , oom        )         {
  const all = locs.length < 2 ? [...locs, view[0], view[1]] : locs;
  const scaled = all.map((l) => (l - offset) / pow10(oom));
  let range = Math.max(...scaled) - Math.min(...scaled);
  if (range === 0) range = Math.max(...scaled.map(Math.abs));
  if (range === 0) range = 1;
  const xs = locs.length < 2 ? scaled.slice(0, -2) : scaled;
  const rangeOom = Math.floor(Math.log10(range));
  let sigfigs = Math.max(0, 3 - rangeOom);
  const thresh = 1e-3 * pow10(rangeOom);
  while (sigfigs >= 0) {
    const maxdiff = xs.length > 0 ? Math.max(...xs.map((l) => Math.abs(l - npRound(l, sigfigs)))) : 0;
    if (maxdiff < thresh) sigfigs -= 1; else break;
  }
  return sigfigs + 1;
}

// ScalarFormatter.format_data: "%d" if integral else "%1.10g" (offset is np.float64 -> np.round)
function formatData(value        , fix                       )         {
  const e = Math.floor(Math.log10(Math.abs(value)));
  const s = npRound(value / pow10(e), 10);
  const significand = fix(s % 1 === 0 ? String(Math.trunc(s)) : s.toPrecision(10).replace(/\.?0+$/, ''));
  return e === 0 ? significand : `${significand}e${fix(String(e))}`;
}

/** ScalarFormatter.set_locs + __call__ + get_offset, as one pure function. */
export function scalarFormat(locs                   , view                           , o               )               {
  if (locs.length === 0) return { labels: [], offset: '' };
  const fix = o.unicodeMinus ? (s        )         => s.replace(/-/g, MINUS) : (s        )         => s;
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  const visible = locs.filter((l) => vmin <= l && l <= vmax);
  const offset = o.useOffset ? computeOffset(visible, o.offsetThreshold) : 0;
  const oom = orderOfMagnitude(visible, offset, vmin, vmax, o.powerlimits);
  const digits = formatDigits(locs, view, offset, oom);
  const labels = locs.map((x) => {
    const xp = (x - offset) / pow10(oom);
    return fix((Math.abs(xp) < 1e-8 ? 0 : xp).toFixed(digits));
  });
  let text = '';
  if (oom !== 0 || offset !== 0) {
    const off = offset !== 0 ? `${offset > 0 ? '+' : ''}${formatData(offset, fix)}` : '';
    text = fix(`${oom !== 0 ? `1e${oom}` : ''}${off}`);
  }
  return { labels, offset: text };
}
