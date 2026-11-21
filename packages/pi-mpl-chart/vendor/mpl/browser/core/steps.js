// cbook.pts_to_prestep / pts_to_poststep / pts_to_midstep: the vertices Line2D draws for a drawstyle.
                                            
import { assertNever } from './types.js';

export function stepped(x              , y              , ds           )                                                         {
  const n = Math.min(x.length, y.length);
  switch (ds) {
    case 'default': return { x, y };
    case 'steps-pre': case 'steps-post': {
      const m = Math.max(2 * n - 1, 0), sx = new Float64Array(m), sy = new Float64Array(m);
      for (let k = 0; k < n; k++) { sx[2 * k] = x[k]; sy[2 * k] = y[k]; }
      for (let k = 0; k + 1 < n; k++) {
        // pre: the step rises at the start of each interval; post: at its end
        if (ds === 'steps-pre') { sx[2 * k + 1] = x[k]; sy[2 * k + 1] = y[k + 1]; } else { sx[2 * k + 1] = x[k + 1]; sy[2 * k + 1] = y[k]; }
      }
      return { x: sx, y: sy };
    }
    case 'steps-mid': {
      const sx = new Float64Array(2 * n), sy = new Float64Array(2 * n);
      for (let k = 0; k + 1 < n; k++) { const mid = (x[k] + x[k + 1]) / 2; sx[2 * k + 1] = mid; sx[2 * k + 2] = mid; }
      if (n > 0) { sx[0] = x[0]; sx[2 * n - 1] = x[n - 1]; }
      for (let k = 0; k < n; k++) { sy[2 * k] = y[k]; sy[2 * k + 1] = y[k]; }
      return { x: sx, y: sy };
    }
    default: return assertNever(ds);
  }
}
