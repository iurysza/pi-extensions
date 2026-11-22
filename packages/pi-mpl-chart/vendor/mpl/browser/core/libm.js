// Correctly rounded log10 and exp, for the log scale transforms.
//
// LogTransform calls np.log10, and InvertedLogTransform calls np.exp(v * np.log(base)). Here
// numpy uses x86 SIMD kernels. Against a 60-digit reference, numpy's log10 is correctly rounded
// for 99.6% of 500k random inputs and its exp for about 95%. V8's fdlibm Math.log10 and Math.exp
// match numpy on only about 94% and 89%.
// One ulp matters. Math.log10(exp(10·47/59)) is 3.459634008381837, while numpy gives
// 3.4596340083818364. That moved a vertex on a straight run of fixture log_y_exp by 6e-14 px.
// Agg's stroker then joined the segments differently there, and AA coverage changed by ±1.
// Math.exp(−0.2000…07 · ln10) put loglog's x limit 1 ulp off, which shifted every vertex.
// A correctly rounded result is the closest portable match to numpy. Matching it bit for bit
// would mean porting numpy's AVX-512 kernels, including their FMA rounding.
// The method: ln(m·2^e) = e·ln2 + 2·atanh((m−1)/(m+1)), and e^r is a Taylor series after an
// ln2 range reduction. Both use double-double (about 100 bits) and round once.
// The double-double operations return through a two-slot Float64Array (R[0] high, R[1] low) instead of
// tuples (a module-level `let` would box every write as a heap number). Each is the same sequence of IEEE
// operations as the tuple form it replaces, so the series below is bit-identical to it;
// test/libm-equiv.test.ts checks that, and the log10 fast path, against the tuple form. (Calls V8 does not
// inline still box their double arguments; the series now runs only for exp, the log10 table, and the fast
// path's rare fallbacks.)

/** The result of the last double-double operation: R[0] + R[1], with R[0] = fl(R[0] + R[1]). */
const R = new Float64Array(2);

/** twoSum: R[0] + R[1] = a + b exactly. */
function twoSum(a        , b        )       {
  const s = a + b, bb = s - a;
  R[1] = (a - (s - bb)) + (b - bb); R[0] = s;
}
const SPLIT = 134217729;  // 2^27 + 1, Veltkamp
/** twoProd: R[0] + R[1] = a · b exactly (Dekker). */
function twoProd(a        , b        )       {
  const p = a * b;
  const ca = SPLIT * a, ah = ca - (ca - a), al = a - ah;
  const cb = SPLIT * b, bh = cb - (cb - b), bl = b - bh;
  R[1] = ((ah * bh - p) + ah * bl + al * bh) + al * bl; R[0] = p;
}
/** (a0, a1) + (b0, b1) */
function add(a0        , a1        , b0        , b1        )       {
  twoSum(a0, b0);
  twoSum(R[0], R[1] + a1 + b1);
}
/** (a0, a1) · (b0, b1) */
function mul(a0        , a1        , b0        , b1        )       {
  twoProd(a0, b0);
  twoSum(R[0], R[1] + a0 * b1 + a1 * b0);
}
/** (a0, a1) / (b0, b1): one Newton correction of the double quotient. */
function div(a0        , a1        , b0        , b1        )       {
  const q = a0 / b0;
  mul(-q, 0, b0, b1);
  add(a0, a1, R[0], R[1]);
  twoSum(q, R[0] / b0);
}

const LN2_HI = 0.6931471805599453, LN2_LO = 2.3190468138462996e-17;
const LN10_HI = 2.302585092994046, LN10_LO = -2.1707562233822494e-16;

/** ln x as a double-double in (R[0], R[1]), x finite and > 0. */
function lnDD(x        )       {
  // x = m · 2^e with m in [√½, √2): scale subnormals up first
  let v = x, e = 0;
  if (v < 2.2250738585072014e-308) { v *= 2 ** 54; e -= 54; }
  // just below DBL_MAX log2 rounds up to 1024, and 2^1024 overflows: cap k (m then lands in [1, 2))
  const k = Math.min(1023, Math.floor(Math.log2(v)));
  let m = v / 2 ** k; e += k;   // exact: power-of-two scaling
  if (m > Math.SQRT2) { m /= 2; e += 1; }
  // s = (m − 1)/(m + 1); m − 1 is exact (Sterbenz), m + 1 is carried as a double-double
  twoSum(m, 1);
  div(m - 1, 0, R[0], R[1]);
  const s0 = R[0], s1 = R[1];
  mul(s0, s1, s0, s1);
  const q0 = R[0], q1 = R[1];   // s²
  // atanh(s) = s · Σ s^(2i) / (2i + 1); |s| < 0.172, so 24 terms reach 2^-120
  let t0 = 1, t1 = 0, sum0 = 0, sum1 = 0;
  for (let i = 0; i < 24; i++) {
    div(t0, t1, 2 * i + 1, 0);
    add(sum0, sum1, R[0], R[1]); sum0 = R[0]; sum1 = R[1];
    mul(t0, t1, q0, q1); t0 = R[0]; t1 = R[1];
  }
  mul(2 * s0, 2 * s1, sum0, sum1);
  const l0 = R[0], l1 = R[1];
  mul(e, 0, LN2_HI, LN2_LO);
  add(R[0], R[1], l0, l1);
}

// ---------------------------------------------------------------- log10 fast path (Ziv)
// log10 first evaluates a table-driven double-double approximation y = yh + yl with relative error below
// 2^-80, then returns fl(y) only when that is provably the correctly rounded result: when every value within
// ZIV·|yh| of y (ZIV = 2^-63, a wide margin) rounds to the same double. Then the true log10 rounds there,
// and so does the series (accurate to ~2^-100), so the fast path returns exactly what the series would.
// Otherwise (about 0.1% of inputs) it falls back to the series. The fast path is written out without calls:
// V8 does not inline a chain of double-double helpers this deep, and every non-inlined call boxes its
// double arguments.
//
// Reduction: m = (1 + r)/INV[j] with j = round(128·(m − 1)) and INV[j] = fl(1/(1 + j/128)). Dekker's product
// m·INV[j] = p + pe is exact, and p − 1 is exact (Sterbenz), so r is exact as a double-double, |r| < 2^-7.4.
// ln m = T[j] + ln(1 + r) with T[j] = −ln INV[j] (from the series, built on first use), and
// ln(1 + r) = r − r²/2 + r³/3 + r⁴·Q(r): r² and r³/3 in double-double, Q in double, truncated after r^11
// (truncation < 2^-82·|r|; the double tail's rounding < 2^-85·|r|).
const J_MIN = -38, J_MAX = 54;
const INV = new Float64Array(J_MAX - J_MIN + 1), INV_H = new Float64Array(INV.length), INV_L = new Float64Array(INV.length);
const T_HI = new Float64Array(INV.length), T_LO = new Float64Array(INV.length);
let tableReady = false;
function buildTable()       {
  for (let j = J_MIN; j <= J_MAX; j++) {
    const i = j - J_MIN, inv = 1 / (1 + j / 128), c = SPLIT * inv;
    INV[i] = inv; INV_H[i] = c - (c - inv); INV_L[i] = inv - INV_H[i];
    if (j === 0) continue;
    lnDD(inv);
    T_HI[i] = -R[0]; T_LO[i] = -R[1];
  }
  tableReady = true;
}
const THIRD_HI = 0.3333333333333333, THIRD_LO = 1.850371707708594e-17;   // 1/3 = HI + LO to 2^-108
const splitHi = (a        )         => { const c = SPLIT * a; return c - (c - a); };
const THIRD_H = splitHi(THIRD_HI), THIRD_L = THIRD_HI - THIRD_H;
const LN2_H = splitHi(LN2_HI), LN2_L = LN2_HI - LN2_H;
const LN10_H = splitHi(LN10_HI), LN10_L = LN10_HI - LN10_H;
const ZIV = 2 ** -63;

/** Correctly rounded log10 for x > 0 (numpy's np.log10); NaN, 0, negatives and ∞ as Math.log10. */
export function log10(x        )         {
  if (!(x > 0) || x === Infinity) return Math.log10(x);
  if (x === 1) return 0;
  if (!tableReady) buildTable();
  let v = x, e = 0;
  if (v < 2.2250738585072014e-308) { v *= 2 ** 54; e -= 54; }
  const k = Math.min(1023, Math.floor(Math.log2(v)));
  let m = v / 2 ** k; e += k;
  if (m > Math.SQRT2) { m /= 2; e += 1; }
  const j = Math.min(J_MAX, Math.max(J_MIN, Math.round((m - 1) * 128))) - J_MIN;
  // r = rh + rl = m·INV[j] − 1, exactly: Dekker's product p + pe, then twoSum(p − 1, pe)
  const p = m * INV[j];
  const mc = SPLIT * m, mh = mc - (mc - m), ml = m - mh;
  const pe = ((mh * INV_H[j] - p) + mh * INV_L[j] + ml * INV_H[j]) + ml * INV_L[j];
  const d = p - 1, rh = d + pe, rb = rh - d, rl = (d - (rh - rb)) + (pe - rb);
  // r² = r2h + r2l
  const rc = SPLIT * rh, rH = rc - (rc - rh), rL = rh - rH;
  const r2h = rh * rh, r2l = (((rH * rH - r2h) + 2 * rH * rL) + rL * rL) + 2 * rh * rl;
  // r³ = r3h + r3l, then r³/3 = c3h + c3l
  const sc = SPLIT * r2h, sH = sc - (sc - r2h), sL = r2h - sH;
  const r3h = r2h * rh, r3l = ((((sH * rH - r3h) + sH * rL + sL * rH) + sL * rL) + r2h * rl) + r2l * rh;
  const tc = SPLIT * r3h, tH = tc - (tc - r3h), tL = r3h - tH;
  const c3h = r3h * THIRD_HI, c3l = ((((tH * THIRD_H - c3h) + tH * THIRD_L + tL * THIRD_H) + tL * THIRD_L) + r3h * THIRD_LO) + r3l * THIRD_HI;
  const q = -0.25 + rh * (0.2 + rh * (-1 / 6 + rh * (1 / 7 + rh * (-0.125 + rh * (1 / 9 + rh * (-0.1 + rh / 11))))));
  // ln(1 + r) = lh + ll: the two leading sums exactly (twoSum), every remainder in ll
  const h2 = -0.5 * r2h, ah = h2 + c3h, ab = ah - h2, ae = (h2 - (ah - ab)) + (c3h - ab);
  const lh = rh + ah, lb = lh - rh, le = (rh - (lh - lb)) + (ah - lb);
  const ll = le + ae + rl - 0.5 * r2l + c3l + r2h * r2h * q;
  // ln x = e·ln2 + T[j] + ln(1 + r) = nh + nl
  const ec = SPLIT * e, eH = ec - (ec - e), eL = e - eH;
  const gh = e * LN2_HI, ge = ((eH * LN2_H - gh) + eH * LN2_L + eL * LN2_H) + eL * LN2_L;
  const s1 = gh + T_HI[j], b1 = s1 - gh, e1 = (gh - (s1 - b1)) + (T_HI[j] - b1);
  const s2 = s1 + lh, b2 = s2 - s1, e2 = (s1 - (s2 - b2)) + (lh - b2);
  const lo = e2 + e1 + ge + e * LN2_LO + T_LO[j] + ll;
  const nh = s2 + lo, nl = lo - (nh - s2);
  // / ln10: q1 = nh/LN10_HI, the remainder exactly via Dekker, then one correction
  const q1 = nh / LN10_HI;
  const qc = SPLIT * q1, qH = qc - (qc - q1), qL = q1 - qH;
  const pp = q1 * LN10_HI, ppe = ((qH * LN10_H - pp) + qH * LN10_L + qL * LN10_H) + qL * LN10_L;
  const q2 = (((nh - pp) - ppe) + nl - q1 * LN10_LO) / LN10_HI;
  const y = q1 + q2, yb = y - q1, yl = (q1 - (y - yb)) + (q2 - yb), err = Math.abs(y) * ZIV;
  if (y + (yl + err) === y && y + (yl - err) === y) return y;
  lnDD(x);
  div(R[0], R[1], LN10_HI, LN10_LO);
  return R[0] + R[1];
}

/** Correctly rounded exp (np.exp); non-finite and overflowing arguments go to Math.exp. */
export function exp(x        )         {
  if (!Number.isFinite(x) || x > 709.8 || x < -745.2) return Math.exp(x);
  if (x === 0) return 1;
  const k = Math.round(x / LN2_HI);
  // r = x − k·ln2 in double-double: k·LN2.hi is exact enough via twoProd
  mul(-k, 0, LN2_HI, LN2_LO);
  add(x, 0, R[0], R[1]);
  const r0 = R[0], r1 = R[1];
  // e^r = Σ r^i / i!; |r| ≤ 0.35, 27 terms reach 2^-120
  let t0 = 1, t1 = 0, sum0 = 1, sum1 = 0;
  for (let i = 1; i < 28; i++) {
    mul(t0, t1, r0, r1);
    div(R[0], R[1], i, 0); t0 = R[0]; t1 = R[1];
    add(sum0, sum1, t0, t1); sum0 = R[0]; sum1 = R[1];
  }
  // scale by 2^k in two steps so neither factor overflows; subnormal results round once at the end
  const s = sum0 + sum1;
  if (k > 1000 || k < -1000) {
    const h = Math.trunc(k / 2);
    return s * 2 ** h * 2 ** (k - h);
  }
  if (k < -1021) {
    // the final product is subnormal: scale the double-double first, then round once
    return (sum0 * 2 ** (k + 54) + sum1 * 2 ** (k + 54)) * 2 ** -54;
  }
  return s * 2 ** k;
}

// ---------------------------------------------------------------- sin, cos, tan
// Path.arc builds its control points from np.cos / np.sin of an angle grid and np.tan / np.sin of the step, and pie's
// geometry calls math.cos / math.sin. glibc (and numpy, which matches it on x86-64) rounds these correctly in practice;
// V8's fdlibm is off by one ulp on a few arc angles (cos(5π/4) among them). Same method as exp: reduce by k·π/2 with
// π/2 as three doubles (Cody–Waite, the products exact through twoProd), a double-double Taylor series on |r| ≤ π/4,
// one rounding at the end.
const PIO2_1 = 1.5707963267948966, PIO2_2 = 6.123233995736766e-17, PIO2_3 = -1.4973849048591698e-33;

/** x − k·π/2 as a double-double in (R[0], R[1]), and the quadrant k mod 4. */
function reduce(x        )         {
  const k = Math.round(x / PIO2_1);
  twoProd(-k, PIO2_1);
  const a0 = R[0], a1 = R[1];
  twoProd(-k, PIO2_2);
  const b0 = R[0], b1 = R[1] - k * PIO2_3;
  add(x, 0, a0, a1);
  add(R[0], R[1], b0, b1);
  return ((k % 4) + 4) % 4;
}
/** sin (odd = 1) or cos (odd = 0) of the double-double r, |r| ≤ π/4, into (R[0], R[1]). */
function series(r0        , r1        , odd       )       {
  mul(r0, r1, r0, r1);
  const q0 = -R[0], q1 = -R[1];        // −r²
  let t0 = odd === 1 ? r0 : 1, t1 = odd === 1 ? r1 : 0, sum0 = t0, sum1 = t1;
  for (let i = 1; i < 16; i++) {
    const n = 2 * i + odd;
    mul(t0, t1, q0, q1);
    div(R[0], R[1], (n - 1) * n, 0); t0 = R[0]; t1 = R[1];
    add(sum0, sum1, t0, t1); sum0 = R[0]; sum1 = R[1];
  }
  R[0] = sum0; R[1] = sum1;
}
/** sin or cos of x as a double-double in (R[0], R[1]). */
function sinCosDD(x        , wantCos         )       {
  const q = (reduce(x) + (wantCos ? 1 : 0)) % 4;
  const r0 = R[0], r1 = R[1];
  series(r0, r1, q % 2 === 0 ? 1 : 0);
  if (q >= 2) { R[0] = -R[0]; R[1] = -R[1]; }
}
const trigOk = (x        )          => Number.isFinite(x) && Math.abs(x) < 2 ** 30;
/** Correctly rounded sin (glibc's, np.sin's); huge or non-finite arguments go to Math.sin. */
export function sin(x        )         {
  if (!trigOk(x) || x === 0) return Math.sin(x);
  sinCosDD(x, false);
  return R[0] + R[1];
}
/** Correctly rounded cos (glibc's, np.cos's); huge or non-finite arguments go to Math.cos. */
export function cos(x        )         {
  if (!trigOk(x)) return Math.cos(x);
  sinCosDD(x, true);
  return R[0] + R[1];
}
/** Correctly rounded tan (glibc's, np.tan's); huge or non-finite arguments go to Math.tan. */
export function tan(x        )         {
  if (!trigOk(x) || x === 0) return Math.tan(x);
  sinCosDD(x, false);
  const s0 = R[0], s1 = R[1];
  sinCosDD(x, true);
  div(s0, s1, R[0], R[1]);
  return R[0] + R[1];
}
