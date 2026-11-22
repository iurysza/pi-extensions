// Scale transforms (matplotlib.scale). Everything that maps data to the axis
// line goes through here, so a new Scale variant is a compile error at each site.
                                        
import { assertNever } from './types.js';
import { exp, log10 } from './libm.js';

/** LogTransform (nonpositive='clip'): log_b, with v <= 0 sent to -1000. base 10 uses log10, as numpy does. */
const logB = (base        , v        )         => {
  if (!(v > 0)) return Number.isNaN(v) ? NaN : -1000;
  return base === 10 ? log10(v) : base === 2 ? Math.log2(v) : Math.log(v) / Math.log(base);
};

export function forward(s       , v        )         {
  switch (s.kind) {
    case 'linear': return v;
    case 'log': return logB(s.base, v);
    default: return assertNever(s);
  }
}

/** InvertedLogTransform: np.exp(v * np.log(base)) for base 10 (numpy has no exp10 in its table). */
export function inverse(s       , v        )         {
  switch (s.kind) {
    case 'linear': return v;
    case 'log': return s.base === 2 ? Math.pow(2, v) : exp(v * Math.log(s.base));
    default: return assertNever(s);
  }
}

/** Typed-array forward transform; the switch is outside the loop. */
export function forwardAll(s       , src              )               {
  switch (s.kind) {
    case 'linear': return src;
    case 'log': {
      const out = new Float64Array(src.length), b = s.base;
      for (let i = 0; i < src.length; i++) out[i] = logB(b, src[i]);
      return out;
    }
    default: return assertNever(s);
  }
}
