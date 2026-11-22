// Axes.pie, made pure: matplotlib 3.11.2 axes/_axes.py (pie, pie_label), patches.Wedge._recompute_path,
// path.Path.arc and Python's printf-style `autopct % pct`, with the same float operations in the same order.
                                                                 
import { err, ok } from './types.js';
import { cos, sin, tan } from './libm.js';

/** Path codes, as matplotlib.path.Path. */
export const MOVETO = 1, LINETO = 2, CURVE4 = 4, CLOSEPOLY = 79;
/** A path in data coordinates: vertex i is (xs[i], ys[i]) with code codes[i]; CURVE4 vertices come in threes. */
                                                                                                            

/** np.rint: round half to even. */
const rint = (v        )         => {
  const f = Math.floor(v), d = v - f;
  return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
};
/** np.deg2rad: x · (π/180). */
const deg2rad = (x        )         => x * (Math.PI / 180);

/** Path.arc(theta1, theta2) (is_wedge=False): the unit-circle arc as n cubic Béziers (Masionobe 2003). */
export function unitArc(theta1        , theta2        )           {
  const halfpi = Math.PI * 0.5;
  const nTurns = (theta2 - theta1) / 360;
  const nearest = rint(nTurns);
  const full = nearest !== 0 && Math.abs(nTurns - nearest) <= 1e-12;
  const eta1 = deg2rad(theta1);
  const eta2 = deg2rad(full ? theta1 + 360 : theta2 - 360 * Math.floor(nTurns));
  const n = Math.trunc(2 ** Math.ceil((eta2 - eta1) / halfpi));
  if (n < 1) throw new Error('n must be >= 1 or None');
  const deta = (eta2 - eta1) / n;
  const t = tan(0.5 * deta);
  const alpha = sin(deta) * (Math.sqrt(4.0 + 3.0 * t * t) - 1) / 3.0;
  // np.linspace(eta1, eta2, n + 1): i·step + start, the last one exactly eta2
  const step = (eta2 - eta1) / n;
  const C = new Float64Array(n + 1), S = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const s = i === n ? eta2 : i * step + eta1;
    C[i] = cos(s); S[i] = sin(s);
  }
  const len = 3 * n + 1;
  const xs = new Float64Array(len), ys = new Float64Array(len), codes = new Uint8Array(len).fill(CURVE4);
  xs[0] = C[0]; ys[0] = S[0]; codes[0] = MOVETO;
  for (let i = 0; i < n; i++) {
    // xA + α·xA_dot with xA_dot = −yA, yA_dot = xA; xB − α·xB_dot
    xs[1 + 3 * i] = C[i] + alpha * -S[i]; ys[1 + 3 * i] = S[i] + alpha * C[i];
    xs[2 + 3 * i] = C[i + 1] - alpha * -S[i + 1]; ys[2 + 3 * i] = S[i + 1] - alpha * C[i + 1];
    xs[3 + 3 * i] = C[i + 1]; ys[3 + 3 * i] = S[i + 1];
  }
  return { xs, ys, codes };
}

/**
 * Wedge._recompute_path: the arc theta1 → theta2 (degrees), then a LINETO to the centre (or, with `width`, the
 * reversed inner arc scaled by (r − width)/r), CLOSEPOLY; scaled by r and moved to the centre (v·r + center).
 * A complete annulus (theta2 − theta1 = 360) is drawn 0 → 360 with a MOVETO connector.
 */
export function wedgePath(cx        , cy        , r        , theta1        , theta2        , width                )           {
  const whole = Math.abs((theta2 - theta1) - 360) <= 1e-12;
  const arc = whole ? unitArc(0, 360) : unitArc(theta1, theta2);
  const connector = whole ? MOVETO : LINETO;
  const m = arc.xs.length;
  const vx           = [...arc.xs], vy           = [...arc.ys], codes           = [...arc.codes];
  if (width.kind === 'some') {
    const w = width.value;
    for (let i = m - 1; i >= 0; i--) { vx.push((arc.xs[i] * (r - w)) / r); vy.push((arc.ys[i] * (r - w)) / r); }
    codes.push(connector, ...arc.codes.subarray(1));
    vx.push(0); vy.push(0); codes.push(CLOSEPOLY);
  } else {
    vx.push(0, 0); vy.push(0, 0); codes.push(connector, CLOSEPOLY);
  }
  return {
    xs: Float64Array.from(vx, (v) => v * r + cx),
    ys: Float64Array.from(vy, (v) => v * r + cy),
    codes: Uint8Array.from(codes),
  };
}

/** One wedge of a pie: its centre (after explode), radius and angles in degrees (theta1 < theta2). */
                                                                                                                                          

/** Axes.pie's wedge loop: fractions of the circle from startangle, counterclockwise or not, each offset by explode·r̂. */
export function pieWedges(fracs              , explode              , startangle        , counterclock         ,
                          center                           , radius        )                      {
  let theta1 = startangle / 360;
  const out             = [];
  for (let i = 0; i < fracs.length; i++) {
    const frac = fracs[i], expl = explode[i];
    const theta2 = counterclock ? theta1 + frac : theta1 - frac;
    const thetam = 2 * Math.PI * 0.5 * (theta1 + theta2);
    const x = center[0] + expl * cos(thetam), y = center[1] + expl * sin(thetam);
    out.push({ cx: x, cy: y, r: radius, theta1: 360.0 * Math.min(theta1, theta2), theta2: 360.0 * Math.max(theta1, theta2) });
    theta1 = theta2;
  }
  return out;
}

/** Python's float % 360 (the sign follows the divisor), as Text.set_rotation normalizes. */
export const pyMod360 = (v        )         => {
  const m = v % 360;
  return m !== 0 && m < 0 ? m + 360 : m;
};

/** Where pie_label puts a wedge's text: (x, y) in data coordinates, its alignment and rotation (degrees CCW). */
                                                                                                                                          
/** Axes.pie_label for one wedge: at distance·r along the bisector; 'outer' aligns away from the centre. */
export function pieLabelPos(w          , distance        , alignment                    , rotate         )              {
  const thetam = 2 * Math.PI * 0.5 * (w.theta1 + w.theta2) / 360;
  const x = w.cx + distance * w.r * cos(thetam);
  const y = w.cy + distance * w.r * sin(thetam);
  const ha         = alignment === 'outer' ? (x > 0 ? 'left' : 'right') : 'center';
  const va         = rotate && alignment === 'outer' ? (y > 0 ? 'bottom' : 'top') : 'center';
  const rotation = rotate ? pyMod360(thetam * (180 / Math.PI) + (x > 0 ? 0 : 180)) : 0;
  return { x, y, ha, va, rotation };
}

// ---------------------------------------------------------------- Python printf-style formatting of one float
/** |x| = int / 10^scale exactly (a double is m·2^e, and 2^−k = 5^k / 10^k). */
function exactDecimal(x        )                                                   {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const bits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e = -1074;
  if (bits !== 0) { mant |= 1n << 52n; e = bits - 1075; }
  return e >= 0 ? { int: mant << BigInt(e), scale: 0 } : { int: mant * 5n ** BigInt(-e), scale: -e };
}
/** int / 10^(scale − target), rounded half to even (correctly rounded, as CPython's dtoa). */
function rescale(int        , scale        , target        )         {
  if (target >= scale) return int * 10n ** BigInt(target - scale);
  const d = 10n ** BigInt(scale - target);
  const q = int / d, r = int % d;
  if (2n * r > d || (2n * r === d && q % 2n === 1n)) return q + 1n;
  return q;
}
/** '%.<prec>f' digits of |x|. */
function fixedDigits(x        , prec        , alt         )         {
  const { int, scale } = exactDecimal(x);
  const s = rescale(int, scale, prec).toString().padStart(prec + 1, '0');
  const whole = s.slice(0, s.length - prec), frac = s.slice(s.length - prec);
  return prec > 0 ? `${whole}.${frac}` : alt ? `${whole}.` : whole;
}
/** |x| to `p` significant digits: the digit string and the decimal exponent of its first digit. */
function sigDigits(x        , p        )                                                    {
  if (x === 0) return { digits: '0'.repeat(p), exp: 0 };
  const { int, scale } = exactDecimal(x);
  const len = int.toString().length;
  let exp = len - 1 - scale;
  let q = rescale(int, scale, p - 1 - exp);
  if (q.toString().length > p) { exp += 1; q = rescale(int, scale, p - 1 - exp); }
  return { digits: q.toString(), exp };
}
const expStr = (e        )         => `${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
function expDigits(x        , prec        , alt         , upper         )         {
  const { digits, exp } = sigDigits(x, prec + 1);
  const mant = prec > 0 ? `${digits[0]}.${digits.slice(1)}` : alt ? `${digits}.` : digits;
  return `${mant}${upper ? 'E' : 'e'}${expStr(exp)}`;
}
function generalDigits(x        , prec        , alt         , upper         )         {
  const p = prec === 0 ? 1 : prec;
  const exp = x === 0 ? 0 : sigDigits(x, p).exp;
  const strip = (s        )         => (alt || !s.includes('.') ? s : s.replace(/\.?0+$/, ''));
  if (exp >= -4 && exp < p) return strip(fixedDigits(x, p - 1 - exp, alt));
  const e = expDigits(x, p - 1, alt, upper), at = e.indexOf(upper ? 'E' : 'e');
  return strip(e.slice(0, at)) + e.slice(at);
}
/** CPython float repr (str): shortest round-trip digits, exponent form outside 1e-4 ≤ |x| < 1e16. */
export function pyFloatRepr(x        )         {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [m, es] = x.toExponential().split('e');
  const e = Number(es), digits = m.replace('-', '').replace('.', ''), sign = x < 0 ? '-' : '';
  if (e < -4 || e >= 16) return `${sign}${digits[0]}${digits.length > 1 ? '.' + digits.slice(1) : ''}e${expStr(e)}`;
  if (e < 0) return `${sign}0.${'0'.repeat(-e - 1)}${digits}`;
  const whole = digits.padEnd(e + 1, '0');
  return `${sign}${whole.slice(0, e + 1)}.${digits.length > e + 1 ? digits.slice(e + 1) : '0'}`;
}

/**
 * Python's `fmt % value` for one float (pie's autopct): %[flags][width][.precision]conv with flags '-', '+', ' ', '0',
 * '#' and conversions d i u f F e E g G s r, plus '%%'. A mapping key, '*' or a second conversion is an error.
 */
export function pyPercentFormat(fmt        , value        )                 {
  const re = /%([-+ 0#]*)(\d*)(?:\.(\d*))?([diufFeEgGsr%])/gy;
  let out = '', i = 0, used = 0;
  while (i < fmt.length) {
    const at = fmt.indexOf('%', i);
    if (at < 0) { out += fmt.slice(i); break; }
    out += fmt.slice(i, at);
    re.lastIndex = at;
    const m = re.exec(fmt);
    if (!m) return err(`autopct: unsupported format character in ${JSON.stringify(fmt)}`);
    const [whole, flags, widthS, precS, conv] = m;
    i = at + whole.length;
    if (conv === '%') { out += '%'; continue; }
    if (used++ > 0) return err('autopct: not enough arguments for format string');
    const width = widthS === '' ? 0 : Number(widthS);
    const precGiven = typeof precS === 'string';
    const prec = precGiven ? (precS === '' ? 0 : Number(precS)) : 6;
    const left = flags.includes('-'), zero = flags.includes('0') && !left, alt = flags.includes('#');
    const neg = value < 0 || Object.is(value, -0);
    const finite = Number.isFinite(value);
    let body        ;
    let numeric = true;
    switch (conv) {
      case 'd': case 'i': case 'u': {
        if (!finite) return err(`autopct: cannot convert float ${pyFloatRepr(value)} to integer`);
        const t = BigInt(Math.trunc(Math.abs(value))).toString();
        body = precGiven ? t.padStart(prec, '0') : t;
        break;
      }
      case 'f': case 'F': body = finite ? fixedDigits(value, prec, alt) : (Number.isNaN(value) ? 'nan' : 'inf'); break;
      case 'e': case 'E': body = finite ? expDigits(Math.abs(value), prec, alt, conv === 'E') : (Number.isNaN(value) ? 'nan' : 'inf'); break;
      case 'g': case 'G': body = finite ? generalDigits(Math.abs(value), prec, alt, conv === 'G') : (Number.isNaN(value) ? 'nan' : 'inf'); break;
      case 's': case 'r': {
        numeric = false;
        const s = pyFloatRepr(value);
        body = precGiven ? s.slice(0, prec) : s;
        break;
      }
      default: return err(`autopct: unsupported conversion '${conv}'`);
    }
    if (numeric && (conv === 'F' || conv === 'E' || conv === 'G')) body = body.toUpperCase();
    const sign = !numeric ? '' : (neg && !Number.isNaN(value) && !(conv === 'd' || conv === 'i' || conv === 'u') ? '-'
      : neg && (conv === 'd' || conv === 'i' || conv === 'u') && Math.trunc(value) !== 0 ? '-'
        : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '');
    const padZero = zero && numeric && finite;
    const n = sign.length + body.length;
    if (n >= width) out += sign + body;
    else if (left) out += sign + body + ' '.repeat(width - n);
    else if (padZero) out += sign + '0'.repeat(width - n) + body;
    else out += ' '.repeat(width - n) + sign + body;
  }
  if (used === 0) return err('autopct: not all arguments converted during string formatting');
  return ok(out);
}
