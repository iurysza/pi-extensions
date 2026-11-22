// matplotlib.colorbar.Colorbar's value geometry: where the N colour bands sit along the long axis, the view
// limits, and how an axes fraction (extend tips, outline) maps to data. Pure; api.ts's Colorbar draws with it.
import { exp, log10 } from './libm.js';
import { assertNever } from './types.js';

/** The norm a colorbar follows. 'log' is LogNorm (base 10): the long axis takes the norm's LogScale. */
                          
                                                                             
                                                                           

/** The bar's geometry along its long axis: band edges (N + 1, low to high), each band's colour position in
 *  [0, 1] (what the cmap is indexed with), the view interval, and the long axis' scale. */
                             
                               
                                 
                                          
                                   
  

const LN10 = Math.log(10);   // np.log(10)
// InvertedLogTransform(10): np.exp(values * np.log(10)); LogTransform(10): np.log10
const invLog = (t        )         => exp(t * LN10);

/**
 * Colorbar._process_values / _mesh. Linear: edges at lo + span * i/N, colours at band centres (unchanged
 * from before LogNorm support). Log: _uniform_y's linspace through LogNorm.inverse gives the boundaries;
 * vmin/vmax become the first and last boundary (so 10 → 10.000000000000002, as matplotlib's ylim reads);
 * the mesh is _proportional_y renormalized and sent back through the norm at those limits; each band's
 * colour is norm(value) at the arithmetic mean of its boundaries (Colorbar._values).
 */
export function colorbarBands(norm              , N        )                {
  switch (norm.kind) {
    case 'linear': {
      const lo = norm.vmin, span = norm.vmax - norm.vmin;
      const edges = new Float64Array(N + 1), colorAt = new Float64Array(N);
      for (let i = 0; i <= N; i++) edges[i] = lo + span * (i / N);
      for (let i = 0; i < N; i++) colorAt[i] = (i + 0.5) / N;
      return { edges, colorAt, lim: [norm.vmin, norm.vmax], scale: 'linear' };
    }
    case 'log': {
      if (!(norm.vmin > 0) || !(norm.vmax > norm.vmin) || !Number.isFinite(norm.vmax)) {
        throw new RangeError(`colorbar: LogNorm needs 0 < vmin < vmax, got vmin=${norm.vmin}, vmax=${norm.vmax}`);
      }
      const step = 1 / N;   // np.linspace(0, 1, N + 1): i * step, the last point exactly 1
      const u = (i        )         => (i === N ? 1 : i * step);
      const t0 = log10(norm.vmin), t1 = log10(norm.vmax), dt = t1 - t0;
      const b = new Float64Array(N + 1);
      for (let i = 0; i <= N; i++) b[i] = invLog(u(i) * dt + t0);
      const cmin = b[0], cmax = b[N];
      // _proportional_y: norm(boundaries), then Normalize(y[0], y[-1])
      const y = new Float64Array(N + 1);
      for (let i = 0; i <= N; i++) y[i] = (log10(b[i]) - t0) / dt;
      const y0 = y[0], yspan = y[N] - y[0];
      // _mesh: norm.inverse with vmin, vmax = the colorbar's limits
      const c0 = log10(cmin), dc = log10(cmax) - c0;
      const edges = new Float64Array(N + 1);
      for (let i = 0; i <= N; i++) edges[i] = invLog(((y[i] - y0) / yspan) * dc + c0);
      const colorAt = new Float64Array(N);
      for (let i = 0; i < N; i++) colorAt[i] = (log10(0.5 * (b[i] + b[i + 1])) - t0) / dt;
      return { edges, colorAt, lim: [cmin, cmax], scale: 'log' };
    }
    default: return assertNever(norm);
  }
}

/** Long-axis axes fraction → data under the bar's scale (extend tips and outline are drawn in axes coordinates). */
export function colorbarAxesToData(bands               , v        )         {
  const [lo, hi] = bands.lim;
  switch (bands.scale) {
    case 'linear': return lo + v * (hi - lo);
    case 'log': {
      if (v === 0) return lo;
      if (v === 1) return hi;
      const t0 = log10(lo);
      return invLog(t0 + v * (log10(hi) - t0));
    }
    default: return assertNever(bands.scale);
  }
}
