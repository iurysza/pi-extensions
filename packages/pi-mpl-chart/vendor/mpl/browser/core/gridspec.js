// matplotlib.gridspec: SubplotParams, GridSpec geometry and SubplotSpec positions, with the same
// float operations (get_grid_positions builds the cells by a running np.cumsum).
                                                   
import { none, some } from './types.js';

/** Figure.subplotpars: margins as figure fractions, spacing as fractions of the mean cell size. */
                             
                                                                                               
                                                   
  

/** A GridSpec: geometry, ratios, and the subplot parameters it overrides (gridspec_kw).
 *  `parent` is set for GridSpecFromSubplotSpec (colorbar make_axes_gridspec): positions nest
 *  inside the parent's cell bbox instead of the figure margins. */
                        
                                                 
                                                                                    
                       
                                                                                                                                 
                                                                     
    
                                       
  

/** A SubplotSpec: the half-open row and column spans of one cell group in a GridSpec. */
                                                                                                                                          

const pick = (o                , d        )         => (o.kind === 'some' ? o.value : d);

/** GridSpec.get_subplot_params: non-None GridSpec attributes win over the figure's.
 *  Nested specs (parent set) replace left/bottom/right/top with the parent's cell bbox. */
export function subplotParams(gs          , fig               )                {
  const o = gs.overrides;
  if (gs.parent.kind === 'some') {
    const [L, B, R, T] = cellPosition(gs.parent.value, fig);
    return { left: L, bottom: B, right: R, top: T,
             wspace: pick(o.wspace, fig.wspace), hspace: pick(o.hspace, fig.hspace) };
  }
  return { left: pick(o.left, fig.left), bottom: pick(o.bottom, fig.bottom), right: pick(o.right, fig.right), top: pick(o.top, fig.top),
           wspace: pick(o.wspace, fig.wspace), hspace: pick(o.hspace, fig.hspace) };
}

/** np.cumsum(np.column_stack([seps, cells]).flat): running sums, sep then cell, in order. */
function cumsumPairs(cells                   , sep        )                    {
  const out           = [];
  let acc = 0;
  cells.forEach((c, i) => {
    acc += i === 0 ? 0 : sep; out.push(acc);   // [0] + [sep] * (n - 1); the int 0 adds exactly
    acc += c; out.push(acc);
  });
  return out;
}

/** Python's sum() over the ratios: left to right from int 0. */
const pySum = (xs                   )         => xs.reduce((a, b) => a + b, 0);

                                                                                                                                                                             

/** Every other entry, from `odd` (the reshape((-1, 2)).T columns). */
const even =    (a              , odd       )               => a.filter((_, i) => i % 2 === odd);

/** GridSpecBase.get_grid_positions. */
export function gridPositions(gs          , fig               )                {
  const p = subplotParams(gs, fig);
  const { nrows, ncols } = gs;
  const totW = p.right - p.left, totH = p.top - p.bottom;
  const cellH = totH / (nrows + p.hspace * (nrows - 1));
  const sepH = p.hspace * cellH;
  const normH = cellH * nrows / pySum(gs.heightRatios);
  const hs = cumsumPairs(gs.heightRatios.map((r) => r * normH), sepH);
  const cellW = totW / (ncols + p.wspace * (ncols - 1));
  const sepW = p.wspace * cellW;
  const normW = cellW * ncols / pySum(gs.widthRatios);
  const ws = cumsumPairs(gs.widthRatios.map((r) => r * normW), sepW);
  return {
    tops: even(hs, 0).map((v) => p.top - v), bottoms: even(hs, 1).map((v) => p.top - v),
    lefts: even(ws, 0).map((v) => p.left + v), rights: even(ws, 1).map((v) => p.left + v),
  };
}

/** SubplotSpec.get_position: the cell group's [left, bottom, right, top] (Bbox.from_extents). */
export function cellPosition(ss             , fig               )           {
  const g = gridPositions(ss.grid, fig);
  const [r0, r1] = ss.rows, [c0, c1] = ss.cols;
  // np.unravel_index([num1, num2]): only the first and last row/column of the span count
  const rows = [r0, r1 - 1], cols = [c0, c1 - 1];
  return [Math.min(...cols.map((c) => g.lefts[c])), Math.min(...rows.map((r) => g.bottoms[r])),
          Math.max(...cols.map((c) => g.rights[c])), Math.max(...rows.map((r) => g.tops[r]))];
}

/** Bbox.from_extents keeps its corners; SubplotParams.update rejects inverted margins. */
export function validParams(p               )                 {
  if (p.left >= p.right) return some('left cannot be >= right');
  if (p.bottom >= p.top) return some('bottom cannot be >= top');
  return none;
}

/** Build a top-level GridSpec (no parent). */
export function gridSpec(nrows        , ncols        ,
  widthRatios                   , heightRatios                   ,
  overrides                       )           {
  return { nrows, ncols, widthRatios, heightRatios, overrides, parent: none };
}

/** SubplotSpec.subgridspec: a GridSpecFromSubplotSpec nested in this cell. */
export function subgridspec(parent             , nrows        , ncols        , opts   
                                                                                    
                                                   
 )           {
  return {
    nrows, ncols,
    widthRatios: opts.widthRatios, heightRatios: opts.heightRatios,
    overrides: { left: none, bottom: none, right: none, top: none, wspace: some(opts.wspace), hspace: some(opts.hspace) },
    parent: some(parent),
  };
}

/** A SubplotSpec covering rows [r0,r1) × cols [c0,c1). */
export function subplotSpec(grid          , r0        , r1        , c0        , c1        )              {
  return { grid, rows: [r0, r1], cols: [c0, c1] };
}
