// Artists -> scene nodes, plus what loc='best' needs to avoid. Plan/apply:
// one typed-array transform pass; everything after is bounded by pixels.
                                        
import { tx, ty, tyText } from './frame.js';
                                             
import { lineStroke, markersNode, snapsAuto } from './marks.js';
                                    
import { cleanupStroke, decimateMinMax, isRectilinear } from './path.js';
import { inkOf, pathNode, rectNode, snapIf, snapOffset } from './scene.js';
import { MARKERS } from './data/markers.js';
                                             
import { arrowExtents, styledArrowPaths, yaArrowPath } from './arrow.js';
import { lookup } from './std.js';
import { forward, forwardAll, inverse } from './scale.js';
import { applyNorm, autoscaleNorm, getColormap, logNorm, mapBytes, normalize, requireColormapRgba } from './colormap.js';
import {
            interpolationStage, resampleAffineFloat, resampleAffineRgba,
  resolveInterp, UnsupportedInterpolationError,
} from './image-resample.js';
import { CLOSEPOLY, CURVE4, LINETO, MOVETO, wedgePath } from './pie.js';
import { flatten } from '../render/agg/stroke.js';
                                              
                                                                                                                                                                                                                                                                                                                                      
import { labelNodes } from './draw-axis.js';
import { measure, placeLayout, pxPerPt, strokePx, windowExtent } from './text.js';
                                       
import { resolveFace } from './fonts.js';
import { assertNever, none, some } from './types.js';
import { stepped } from './steps.js';
                                              

/** What an artist draws, plus what loc='best' avoids: line vertices and paths, patch boxes, and collection offsets
 *  (points, display y up; they count when strictly inside but, unlike a line, do not intersect). */
                     
                                                                                                                                 
                                                                                                                  
                                                               
                                
                                  
  

/** The artist's legend handle. It depends on the artist alone (not the frame), so a layout that only measures
 *  (tight_layout's first pass) can build legend entries without drawing. Every draw* returns this. */
export function handleOf(a        )                 {
  switch (a.kind) {
    case 'line': return some({ kind: 'line', stroke: a.stroke, markers: a.markers });
    case 'axline': return some({ kind: 'line', stroke: a.stroke, markers: { kind: 'none' } });
    case 'segments': return some({ kind: 'collection', color: a.colors[0], widthPt: a.widthPt, style: a.styles[0] });
    case 'bar': case 'fill': case 'polygon': case 'span': case 'wedge': return some({ kind: 'patch', face: a.face, edge: a.edge });
    case 'scatter': return some({ kind: 'scatter', shape: a.shape, collection: a.collection, edgeWidthPt: a.edgeWidthPt });
    case 'errorbar': return some({ kind: 'errorbar', errorbar: a.handle });
    case 'image': return none;
    case 'text': case 'annotation': return none;
    case 'sticky': return none;
    default: return assertNever(a);
  }
}

/** Scale transform (one pass per axis; identity for linear), then the affine map to device px. An axes-fraction
 *  coordinate (axhline's x, axvline's y) goes through transAxes instead: v·w + x0 (the blended transform's row). */
const DATA_COORDS                       = { x: 'data', y: 'data' };
function transform(x              , y              , coords                      , f       )                                                                                        {
  const n = Math.min(x.length, y.length);
  const xs = new Float64Array(n), ys = new Float64Array(n), ysUp = new Float64Array(n);
  const dataX = coords.x === 'data', dataY = coords.y === 'data';
  const dx = dataX ? forwardAll(f.xscale, x) : x, dy = dataY ? forwardAll(f.yscale, y) : y;
  // Agg folds the y flip into the affine (trans_affine::multiply): y_dev = y·(−ay) + (Hg − cy), Hg its int height.
  const ax = dataX ? f.ax : f.box.w, cx = dataX ? f.cx : f.box.x0;
  const ay = dataY ? f.ay : f.box.h, cy = dataY ? f.cy : f.box.b;
  const nay = -ay, tyDev = f.Hg - cy;
  for (let i = 0; i < n; i++) {
    xs[i] = dx[i] * ax + cx; ys[i] = dy[i] * nay + tyDev; ysUp[i] = dy[i] * ay + cy;
  }
  return { xs, ys, ysUp };
}

/** A Line2D stroke (already in device px), cleaned up as RendererAgg::draw_path does: NaN breaks, the canvas
 *  clip, SNAP_AUTO snapping and path.simplify (src/core/path.ts). */
function strokeNodes(xs              , ys              , stroke        , theme       , f       , span            )                  {
  if (xs.length === 0 || stroke.color.alpha <= 0) return [];
  const p = cleanupStroke(xs, ys, f.clipW, f.clipH, stroke.width, theme.simplify, f.snap);
  if (p.xs.length !== xs.length) span.setAttribute('simplified', p.xs.length);
  if (p.xs.length === 0) return [];   // nothing finite on the canvas (matplotlib writes a path without d)
  return [{ kind: 'polyline', xs: p.xs, ys: p.ys, moves: p.moves, stroke }];
}

const clip01 = (x        )         => (x < 0 ? 0 : x > 1 ? 1 : x);
const byteTrunc01 = (x        )         => (clip01(x) * 255) | 0;

/** The finite vertices in order: legend 'best' tests a line through PathNanRemover and ignores its MOVETOs
 *  (_path.path_intersects_rectangle), so a NaN gap counts as one segment joining its two sides. */
function finitePairs(xs              , ys              )     {
  let bad = 0;
  for (let i = 0; i < xs.length; i++) if (!(xs[i] - xs[i] === 0 && ys[i] - ys[i] === 0)) bad++;
  if (bad === 0) return { xs, ys };
  const ox = new Float64Array(xs.length - bad), oy = new Float64Array(xs.length - bad);
  let m = 0;
  for (let i = 0; i < xs.length; i++) if (xs[i] - xs[i] === 0 && ys[i] - ys[i] === 0) { ox[m] = xs[i]; oy[m] = ys[i]; m++; }
  return { xs: ox, ys: oy };
}

/** numpy searchsorted on an ascending, NaN-free array: the first i with v[i] >= x ('left') or v[i] > x ('right'). */
function searchsorted(v              , x        , side                  )         {
  let lo = 0, hi = v.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (side === 'left' ? v[mid] < x : v[mid] <= x) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Line2D._subslice (recache + draw): a line on transData with more than 1000 points whose x is sorted (NaNs ignored,
 * _path.is_sorted_and_has_non_nan) on a linear x scale, clipped to the axes, draws only the samples around the view,
 * [max(i0 − 1, 0), i1 + 1) with i0, i1 = searchsorted(x_filled, xbound, 'left' / 'right'). x_filled is x with NaNs
 * filled by np.interp over the index. This changes where path.simplify starts, so it decides vertices, not just cost.
 */
function subslice(a            , f       )                            {
  const x = a.x, n = Math.min(a.x.length, a.y.length);
  const full = [0, n]         ;
  if (n <= 1000 || !a.clip || a.coords.x !== 'data' || a.coords.y !== 'data' || f.xscale.kind !== 'linear') return full;
  let last = -Infinity, nonNan = false, nans = false;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (v === v) { nonNan = true; if (v < last) return full; last = v; } else nans = true;
  }
  if (!nonNan) return full;
  let xf = x;
  if (nans) {   // np.interp(indices[nan], indices[~nan], x[~nan]): ends take the nearest value
    xf = Float64Array.from(x);
    let prev = -1;
    for (let i = 0; i <= x.length; i++) {
      if (i < x.length && x[i] !== x[i]) continue;
      for (let j = prev + 1; j < i; j++) {
        if (prev < 0) xf[j] = x[i];
        else if (i === x.length) xf[j] = x[prev];
        else { const slope = (x[i] - x[prev]) / (i - prev); xf[j] = slope * (j - prev) + x[prev]; }
      }
      prev = i;
    }
  }
  const lo = Math.min(f.xlim[0], f.xlim[1]), hi = Math.max(f.xlim[0], f.xlim[1]);   // get_xbound
  const i0 = searchsorted(xf, lo, 'left'), i1 = searchsorted(xf, hi, 'right');
  return [Math.max(i0 - 1, 0), Math.min(i1 + 1, n)];
}

export function drawLine(a            , f       , theme       , k        , clip      , span            )        {
  // the stroke follows the drawstyle's step vertices; markers sit on the data points (Line2D.draw)
  const path = stepped(a.x, a.y, a.drawstyle);
  const line = transform(path.x, path.y, a.coords, f);
  // what is drawn: the subslice around the view (Line2D._subslice); legend placement still sees the whole path
  const [s0, s1] = subslice(a, f);
  const whole = s0 === 0 && s1 >= Math.min(a.x.length, a.y.length);
  const ax = whole ? a.x : a.x.subarray(s0, s1), ay = whole ? a.y : a.y.subarray(s0, s1);
  if (!whole) span.setAttribute('subslice', s1 - s0);
  const drawn = whole ? line : (() => { const p = stepped(ax, ay, a.drawstyle); return transform(p.x, p.y, a.coords, f); })();
  const pts = a.drawstyle === 'default' ? drawn : transform(ax, ay, a.coords, f);
  const nodes         = [];
  if (a.stroke.kind === 'on') {
    const d = a.decimate.kind === 'minmax' ? decimateMinMax(drawn.xs, drawn.ys, a.decimate.perPx) : drawn;
    if (d.xs.length !== drawn.xs.length) span.setAttribute('decimated', d.xs.length);
    nodes.push(...strokeNodes(d.xs, d.ys, lineStroke(theme, a.stroke.color, a.stroke.widthPt, a.stroke.style, k, a.cap), theme, f, span));
  }
  if (a.markers.kind === 'on') {
    const m = markersNode(a.markers, pts.xs, pts.ys, k, false, f.snap);
    if (m.kind === 'some') { nodes.push(m.value); span.setAttribute('markerCount', m.value.kind === 'markers' ? m.value.xs.length : 0); }
  }
  return {
    nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [],
    lines: [finitePairs(line.xs, line.ysUp)], boxes: [], points: [], paths: [],
    handle: handleOf(a),
  };
}

/**
 * axline (lines.AxLine.get_transform): in scaled coordinates, intersect the line with the four view-limit
 * edges, sort the points and keep the middle two; Line2D's unit path [(0, 0), (1, 1)] maps onto them.
 */
export function drawAxLine(a              , f       , theme       , k        , clip      , span            )        {
  const handle = handleOf(a);
  const x1 = forward(f.xscale, a.x1), y1 = forward(f.yscale, a.y1);
  let slope        ;
  if (a.through.kind === 'point') {
    const dx = forward(f.xscale, a.through.x2) - x1, dy = forward(f.yscale, a.through.y2) - y1;
    slope = dx === 0 ? Infinity : dy / dx;   // identical points are rejected by axline()
  } else slope = a.through.slope;
  const vxlo = forward(f.xscale, f.xlim[0]), vxhi = forward(f.xscale, f.xlim[1]);
  const vylo = forward(f.yscale, f.ylim[0]), vyhi = forward(f.yscale, f.ylim[1]);
  let start                           , stop                           ;
  if (slope === 0) { start = [vxlo, y1]; stop = [vxhi, y1]; }
  else if (!Number.isFinite(slope)) { start = [x1, vylo]; stop = [x1, vyhi]; }
  else {
    const pts                                = [
      [vxlo, y1 + (vxlo - x1) * slope], [vxhi, y1 + (vxhi - x1) * slope],
      [x1 + (vylo - y1) / slope, vylo], [x1 + (vyhi - y1) / slope, vyhi],
    ];
    pts.sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] - q[1]));   // Python tuple order
    start = pts[1]; stop = pts[2];
  }
  const xs = Float64Array.of(start[0] * f.ax + f.cx, stop[0] * f.ax + f.cx);
  const ys = Float64Array.of(start[1] * -f.ay + (f.Hg - f.cy), stop[1] * -f.ay + (f.Hg - f.cy));
  const up = Float64Array.of(start[1] * f.ay + f.cy, stop[1] * f.ay + f.cy);
  const nodes = a.stroke.kind === 'on' ? strokeNodes(xs, ys, lineStroke(theme, a.stroke.color, a.stroke.widthPt, a.stroke.style, k, none), theme, f, span) : [];
  return { nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [], lines: [{ xs, ys: up }], boxes: [], points: [], paths: [], handle };
}

/**
 * A LineCollection (Collection.draw). One solid segment takes the single-path optimization, draw_markers
 * with the segment as the marker at display (0, 0), i.e. pixel (0, H); otherwise draw_path_collection
 * strokes each segment with its own colour and dashes, in order. Either way Agg's PathSnapper snaps
 * an axis-aligned segment to floor(v + 0.5) + (odd width ? 0.5 : 0). GC defaults: butt caps, round joins.
 */
export function drawSegments(a                , f       , theme       , k        , clip      )        {
  const n = Math.min(a.x0.length, a.y0.length, a.x1.length, a.y1.length);
  const style0 = a.styles[0];
  const handle = handleOf(a);
  const strokeOf = (i        )         => {
    const st = lineStroke(theme, a.colors[i % a.colors.length], a.widthPt, a.styles[i % a.styles.length], k);
    return { ...st, cap: 'butt', join: 'round' };
  };
  const X0 = forwardAll(f.xscale, a.x0), X1 = forwardAll(f.xscale, a.x1), Y0 = forwardAll(f.yscale, a.y0), Y1 = forwardAll(f.yscale, a.y1);
  const single = n === 1 && a.colors.length === 1 && a.styles.length === 1 && style0 === 'solid';
  const nodes         = [];
  for (let i = 0; i < n; i++) {
    const stroke = strokeOf(i);
    if (stroke.color.alpha <= 0 || stroke.width <= 0) continue;
    const tyDev = single ? -f.cy : f.Hg - f.cy;
    const xs = Float64Array.of(X0[i] * f.ax + f.cx, X1[i] * f.ax + f.cx);
    const ys = Float64Array.of(Y0[i] * -f.ay + tyDev, Y1[i] * -f.ay + tyDev);
    if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) continue;
    const off = snapOffset(stroke.width);
    const fix = (v        )         => (!f.snap ? v : isRectilinear(xs, ys) ? Math.floor(v + 0.5) + off : single ? v + 0.5 : v);
    const segs        = [['M', fix(xs[0]), fix(ys[0])], ['L', fix(xs[1]), fix(ys[1])]];
    nodes.push(single
      ? { kind: 'markers', shape: segs, xs: Float64Array.of(0), ys: Float64Array.of(f.Hg), ink: { kind: 'stroke', stroke } }
      : pathNode(segs, { kind: 'stroke', stroke }));
  }
  return { nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [], lines: [], boxes: [], points: [], paths: [], handle };
}

/** A Polygon patch: filled and/or stroked (miter joins, butt caps), snapped when rectilinear. */
export function drawPolygon(a               , f       , k        , clip      )        {
  const handle = handleOf(a);
  const stroke                 = a.edge.kind === 'on' && a.edge.widthPt > 0
    ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const n = Math.min(a.x.length, a.y.length);
  const X = forwardAll(f.xscale, a.x), Y = forwardAll(f.yscale, a.y);
  const xs = new Float64Array(n), ys = new Float64Array(n), up = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = X[i] * f.ax + f.cx; ys[i] = Y[i] * -f.ay + (f.Hg - f.cy); up[i] = Y[i] * f.ay + f.cy; }
  const lines = [{ xs, ys: up }];
  // an unfilled, open outline fills nothing (Patch fill=False)
  const ink = inkOf(a.closed ? a.face : { kind: 'none' }, stroke);
  if (n === 0 || ink.kind === 'none') return { nodes: [], lines, boxes: [], points: [], paths: [], handle };
  // Polygon(closed=True) appends the first vertex, which becomes the CLOSEPOLY
  const cx = a.closed ? Float64Array.of(...xs, xs[0]) : xs, cy = a.closed ? Float64Array.of(...ys, ys[0]) : ys;
  const off = stroke.kind === 'some' ? snapOffset(stroke.value.width) : 0;
  const rect = f.snap && isRectilinear(cx, cy);
  const fix = (v        )         => (rect ? Math.floor(v + 0.5) + off : v);
  const segs        = Array.from(xs, (x, i)      => [i === 0 ? 'M' : 'L', fix(x), fix(ys[i])]);
  if (a.closed) segs.push(['Z']);
  return { nodes: [{ kind: 'group', clip, nodes: [pathNode(segs, ink.value, a.antialiased)], tag: '' }], lines, boxes: [], points: [], paths: [], handle };
}

                                                                                                    

export function drawBar(a           , f       , k        , clip      , span            )        {
  const stroke                 = a.edge.kind === 'on'
    ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } })
    : none;
  const lw = stroke.kind === 'some' ? stroke.value.width : 0;
  // Exact culling for opaque, unstroked bars of one colour: zero-area rects draw nothing; a rect
  // nested inside another in the same snapped column is fully covered.
  const f0 = a.face;
  const uniform = a.faces.every((p) => p.kind === f0.kind && (p.kind !== 'solid' || (f0.kind === 'solid' && p.color.hex === f0.color.hex && p.color.alpha === f0.color.alpha)));
  const cullable = stroke.kind === 'none' && uniform && f0.kind === 'solid' && f0.color.alpha === 1;
  const columns = new Map                   ();
  const kept            = [];
  const boxes        = [];
  for (let i = 0; i < a.x.length; i++) {
    const xa = tx(f, a.x[i]), xb = tx(f, a.x[i] + a.w[i]), ya = ty(f, a.y[i]), yb = ty(f, a.y[i] + a.h[i]);
    boxes.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: f.Hg - Math.max(ya, yb), y1: f.Hg - Math.min(ya, yb) });
    const x0 = snapIf(f.snap, Math.min(xa, xb), lw), x1 = snapIf(f.snap, Math.max(xa, xb), lw);
    const y0 = snapIf(f.snap, Math.min(ya, yb), lw), y1 = snapIf(f.snap, Math.max(ya, yb), lw);
    const r          = { x: x0, w: x1 - x0, y: y0, h: y1 - y0, i };
    if (cullable) {
      if (r.w <= 0 || r.h <= 0) continue;
      const key = x0 * 1048576 + x1;
      const found = lookup(columns, key);
      const col            = found.kind === 'some' ? found.value : [];
      if (found.kind === 'none') columns.set(key, col);
      if (col.findIndex((c) => c.y <= y0 && c.y + c.h >= y1) >= 0) continue;          // covered by an earlier bar
      const inner = col.findIndex((c) => y0 <= c.y && y1 >= c.y + c.h);
      if (inner >= 0) { col[inner].y = y0; col[inner].h = y1 - y0; continue; }       // covers an earlier bar: grow it in place
      col.push(r);
    }
    kept.push(r);
  }
  span.setAttribute('emitted', kept.length);
  const rects = kept.flatMap((r) => { const ink = inkOf(a.faces[r.i], stroke); return ink.kind === 'some' ? [rectNode(r.x, r.y, r.w, r.h, ink.value)] : []; });
  const nodes                  = rects.length > 0 ? [{ kind: 'group', clip, nodes: rects, tag: '' }] : [];   // patches clip to the axes, as lines do
  return { nodes, lines: [], boxes, points: [], paths: [], handle: handleOf(a) };
}

/**
 * fill_between as FillBetweenPolyCollection builds it: [start, (x, y1)…, end, (x, y2) reversed],
 * closed. Vertices go through the same folded affine as lines; Agg fills with the non-zero rule.
 */
export function drawFill(a            , f       , k        , clip      )        {
  const n = Math.min(a.x.length, a.y1.length, a.y2.length);
  const handle = handleOf(a);
  // GraphicsContext defaults for collections: butt caps, round joins
  const stroke                 = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (n === 0 || ink.kind === 'none') return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle };
  // Two code paths in Collection.draw. With edges (a single edge color), the single-path
  // optimization draws the polygon with draw_markers: one "marker" at offset (0, 0), which Agg
  // places at pixel (0, H), its path shifted by (0.5, 0.5) since a curvy polygon doesn't snap.
  // Without edges (edgecolor 'none' is an empty array) it goes through draw_path_collection,
  // i.e. an ordinary path: y = y·(−ay) + (H − cy).
  const asMarker = a.edge.kind === 'on';
  const X = forwardAll(f.xscale, a.x), Y1 = forwardAll(f.yscale, a.y1), Y2 = forwardAll(f.yscale, a.y2);
  const ty0 = asMarker ? -f.cy : f.Hg - f.cy, nay = -f.ay;
  const ptsX           = [X[0] * f.ax + f.cx], ptsY           = [Y2[0] * nay + ty0];
  const push = (x        , y        )       => { ptsX.push(x * f.ax + f.cx); ptsY.push(y * nay + ty0); };
  for (let i = 0; i < n; i++) push(X[i], Y1[i]);
  push(X[n - 1], Y2[n - 1]);
  for (let i = n - 1; i >= 0; i--) push(X[i], Y2[i]);
  // PathSnapper, SNAP_AUTO: a path of ≤ 1024 vertices (with the close) whose segments are all
  // axis-aligned within 1e-4 px snaps to floor(v + 0.5) + (odd rounded stroke width ? 0.5 : 0).
  // An edgeless collection snaps as width 0 (fixtures fill_rect_snap at 100 and 150 dpi). An
  // unsnapped path through draw_markers takes the plain +0.5 shift.
  let rectilinear = ptsX.length + 1 <= 1024;
  for (let i = 1; i < ptsX.length && rectilinear; i++) rectilinear = Math.abs(ptsX[i] - ptsX[i - 1]) < 1e-4 || Math.abs(ptsY[i] - ptsY[i - 1]) < 1e-4;
  const off = a.edge.kind === 'on' ? snapOffset(strokePx(a.edge.widthPt, k)) : 0;
  const fix = (v        )         => (!f.snap ? v : rectilinear ? Math.floor(v + 0.5) + off : asMarker ? v + 0.5 : v);
  const segs        = ptsX.map((x, i)      => [i === 0 ? 'M' : 'L', fix(x), fix(ptsY[i])]);
  segs.push(['Z']);
  const up = new Float64Array(2 * n), xs = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { xs[i] = X[i] * f.ax + f.cx; up[i] = Y1[i] * f.ay + f.cy; xs[n + i] = X[n - 1 - i] * f.ax + f.cx; up[n + i] = Y2[n - 1 - i] * f.ay + f.cy; }
  const node       = asMarker
    ? { kind: 'markers', shape: segs, xs: Float64Array.of(0), ys: Float64Array.of(f.Hg), ink: ink.value }
    : { kind: 'path', segs, ink: ink.value, antialiased: true };
  return { nodes: [{ kind: 'group', clip, nodes: [node], tag: '' }], lines: [{ xs, ys: up }], boxes: [], points: [], paths: [], handle };
}

/** ax.text: position through transData or transAxes (Python-side, then flipped), laid out like Text. */
export function drawText(a            , f       , dpi        , face      )        {
  const k = pxPerPt(dpi);
  const x = a.coords === 'data' ? tx(f, a.x) : a.x * f.box.w + f.box.x0;
  const y = a.coords === 'data' ? tyText(f, a.y) : a.y * -f.box.h + (f.H - f.box.b);
  const layout = measure(a.text, a.sizePt, dpi, face, a.ha);
  const placed = placeLayout(layout, x, y, a.rotation === 0 ? { kind: 'horizontal', ha: a.ha, va: a.va } : { kind: 'angled', deg: a.rotation, ha: a.ha, va: a.va });
  const nodes = a.text === '' ? [] : labelNodes(placed, k, a.color);
  // Legend._auto_legend_data: every Text child's window extent is a loc='best' obstacle (an empty one is a point)
  const yUp = a.coords === 'data' ? forward(f.yscale, a.y) * f.ay + f.cy : a.y * f.box.h + f.box.b;
  const extent = a.text === '' ? { x0: x, y0: yUp, x1: x, y1: yUp }
    : a.rotation === 0 ? windowExtent(layout, x, yUp, a.ha, a.va)
      : { x0: placed.x0, x1: placed.x1, y0: f.H - placed.y1, y1: f.H - placed.y0 };   // the rotated box, flipped as text is
  return { nodes, lines: [], boxes: [extent], points: [], paths: [], handle: none };
}

/**
 * A Wedge (or its Shadow) through Patch.draw: the path's vertices go through the data affine (for a Shadow composed
 * with its translation: c' = a·(o·dpi/72) + c, as np.dot composes the two matrices), flipped as Agg does. A filled
 * path is neither clipped nor snapped (it has curves). loc='best' sees it as a path: Bézier segments flattened in
 * display space (path_intersects_rectangle's conv_curve), every vertex in order, the CLOSEPOLY one included.
 */
export function drawWedge(a             , f       , k        , clip      )        {
  const handle = handleOf(a);
  const p = wedgePath(a.cx, a.cy, a.r, a.theta1, a.theta2, a.width);
  const dpi = k * 72;
  const sx = a.shift.kind === 'some' ? (a.shift.value.oxPt * dpi) / 72 : 0, sy = a.shift.kind === 'some' ? (a.shift.value.oyPt * dpi) / 72 : 0;
  const cx = a.shift.kind === 'some' ? f.ax * sx + f.cx : f.cx, cy = a.shift.kind === 'some' ? f.ay * sy + f.cy : f.cy;
  const X = forwardAll(f.xscale, p.xs), Y = forwardAll(f.yscale, p.ys);
  const n = X.length;
  const segs        = [], up        = [];
  for (let i = 0; i < n; i++) {
    const code = p.codes[i];
    const x = X[i] * f.ax + cx, y = Y[i] * -f.ay + (f.Hg - cy), yu = Y[i] * f.ay + cy;
    if (code === MOVETO) { segs.push(['M', x, y]); up.push(['M', x, yu]); }
    else if (code === LINETO) { segs.push(['L', x, y]); up.push(['L', x, yu]); }
    else if (code === CLOSEPOLY) { segs.push(['Z']); up.push(['L', x, yu]); }
    else if (code === CURVE4) {
      const x2 = X[i + 1] * f.ax + cx, y2 = Y[i + 1] * -f.ay + (f.Hg - cy), x3 = X[i + 2] * f.ax + cx, y3 = Y[i + 2] * -f.ay + (f.Hg - cy);
      segs.push(['C', x, y, x2, y2, x3, y3]);
      up.push(['C', x, yu, x2, Y[i + 1] * f.ay + cy, x3, Y[i + 2] * f.ay + cy]);
      i += 2;
    } else throw new Error(`wedge: unexpected path code ${code}`);
  }
  // _find_best_position: count_contains(path.vertices) (every vertex, control points and CLOSEPOLY's too) plus
  // path.intersects_bbox, which walks the curve-flattened path with its subpaths joined end to end
  const flat = flatten(up, 0, 0);
  const paths       = [{ xs: Float64Array.from(flat.flatMap((s) => s.xs)), ys: Float64Array.from(flat.flatMap((s) => s.ys)) }];
  const points       = [{ xs: Float64Array.from(X, (v) => v * f.ax + cx), ys: Float64Array.from(Y, (v) => v * f.ay + cy) }];
  const stroke                 = a.edge.kind === 'on' && a.edge.widthPt > 0
    ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (ink.kind === 'none') return { nodes: [], lines: [], boxes: [], points, paths, handle };
  return { nodes: [{ kind: 'group', clip, nodes: [pathNode(segs, ink.value)], tag: '' }], lines: [], boxes: [], points, paths, handle };
}

/** ax.annotate: Annotation.draw draws its FancyArrowPatch (ArrowStyle.Simple via the YAArrow emulation), then the text. */
export function drawAnnotation(a                  , f       , W        , dpi        , theme       , k        , clip      )        {
  // _get_xy_transform, in display (y-up) px, one axis at a time (a pair is blended_transform_factory): 'data' is
  // transData; "<ref> <unit>" is Affine2D().scale(unit).translate(*ref.p0), with 'offset' anchored at the annotated point.
  const along = (c                  , v        , axis       , offsetFrom                           )         => {
    if (c.kind === 'data') return axis === 0 ? forward(f.xscale, v) * f.ax + f.cx : forward(f.yscale, v) * f.ay + f.cy;
    const p0 = c.ref === 'figure' ? 0 : c.ref === 'axes' ? (axis === 0 ? f.box.x0 : f.box.b) : offsetFrom[axis];
    const s = c.unit === 'points' ? dpi / 72 : c.unit === 'pixels' ? 1 : c.unit === 'fontsize' ? a.sizePt * dpi / 72
      : c.ref === 'figure' ? (axis === 0 ? W : f.H) : (axis === 0 ? f.box.w : f.box.h);
    return v * s + p0;
  };
  const up0 = (c                     , x        , y        , offsetFrom                           )                            =>
    [along(c.x, x, 0, offsetFrom), along(c.y, y, 1, offsetFrom)];
  const xyUp = up0(a.xycoords, a.x, a.y, [0, 0]);
  const textUp = up0(a.textcoords, a.tx, a.ty, xyUp);
  // Annotation._check_xy (annotation_clip None): with xycoords the string 'data' (not a pair), an annotation draws only
  // while xy is inside the axes (and get_window_extent is then Bbox.unit(), which loc='best' still counts)
  if (!a.xycoords.pair && a.xycoords.x.kind === 'data' && !(xyUp[0] >= f.box.x0 && xyUp[0] <= f.box.x1 && xyUp[1] >= f.box.b && xyUp[1] <= f.box.t)) {
    return { nodes: [], lines: [], boxes: [{ x0: 0, y0: 0, x1: 1, y1: 1 }], points: [], paths: [], handle: none };
  }
  const x1 = textUp[0], y1 = f.H - textUp[1];
  const face = resolveFace(theme.font.families, a.weight);
  const layout = measure(a.text, a.sizePt, dpi, face, a.ha);
  const box = placeLayout(layout, x1, y1, { kind: 'horizontal', ha: a.ha, va: a.va });
  const textNodes = a.text === '' ? [] : labelNodes(box, k, a.color);
  // matplotlib works in y-up display space; Agg flips the arrow path with its int height - y
  const up = (y        )         => f.Hg - y;
  // Text.get_window_extent in y-up display px, computed as matplotlib does (not flipped from the top-left box)
  const bbox = a.text === '' ? { x0: x1, y0: textUp[1], x1, y1: textUp[1] } : windowExtent(layout, textUp[0], textUp[1], a.ha, a.va);
  const extent        = [bbox];
  const arrowNodes = (()                  => {
    if (a.arrow.kind === 'none') return [];
    const ar = a.arrow.value;
    const pieces                        = ar.kind === 'yaarrow'
      ? [{ segs: yaArrowPath(bbox, xyUp, a.text !== '', { widthPt: ar.widthPt, headWidthPt: ar.headWidthPt, headLengthPt: ar.headLengthPt, shrink: ar.shrink, mutationPt: a.sizePt }, k), fillable: true }]
      : styledArrowPaths(bbox, xyUp, a.text !== '', {
        style: ar.style, rad: ar.rad, relpos: ar.relpos, shrinkAPt: ar.shrinkAPt, shrinkBPt: ar.shrinkBPt,
        mutationPt: ar.mutationPt.kind === 'some' ? ar.mutationPt.value : a.sizePt, linewidthPt: ar.linewidthPt,
      }, k);
    // Annotation.get_window_extent counts the compound path of every piece
    extent.push(arrowExtents(pieces.flatMap((pc) => pc.segs)));
    const width = strokePx(ar.linewidthPt, k);
    // FancyArrowPatch: round join and cap; the face only on a fillable path (and not when transparent)
    const stroke                 = ar.linewidthPt > 0 && ar.edge.kind === 'solid' ? some({ color: ar.edge.color, width, cap: 'round', join: 'round', dash: { kind: 'solid' } }) : none;
    return pieces.flatMap((pc)                  => {
      const flipped = pc.segs.map((sg)      => {
        switch (sg.kind) {
          case 'M': return ['M', sg.p[0], up(sg.p[1])];
          case 'L': return ['L', sg.p[0], up(sg.p[1])];
          case 'Q': return ['Q', sg.c[0], up(sg.c[1]), sg.p[0], up(sg.p[1])];
          case 'Z': return ['Z'];
          default: return assertNever(sg);
        }
      });
      // each piece is its own draw_path, snapped by PathSnapper's SNAP_AUTO test (a curve never snaps; an
      // axis-aligned bracket does)
      const segs = f.snap ? snapRectilinear(flipped, snapOffset(width)) : flipped;
      const ink = inkOf(pc.fillable ? ar.face : { kind: 'none' }, stroke);
      return ink.kind === 'some' ? [pathNode(segs, ink.value)] : [];
    });
  })();
  const nodes                  = [{ kind: 'group', clip, nodes: [...arrowNodes, ...textNodes], tag: '' }];
  // Annotation.get_window_extent: Bbox.union of the text's and the arrow patch's, a loc='best' obstacle like any Text
  const union      = { x0: Math.min(...extent.map((b) => b.x0)), y0: Math.min(...extent.map((b) => b.y0)), x1: Math.max(...extent.map((b) => b.x1)), y1: Math.max(...extent.map((b) => b.y1)) };
  return { nodes, lines: [], boxes: [union], points: [], paths: [], handle: none };
}

/** ax.scatter: markers-only collection with sizes in pt^2. */
export function drawScatter(a               , f       , _theme       , k        , clip      )        {
  const n = Math.min(a.x.length, a.y.length);
  const handle = handleOf(a);
  if (n === 0) return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle };
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = tx(f, a.x[i]); ys[i] = ty(f, a.y[i]); }
  const c = a.collection;
  const nodes = collectionNodes(a.shape, xs, ys, c.sizesPt2, c.faces, c.edges, a.edgeWidthPt, k, singlePath(a.shape, c, k, f.W, f.H), f.snap);
  // Legend._auto_legend_data: a Collection's offsets in display space count toward loc='best' (each point inside the box)
  const up = transform(a.x.subarray(0, n), a.y.subarray(0, n), DATA_COORDS, f);
  const out                  = nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [];
  return { nodes: out, lines: [], boxes: [], points: [{ xs: up.xs, ys: up.ysUp }], paths: [], handle };
}

/** Collection.draw's lengths: a lone 'none' colour is to_rgba_array's empty array. */
export const paintCount = (ps                  )         => (ps.length === 1 && ps[0].kind === 'none' ? 0 : ps.length);

/**
 * Collection.draw's single-path optimization (renderer.draw_markers): at most one size, exactly one face and one edge
 * colour, and the scaled marker smaller than the figure. The test is on the collection's lists, not on whether the
 * points happen to look alike: s=[60, 60, 60] is three transforms and goes through draw_path_collection.
 */
export function singlePath(shape            , c                   , k        , W        , H        )          {
  if (c.sizesPt2.length > 1 || paintCount(c.faces) !== 1 || paintCount(c.edges) !== 1) return false;
  const scale = c.sizesPt2.length === 1 ? Math.sqrt(Math.max(0, c.sizesPt2[0])) * k : 1;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const sg of MARKERS[shape].segs) {
    if (sg[0] === 'Z') continue;
    const x = sg[sg.length - 2], y = sg[sg.length - 1];   // on-curve points: every marker's extremes are among them
    if (typeof x === 'number' && typeof y === 'number') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return (x1 - x0) * scale < W && (y1 - y0) * scale < H;
}

/**
 * A PathCollection of one marker path at display offsets (top-left px). `single` is Collection.draw's single-path
 * optimization: one path, size, face and edge colour go through renderer.draw_markers (no snapping, the draw_markers
 * pixel offset). Otherwise RendererAgg::_draw_path_collection_generic: point i takes sizes, faces and edges at i modulo
 * their lengths, its path is scaled by sqrt(s) * dpi / 72 and translated to the exact offset, then filled and stroked.
 */
export function collectionNodes(shape            , xs              , ys              , sizesPt2              , faces                  , edges                  ,
                                edgeWidthPt        , k        , single         , snapOn          = true)                  {
  const n = xs.length;
  if (n === 0 || sizesPt2.length === 0 || faces.length === 0 || edges.length === 0) return [];
  const strokeOf = (edge       )                 =>
    edge.kind === 'solid' && edgeWidthPt > 0 ? some({ color: edge.color, width: strokePx(edgeWidthPt, k), cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
  if (single) {
    const face = faces[0], edge = edges[0];
    if (inkOf(face, strokeOf(edge)).kind === 'none') return [];
    const m = markersNode({ kind: 'on', shape, sizePt: Math.sqrt(Math.max(0, sizesPt2[0])), edgeWidthPt, face, edge }, xs, ys, k, true, snapOn);
    return m.kind === 'some' ? [m.value] : [];
  }
  const members             = [], mx           = [], my           = [], refs           = [];
  for (let i = 0; i < n; i++) {
    if (!(Number.isFinite(xs[i]) && Number.isFinite(ys[i]))) continue;
    const ink = inkOf(MARKERS[shape].filled ? faces[i % faces.length] : { kind: 'none' }, strokeOf(edges[i % edges.length]));
    if (ink.kind === 'none') continue;
    const sizePx = Math.sqrt(Math.max(0, sizesPt2[i % sizesPt2.length])) * k, x = xs[i], y = ys[i];
    const segs = MARKERS[shape].segs.map((sg)      => {
      switch (sg[0]) {
        case 'M': return ['M', x + sg[1] * sizePx, y - sg[2] * sizePx];
        case 'L': return ['L', x + sg[1] * sizePx, y - sg[2] * sizePx];
        case 'Q': return ['Q', x + sg[1] * sizePx, y - sg[2] * sizePx, x + sg[3] * sizePx, y - sg[4] * sizePx];
        case 'C': return ['C', x + sg[1] * sizePx, y - sg[2] * sizePx, x + sg[3] * sizePx, y - sg[4] * sizePx, x + sg[5] * sizePx, y - sg[6] * sizePx];
        case 'Z': return ['Z'];
        default: return assertNever(sg);
      }
    });
    members.push({ kind: 'path', segs: snapOn ? snapRectilinear(segs, snapOffset(strokePx(edgeWidthPt, k))) : segs, ink: ink.value, antialiased: true });
    mx.push(x); my.push(y); refs.push(i % sizesPt2.length);
  }
  if (members.length === 0) return [];
  // draw_path_collection's defs: one path per transform (size), scaled about the offset (y flipped to top-left px)
  const paths = Array.from(sizesPt2, (s2) => {
    const sizePx = Math.sqrt(Math.max(0, s2)) * k;
    return MARKERS[shape].segs.map((sg)      => {
      switch (sg[0]) {
        case 'M': return ['M', sg[1] * sizePx, -sg[2] * sizePx];
        case 'L': return ['L', sg[1] * sizePx, -sg[2] * sizePx];
        case 'Q': return ['Q', sg[1] * sizePx, -sg[2] * sizePx, sg[3] * sizePx, -sg[4] * sizePx];
        case 'C': return ['C', sg[1] * sizePx, -sg[2] * sizePx, sg[3] * sizePx, -sg[4] * sizePx, sg[5] * sizePx, -sg[6] * sizePx];
        case 'Z': return ['Z'];
        default: return assertNever(sg);
      }
    });
  });
  // _iter_collection_uses_per_path: N = max(Npath_ids, Noffsets) members cycle over Npath_ids = max(Npaths, Ntransforms)
  const usesPerPath = Math.ceil(Math.max(sizesPt2.length, n) / sizesPt2.length);
  return [{ kind: 'collection', nodes: members, paths, refs: Uint32Array.from(refs), xs: Float64Array.from(mx), ys: Float64Array.from(my), usesPerPath }];
}

/**
 * _draw_path_collection_generic runs every member path through PathSnapper (check_snap, SNAP_AUTO): a path that
 * snapsAuto lands on floor(v + 0.5) + off, off = 0.5 for an odd rounded gc linewidth, else 0. Anything else (curves,
 * diagonals) passes through untouched. Fixtures scatter_sizes (square markers, lw 1), scatter_markers_paths ('+').
 */
function snapRectilinear(segs                , off        )                 {
  if (!snapsAuto(segs)) return segs;
  const fix = (v        )         => Math.floor(v + 0.5) + off;
  return segs.map((sg)      => (sg[0] === 'M' || sg[0] === 'L' ? [sg[0], fix(sg[1]), fix(sg[2])] : sg));
}

/** axvspan / axhspan: spans in data × axes-fraction coordinates. */
export function drawSpan(a            , f       , k        , clip      )        {
  const stroke                 = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (ink.kind === 'none') return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle: handleOf(a) };
  const off = stroke.kind === 'some' ? snapOffset(stroke.value.width) : 0;
  const sn = (v        )         => (f.snap ? Math.floor(v + 0.5) + off : v);
  if (a.orientation === 'vertical') {
    const x0 = tx(f, a.a0), x1 = tx(f, a.a1);
    const y0 = a.f0 * -f.box.h + (f.Hg - f.box.b), y1 = a.f1 * -f.box.h + (f.Hg - f.box.b);
    const X0 = sn(Math.min(x0, x1)), X1 = sn(Math.max(x0, x1));
    const Y0 = sn(Math.min(y0, y1)), Y1 = sn(Math.max(y0, y1));
    const rect = rectNode(X0, Y0, X1 - X0, Y1 - Y0, ink.value);
    return { nodes: [{ kind: 'group', clip, nodes: [rect], tag: '' }], lines: [], boxes: [], points: [], paths: [], handle: handleOf(a) };
  } else {
    const y0 = ty(f, a.a0), y1 = ty(f, a.a1);
    const x0 = a.f0 * f.box.w + f.box.x0, x1 = a.f1 * f.box.w + f.box.x0;
    const X0 = sn(Math.min(x0, x1)), X1 = sn(Math.max(x0, x1));
    const Y0 = sn(Math.min(y0, y1)), Y1 = sn(Math.max(y0, y1));
    const rect = rectNode(X0, Y0, X1 - X0, Y1 - Y0, ink.value);
    return { nodes: [{ kind: 'group', clip, nodes: [rect], tag: '' }], lines: [], boxes: [], points: [], paths: [], handle: handleOf(a) };
  }
}

/** ax.imshow: rasterise a ScalarMappable to an image node. */
export function drawImage(a             , f       , clip      )        {
  const handle = handleOf(a);
  const cmapR = getColormap(a.cmapName);
  if (!cmapR.ok) return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle };
  const cmap = cmapR.value;
  const norm0 = a.normKind === 'log' ? logNorm(a.vmin, a.vmax) : normalize(a.vmin, a.vmax);
  const norm = autoscaleNorm(norm0, a.values);
  const [L, R, B, T] = a.extent;
  const xs = [tx(f, L), tx(f, R)], ys = [ty(f, B), ty(f, T)];
  const dx0 = Math.min(xs[0], xs[1]), dx1 = Math.max(xs[0], xs[1]);
  const dy0 = Math.min(ys[0], ys[1]), dy1 = Math.max(ys[0], ys[1]);
  const x0 = Math.floor(dx0 + 0.5), x1 = Math.floor(dx1 + 0.5 + 1e-8);
  const y0 = Math.floor(dy0 + 0.5), y1 = Math.floor(dy1 + 0.5 + 1e-8);
  const outW = Math.max(0, x1 - x0), outH = Math.max(0, y1 - y0);
  if (outW === 0 || outH === 0) return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle };
  const dispW = Math.abs(dx1 - dx0), dispH = Math.abs(dy1 - dy0);
  const mode = resolveInterp(a.interpolation, a.cols, a.rows, dispW, dispH);

  const stage = interpolationStage(a.cols, a.rows, dispW, dispH);
  const mid = new Float64Array(a.values.length);
  applyNorm(norm, a.values, mid);
  const { trunc, N } = cmap;
  const rgba = new Uint8Array(outW * outH * 4);
  const xSpan = R - L, ySpan = T - B;
  if (a.channels !== 1) {
    if (mode !== 'nearest') {
      throw new UnsupportedInterpolationError(mode, `RGB(A) images only support nearest so far (got ${mode})`);
    }
    const ch = a.channels;
    const ixCol = new Int32Array(outW), iyRow = new Int32Array(outH);
    for (let ox = 0; ox < outW; ox++) {
      const xData = inverse(f.xscale, (x0 + ox + 0.5 - f.cx) / f.ax);
      let ix = Math.floor(((xData - L) / xSpan) * a.cols - 1e-9);
      if (ix < 0) ix = 0; else if (ix >= a.cols) ix = a.cols - 1;
      ixCol[ox] = ix;
    }
    for (let oy = 0; oy < outH; oy++) {
      const yData = inverse(f.yscale, (f.Hg - (y0 + oy + 0.5) - f.cy) / f.ay);
      const v = a.origin === 'upper' ? ((T - yData) / ySpan) * a.rows : ((yData - B) / ySpan) * a.rows;
      let iy = Math.floor(v - 1e-9);
      if (iy < 0) iy = 0; else if (iy >= a.rows) iy = a.rows - 1;
      iyRow[oy] = iy;
    }
    for (let oy = 0; oy < outH; oy++) {
      const row = iyRow[oy] * a.cols, oRow = oy * outW * 4;
      for (let ox = 0; ox < outW; ox++) {
        const s = (row + ixCol[ox]) * ch, o = oRow + ox * 4;
        rgba[o] = (clip01(a.values[s]) * 255) | 0;
        rgba[o + 1] = (clip01(a.values[s + 1]) * 255) | 0;
        rgba[o + 2] = (clip01(a.values[s + 2]) * 255) | 0;
        const aa = ch === 4 ? clip01(a.values[s + 3]) * a.alpha : a.alpha;
        rgba[o + 3] = (clip01(aa) * 255) | 0;
      }
    }
    const nodeRgb       = { kind: 'image', x: x0, y: y0, w: outW, h: outH, rgba };
    return { nodes: [{ kind: 'group', clip, nodes: [nodeRgb], tag: '' }], lines: [], boxes: [], points: [], paths: [], handle };
  }

  if (mode === 'nearest') {
    // inverse() once per column / row (scales may be log); the inner loop is then a table lookup.
    const ixCol = new Int32Array(outW), iyRow = new Int32Array(outH);
    for (let ox = 0; ox < outW; ox++) {
      const xData = inverse(f.xscale, (x0 + ox + 0.5 - f.cx) / f.ax);
      let ix = Math.floor(((xData - L) / xSpan) * a.cols - 1e-9);
      if (ix < 0) ix = 0; else if (ix >= a.cols) ix = a.cols - 1;
      ixCol[ox] = ix;
    }
    for (let oy = 0; oy < outH; oy++) {
      const yData = inverse(f.yscale, (f.Hg - (y0 + oy + 0.5) - f.cy) / f.ay);
      const v = a.origin === 'upper' ? ((T - yData) / ySpan) * a.rows : ((yData - B) / ySpan) * a.rows;
      let iy = Math.floor(v - 1e-9);
      if (iy < 0) iy = 0; else if (iy >= a.rows) iy = a.rows - 1;
      iyRow[oy] = iy;
    }
    const alpha = a.alpha;
    for (let oy = 0; oy < outH; oy++) {
      const row = iyRow[oy] * a.cols, oRow = oy * outW * 4;
      for (let ox = 0; ox < outW; ox++) {
        const val = mid[row + ixCol[ox]];
        let li        ;
        if (Number.isNaN(val)) li = N + 2;
        else {
          let xa = val * N;
          if (xa === N) xa = N - 1;
          if (xa < 0) li = N; else if (xa >= N) li = N + 1; else li = xa | 0;
        }
        const s = li * 4, o = oRow + ox * 4;
        rgba[o] = trunc[s]; rgba[o + 1] = trunc[s + 1]; rgba[o + 2] = trunc[s + 2];
        rgba[o + 3] = Math.round(trunc[s + 3] * alpha);
      }
    }
  } else if (mode === 'hanning' || mode === 'bilinear') {
    // Affine input(array)→output(buffer): fit from extent + frame (axis-aligned linear axes).
    // array (0,0) and (cols,rows) → display → buffer offset.
    const a0x = tx(f, L), a0y = a.origin === 'upper' ? ty(f, T) : ty(f, B);
    const a1x = tx(f, R), a1y = a.origin === 'upper' ? ty(f, B) : ty(f, T);
    const sx = (a1x - a0x) / a.cols;
    const sy = (a1y - a0y) / a.rows;
    const aff      = { sx, shy: 0, shx: 0, sy, tx: a0x - x0, ty: a0y - y0 };
    if (stage === 'data') {
      // matplotlib: resample raw data, then norm + colormap (not the reverse — float order matters)
      const sampled = new Float64Array(outW * outH);
      resampleAffineFloat(a.values, a.cols, a.rows, sampled, outW, outH, aff, mode);
      const sampledMid = new Float64Array(outW * outH);
      applyNorm(norm, sampled, sampledMid);
      mapBytes(cmap, sampledMid, rgba);
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = Math.round(rgba[i] * a.alpha);
    } else {
      // rgba stage: colormap first, then AGG-resample premultiplied float32 RGBA
      // matplotlib rgba-stage: to_rgba (float LUT), then resample, then bytes=True (trunc)
      const srcRgba = new Float32Array(a.cols * a.rows * 4);
      const fl = requireColormapRgba(cmap);
      for (let i = 0; i < mid.length; i++) {
        const x = mid[i];
        let li        ;
        if (Number.isNaN(x)) li = N + 2;
        else {
          let xa = x * N;
          if (xa === N) xa = N - 1;
          if (xa < 0) li = N; else if (xa >= N) li = N + 1; else li = xa | 0;
        }
        const s = li * 4, o = i * 4;
        const aa = fl[s + 3] * a.alpha;
        srcRgba[o] = fl[s] * aa;
        srcRgba[o + 1] = fl[s + 1] * aa;
        srcRgba[o + 2] = fl[s + 2] * aa;
        srcRgba[o + 3] = aa;
      }
      const outF = new Float32Array(outW * outH * 4);
      resampleAffineRgba(srcRgba, a.cols, a.rows, outF, outW, outH, aff, mode);
      // demultiply + to bytes (matplotlib to_rgba bytes=True, norm=False)
      // matplotlib.colors.to_rgba(…, bytes=True) truncates (astype uint8), does not round
      for (let i = 0; i < outF.length; i += 4) {
        const aa = outF[i + 3];
        const inv = aa !== 0 ? 1 / aa : 1;
        rgba[i] = byteTrunc01(outF[i] * inv);
        rgba[i + 1] = byteTrunc01(outF[i + 1] * inv);
        rgba[i + 2] = byteTrunc01(outF[i + 2] * inv);
        rgba[i + 3] = byteTrunc01(aa);
      }
    }
  } else {
    throw new UnsupportedInterpolationError(String(mode), 'not implemented');
  }
  const node       = { kind: 'image', x: x0, y: y0, w: outW, h: outH, rgba };
  return { nodes: [{ kind: 'group', clip, nodes: [node], tag: '' }], lines: [], boxes: [], points: [], paths: [], handle };
}
