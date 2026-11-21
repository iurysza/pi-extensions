// Legend layout: a port of matplotlib.legend.Legend and the offsetbox packers it
// uses (HPacker / VPacker / TextArea / DrawingArea), including loc='best'.
// Works in Agg display coords (y up); converts to top-left only when emitting nodes.
                                             
import { buildObstacleIndex } from './legend-index.js';
import { lineStroke, markersNode } from './marks.js';
                                    
import { MOVE0 } from './path.js';
import { inkOf, pathNode, rectNode, snapIf, snapOffset } from './scene.js';
import { lpAscent, measure, pxPerPt, strokePx } from './text.js';
import { resolveFace } from './fonts.js';
                                                                                                                                           
import { collectionNodes, singlePath } from './draw-artists.js';
import { assertNever, none, some } from './types.js';
                                          

                                       
                                                                         
                                                                         

const bb = (x0        , y0        , x1        , y1        )      => ({ x0, y0, x1, y1 });
const width = (b     )         => b.x1 - b.x0;
const height = (b     )         => b.y1 - b.y0;

// anchor coefficients for codes 1..10: NE NW SW SE E W E S N C
function anchorCoefs(code            )        {
  switch (code) {
    case 1: return [1, 1];
    case 2: return [0, 1];
    case 3: return [0, 0];
    case 4: return [1, 0];
    case 5: case 7: return [1, 0.5];
    case 6: return [0, 0.5];
    case 8: return [0.5, 0];
    case 9: return [0.5, 1];
    case 10: return [0.5, 0.5];
    default: return assertNever(code);
  }
}
const ANCHORS                        = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// offsetbox._get_packed_offsets, mode 'fixed'
function packedOffsets(sizes                   , sep        )                                                                  {
  const offsets           = [];
  let acc = 0;
  for (const s of sizes) { offsets.push(acc); acc += s + sep; }
  return { total: acc - sep, offsets };
}
// offsetbox._get_aligned_offsets
function alignedOffsets(spans                  , align       )                                                                {
  switch (align) {
    case 'baseline': return { span: [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))], offsets: spans.map(() => 0) };
    case 'left': case 'bottom': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => -s[0]) }; }
    case 'right': case 'top': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => h - s[1]) }; }
    case 'center': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => (h - (s[1] - s[0])) * 0.5 - s[0]) }; }
    default: return assertNever(align);
  }
}
// HPacker._get_bbox_and_child_offsets (pad 0)
function hpack(boxes                , sep        , align       )         {
  const { span: [y0, y1], offsets: yoff } = alignedOffsets(boxes.map((b) => [b.y0, b.y1]), align);
  const { total, offsets } = packedOffsets(boxes.map(width), sep);
  const x0 = boxes[0].x0;
  return { bbox: bb(x0, y0, x0 + total, y1), offsets: offsets.map((o, i) => [o - (boxes[i].x0 - x0), yoff[i]]) };
}
// VPacker._get_bbox_and_child_offsets
function vpack(boxes                , sep        , align       , pad        )         {
  const { span: [x0, x1], offsets: xoff } = alignedOffsets(boxes.map((b) => [b.x0, b.x1]), align);
  const { total, offsets } = packedOffsets(boxes.map(height), sep);
  const yoff = offsets.map((o, i) => total - (o + boxes[i].y1));
  const yd = yoff[0];
  return { bbox: bb(x0 - pad, -yd - pad, x1 + pad, -yd + total + pad), offsets: xoff.map((x, i) => [x, yoff[i] - yd]) };
}
// Bbox.anchored(c, parent.padded(-pad)).p0
function anchoredP0(code            , w        , h        , parent     , pad        )        {
  const [cx, cy] = anchorCoefs(code);
  return [parent.x0 + pad + cx * (width(parent) - 2 * pad - w), parent.y0 + pad + cy * (height(parent) - 2 * pad - h)];
}

                           
                                                                                                                                
                                                                                               
                      
                                          
                         
                                                                                                                                                      
                                                                                                                                         
  
/** `entries[i]`: entry i's handle + label box (display, y up), in input order: what an interactive layer hit-tests. */
                                                                                                                                               

/** Legend._find_best_position over the obstacle index; ties keep the lower code. */
function bestCode(inp             , W        , Hh        , pad        , tracer        )             {
  return tracer.span('legend.best', { lines: inp.lines.length, points: inp.points.length, bboxes: inp.boxes.length }, (sp) => {
    const index = buildObstacleIndex(inp.lines, inp.points, inp.boxes, inp.axesBox.x1 + 1, inp.axesBox.y1 + 1, 16, inp.paths);
    sp.setAttribute('cells', index.cells).setAttribute('segCells', index.segCells);
    let best                                                                  = none;
    for (const code of ANCHORS) {
      const [l, b] = anchoredP0(code, W, Hh, inp.axesBox, pad);
      const limit = best.kind === 'some' ? best.value.badness : Infinity;
      const badness = tracer.span('legend.candidate', { code }, (c) => { const v = index.badness(bb(l, b, l + W, b + Hh), limit); c.setAttribute('badness', v); return v; });
      if (best.kind === 'none' || badness < best.value.badness) best = some({ code, badness });
      if (badness === 0) break;
    }
    const chosen = best.kind === 'some' ? best.value.code : 1;
    sp.setAttribute('chosen', chosen);
    return chosen;
  });
}

export function layoutLegend(inp             , tracer        )               {
  const { theme, dpi, H } = inp;
  const L = theme.legend;
  const k = pxPerPt(dpi);
  const fsPt = inp.fontSizePt, fs = fsPt * k;
  const face = resolveFace(theme.font.families, theme.font.weight);
  // _init_legend_box geometry (points)
  const descentPt = 0.35 * fsPt * (L.handleHeight - 0.7);
  const hHeightPt = fsPt * L.handleHeight - descentPt;
  const hWidthPt = L.handleLength * fsPt;

  const lp = lpAscent(fsPt, dpi, face);
  const items = inp.entries.map((entry) => {
    const m = measure(entry.label, fsPt, dpi, face);
    const textBox = bb(0, -m.descent, m.width, Math.max(lp, m.ascent)); // TextArea.get_bbox, single line
    const handleBox = bb(0, -descentPt * k, hWidthPt * k, (hHeightPt - descentPt) * k);
    return { entry, ...hpack([handleBox, textBox], L.handleTextPad * fsPt * k, 'baseline') };
  });
  // np.array_split into ncols columns
  const n = items.length, base = Math.floor(n / inp.ncols), extra = n % inp.ncols;
  const columns                   = [];
  for (let c = 0, idx = 0; c < inp.ncols; c++) {
    const size = base + (c < extra ? 1 : 0);
    if (size > 0) columns.push(items.slice(idx, idx + size));
    idx += size;
  }
  const colPacks = columns.map((col) => vpack(col.map((i) => i.bbox), L.labelSpacing * fsPt * k, 'baseline', 0));
  const handlePack = hpack(colPacks.map((c) => c.bbox), L.columnSpacing * fsPt * k, 'baseline');
  const legendPack = vpack([handlePack.bbox], L.labelSpacing * fsPt * k, 'center', L.borderPad * fsPt * k);
  const lb = legendPack.bbox, W = width(lb), Hh = height(lb);

  // _findoffset
  const pad = L.borderAxesPad * fs;
  const code             = inp.loc.kind === 'best' ? bestCode(inp, W, Hh, pad, tracer) : inp.loc.code;
  const [l, b] = anchoredP0(code, W, Hh, inp.axesBox, pad);
  const ox = l - lb.x0, oy = b - lb.y0;
  const box = bb(l, b, l + W, b + Hh);

  const tl = (y        )         => H - y, tlG = (y        )         => inp.Hg - y;
  const nodes         = [], entries        = [];
  if (inp.frame) nodes.push(...frameNode(box, fs, theme, k, tlG, inp.snap));
  const [hbx, hby] = legendPack.offsets[0];
  colPacks.forEach((cp, ci) => {
    const [cx, cy] = handlePack.offsets[ci];
    columns[ci].forEach((item, ii) => {
      const [ix, iy] = cp.offsets[ii];
      const bx = ox + hbx + cx + ix, by = oy + hby + cy + iy;
      const [hx, hy] = item.offsets[0], [txo, tyo] = item.offsets[1];
      entries.push(bb(bx + item.bbox.x0, by + item.bbox.y0, bx + item.bbox.x1, by + item.bbox.y1));
      nodes.push(...handleNodes(item.entry.handle, bx + hx, by + hy, { wPt: hWidthPt, hPt: hHeightPt, ydPt: descentPt, fsPt }, inp.markers, theme, k, tlG, inp.W, H, inp.Hg, inp.snap));
      // one node per run: a label that needs font fallback has a run per face
      for (const r of measure(item.entry.label, fsPt, dpi, face).runs) {
        nodes.push({ kind: 'text', text: r.text, x: bx + txo + r.dx, y: tl(by + tyo), dy: 0, sizePx: fs, sizePt: fsPt, glyphs: r.glyphs, face: r.face, color: L.labelColor, rotation: 'horizontal' });
      }
    });
  });
  return { box, code, nodes, entries };
}

// FancyBboxPatch, boxstyle "round,pad=0,rounding_size=0.2" (or "square,pad=0"), snap=True
function frameNode(box     , fs        , theme       , k        , tl                       , snapOn         )                  {
  const L = theme.legend;
  const snap = (v        , w        )         => snapIf(snapOn, v, w);
  const lw = theme.patch.linewidthPt * k;
  const P = (x        , y        )        => [snap(x, lw), snap(tl(y), lw)];
  const stroke         = { color: { hex: L.edge.hex, alpha: L.frameAlpha }, width: lw, cap: 'butt', join: 'miter', dash: { kind: 'solid' } };
  const ink = inkOf({ kind: 'solid', color: { hex: L.face.hex, alpha: L.frameAlpha } }, some(stroke));
  if (ink.kind === 'none') return [];
  const { x0, y0, x1, y1 } = box;
  if (!L.fancy) {
    const q = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
    return [pathNode([['M', ...q[0]], ['L', ...q[1]], ['L', ...q[2]], ['L', ...q[3]], ['Z']], ink.value)];
  }
  const dr = 0.2 * fs;
  const p = [P(x0 + dr, y0), P(x1 - dr, y0), P(x1, y0), P(x1, y0 + dr), P(x1, y1 - dr), P(x1, y1), P(x1 - dr, y1),
             P(x0 + dr, y1), P(x0, y1), P(x0, y1 - dr), P(x0, y0 + dr), P(x0, y0), P(x0 + dr, y0)];
  const segs        = [['M', ...p[0]], ['L', ...p[1]], ['Q', ...p[2], ...p[3]], ['L', ...p[4]], ['Q', ...p[5], ...p[6]],
                       ['L', ...p[7]], ['Q', ...p[8], ...p[9]], ['L', ...p[10]], ['Q', ...p[11], ...p[12]], ['Z']];
  return [pathNode(segs, ink.value)];
}

/** The handle box in points (DrawingArea width, height, ydescent) and the legend font size. */
                                                                                                               

/** numpy.linspace(start, stop, num): i * step + start, the last element exactly stop. */
function linspace(start        , stop        , num        )               {
  const out = new Float64Array(num), step = (stop - start) / (num - 1);
  for (let i = 0; i < num; i++) out[i] = i * step + start;
  if (num > 1) out[num - 1] = stop;
  return out;
}

/** HandlerPathCollection (HandlerRegularPolyCollection, HandlerNpointsYoffsets, HandlerNpoints), in display px. */
function scatterHandle(h                                      , ox        , oy        , a            , m               , k        , tl                       , W        , Hfig        , snapOn         )                  {
  const n = m.scatterPoints;
  // get_sizes: from the collection's own sizes (or [1]), scaled by markerscale ** 2
  const given = h.collection.sizesPt2.length > 0 ? h.collection.sizesPt2 : Float64Array.of(1);
  const scale2 = m.markerScale ** 2;
  // a loop, not Math.max(...given): spreading a per-point array overflows the call stack past ~1e5 sizes
  let gMax = -Infinity, gMin = Infinity;
  for (const s of given) { gMax = Math.max(gMax, s); gMin = Math.min(gMin, s); }
  const sizeMax = gMax * scale2, sizeMin = gMin * scale2;
  const sizes = n < 4 ? Float64Array.from([0.5 * (sizeMax + sizeMin), sizeMax, sizeMin].slice(0, n))
    : linspace(0, 1, n).map((t) => (sizeMax - sizeMin) * t + sizeMin);
  // get_xdata (xdescent 0): one point at the middle, else spread inside a 0.3 * fontsize pad; get_ydata: height * yoffsets
  const xPt = n > 1 ? linspace(0.3 * a.fsPt, a.wPt - 0.3 * a.fsPt, n) : Float64Array.of(0.5 * a.wPt);
  const reps = Math.floor(n / m.scatterYOffsets.length) + 1;
  const yoff = Array.from({ length: reps }, () => m.scatterYOffsets).flat().slice(0, n);
  // offsets through the DrawingArea transform (scale points_to_pixels, then translate); Agg flips y
  const xs = xPt.map((x) => x * k + ox), ys = Float64Array.from(yoff, (f) => tl(a.hPt * f * k + oy));
  const c = { ...h.collection, sizesPt2: sizes };
  return collectionNodes(h.shape, xs, ys, sizes, c.faces, c.edges, h.edgeWidthPt, k, singlePath(h.shape, c, k, W, Hfig), snapOn);
}

/** HandlerLine2D and HandlerErrorbar scale the marker by markerscale (legline_marker.set_markersize). */
const scaled = (mk             , s        )              => (mk.kind === 'on' && s !== 1 ? { ...mk, sizePt: mk.sizePt * s } : mk);

// HandlerLine2D / HandlerPatch inside a DrawingArea whose origin is (ox, oy), y up
function handleNodes(h        , ox        , oy        , area            , mk               , theme       , k        ,
                     tl                       , W        , H        , Hg        , snapOn         )                  {
  const snap = (v        , w        )         => snapIf(snapOn, v, w);
  const wPx = area.wPt * k, hPx = area.hPt * k, ydPx = area.ydPt * k, fsPx = area.fsPt * k;
  switch (h.kind) {
    case 'scatter': return scatterHandle(h, ox, oy, area, mk, k, tl, W, H, snapOn);
    case 'patch': {
      const stroke                 = h.edge.kind === 'on' && h.edge.widthPt > 0
        ? some({ color: h.edge.color, width: strokePx(h.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } })
        : none;
      const lw = stroke.kind === 'some' ? stroke.value.width : 0;
      const ink = inkOf(h.face, stroke);
      if (ink.kind === 'none') return [];
      const x0 = snap(ox, lw), x1 = snap(ox + wPx, lw);
      const yTop = snap(tl(oy - ydPx + hPx), lw), yBot = snap(tl(oy - ydPx), lw);
      return [rectNode(x0, yTop, x1 - x0, yBot - yTop, ink.value)];
    }
    case 'collection': {
      const y = tl(oy + (hPx - ydPx) / 2);
      const s0 = lineStroke(theme, h.color, h.widthPt, h.style, k);
      const s = { ...s0, cap: theme.lines.dashCap, join: theme.lines.dashJoin };
      if (h.widthPt <= 0 || s.color.alpha <= 0) return [];
      const xs = Float64Array.of(ox, ox + wPx).map((v) => snap(v, s.width));
      const ys = Float64Array.of(y, y).map((v) => snap(v, s.width));
      return [{ kind: 'polyline', xs, ys, moves: MOVE0, stroke: s }];
    }
    case 'line': {
      // xdata [0, w], ydata (h - yd) / 2; numpoints = 1: a 3-point line, marker at the middle
      const y = tl(oy + (hPx - ydPx) / 2);
      const out         = [];
      if (h.stroke.kind === 'on') {
        const s = lineStroke(theme, h.stroke.color, h.stroke.widthPt, h.stroke.style, k);
        const xs = Float64Array.of(ox, ox + wPx / 2, ox + wPx).map((v) => snap(v, s.width));
        const ys = Float64Array.of(y, y, y).map((v) => snap(v, s.width));
        if (s.color.alpha > 0) out.push({ kind: 'polyline', xs, ys, moves: MOVE0, stroke: s });
      }
      const markers = scaled(h.markers, mk.markerScale);
      if (markers.kind === 'on') {
        const m = markersNode(markers, Float64Array.of(ox + wPx / 2), Float64Array.of(y), k, false, snapOn);
        if (m.kind === 'some') out.push(m.value);
      }
      return out;
    }
    case 'errorbar': {
      // HandlerErrorbar: bar segments (LineCollections), cap markers, then the data line and its marker
      const e = h.errorbar;
      const yUp = oy + (hPx - ydPx) / 2, xm = ox + 0.5 * wPx, err = 0.5 * fsPx;
      const out         = [];
      const bar = { ...lineStroke(theme, e.bar.color, e.bar.widthPt, e.bar.style, k), cap: 'butt'         , join: 'round'          };
      if (e.hasX) out.push(...segmentNode(xm - err, yUp, xm + err, yUp, bar, e.bar.style === 'solid', Hg, snapOn));
      if (e.hasY) out.push(...segmentNode(xm, yUp - err, xm, yUp + err, bar, e.bar.style === 'solid', Hg, snapOn));
      if (e.caps.kind === 'some') {
        const c = e.caps.value;
        const cap = (shape           , x        , y        )       => {
          const m = markersNode({ kind: 'on', shape, sizePt: c.sizePt, edgeWidthPt: c.edgeWidthPt, face: c.face, edge: c.edge }, Float64Array.of(x), Float64Array.of(tl(y)), k, false, snapOn);
          if (m.kind === 'some') out.push(m.value);
        };
        if (e.hasX) { cap('|', xm - err, yUp); cap('|', xm + err, yUp); }
        if (e.hasY) { cap('_', xm, yUp - err); cap('_', xm, yUp + err); }
      }
      if (e.line.kind === 'some') {
        const ln = e.line.value;
        if (ln.stroke.kind === 'on') {
          const st = lineStroke(theme, ln.stroke.color, ln.stroke.widthPt, ln.stroke.style, k);
          if (st.color.alpha > 0) out.push({ kind: 'polyline', moves: MOVE0, xs: Float64Array.of(ox, ox + wPx).map((v) => snap(v, st.width)), ys: Float64Array.of(tl(yUp), tl(yUp)).map((v) => snap(v, st.width)), stroke: st });
        }
        const markers = scaled(ln.markers, mk.markerScale);
        if (markers.kind === 'on') {
          const m = markersNode(markers, Float64Array.of(xm), Float64Array.of(tl(yUp)), k, false, snapOn);
          if (m.kind === 'some') out.push(m.value);
        }
      }
      return out;
    }
    default: return assertNever(h);
  }
}

/** One LineCollection segment (display y-up endpoints): a solid one goes through draw_markers at pixel
 *  (0, H), a dashed one through draw_path_collection; axis-aligned segments snap either way. */
function segmentNode(x0        , y0        , x1        , y1        , stroke        , single         , H        , snapOn         )                  {
  if (stroke.color.alpha <= 0 || stroke.width <= 0) return [];
  const off = snapOffset(stroke.width);
  const ys = single ? [-y0, -y1] : [H - y0, H - y1];
  const rect = Math.abs(x1 - x0) < 1e-4 || Math.abs(ys[1] - ys[0]) < 1e-4;
  const fix = (v        )         => (!snapOn ? v : rect ? Math.floor(v + 0.5) + off : single ? v + 0.5 : v);
  const segs        = [['M', fix(x0), fix(ys[0])], ['L', fix(x1), fix(ys[1])]];
  return single
    ? [{ kind: 'markers', shape: segs, xs: Float64Array.of(0), ys: Float64Array.of(H), ink: { kind: 'stroke', stroke } }]
    : [pathNode(segs, { kind: 'stroke', stroke })];
}
