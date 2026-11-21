// Layout: FigureSpec -> Scene. Pure; composes the stages:
//   extents (shared across twins) -> view limits -> ticks -> artists -> axes -> spines -> text -> legend -> z-order
                                             
import { dataExtents, unionExtent, viewLimits } from './autoscale.js';
                                                                
import { drawAxis, labelNodes } from './draw-axis.js';
                                               
import { drawAxLine, drawBar, drawFill, drawLine, drawPolygon, drawSegments, drawText, drawScatter, drawSpan, drawAnnotation, drawImage, drawWedge, handleOf } from './draw-artists.js';
                                        
import { axesBox, frame, geomHeight } from './frame.js';
                                         
import { forward } from './scale.js';
import { layoutLegend } from './legend.js';
                                             
import { tickLabelText } from './log.js';
import { inkOf, pathNode, rectNode, snapIf } from './scene.js';
import { lookup } from './std.js';
                                         
import { measure, placeText, pxPerPt, windowExtent } from './text.js';
import { resolveFace } from './fonts.js';
                                          
import { computeTicks, scaleOf, tickSpace } from './ticks.js';
                                                                                                                                                                                                                                    
import { assertNever, none, some } from './types.js';
                                          

const axisZ = (b           )         => {
  switch (b) {
    case 'below': return 0.5;
    case 'line': return 1.5;
    case 'above': return 2.5;
    default: return assertNever(b);
  }
};
/** Axis.get_ticklabels lists only drawn labels: none once label_outer has hidden them. */
const axisMeta = (lim                           , t         , hidden         )           =>
  ({ lim, ticks: t.locs, labels: hidden ? [] : t.labels.map(tickLabelText), offset: t.offset, minor: t.minor, minorLabels: hidden ? [] : t.minorLabels.map(tickLabelText) });

/** A colorbar's short axis: Colorbar sets its ticks (major and minor) to [], so it lists none. */
const shortAxisOf = (role          )                     => {
  switch (role.kind) {
    case 'colorbar': return role.orientation === 'vertical' ? 'x' : 'y';
    case 'primary': case 'twinx': return 'none';
    default: return assertNever(role);
  }
};
const noTicksMeta = (lim                           )           => ({ lim, ticks: [], labels: [], offset: '', minor: [], minorLabels: [] });

// ---------------------------------------------------------------- what a role implies
                                                                                                      
                                                                                                                                                       
const themeSides = (t           )        => ({ near: t.near, far: t.far, labels: t.labelNear ? 'near' : 'none' });

/** label_outer: ticks stay, their labels go. */
const unlabel = (v                , off         )                 => (off && v.kind === 'shown' ? { kind: 'shown', sides: { ...v.sides, labels: 'none' } } : v);

/** twinx(): the twin hides its x axis and patch and ticks its y on the right; the host's y is ticked left only. */
function roleImplies(role          , hasTwin         , theme       , hidden                          )        {
  const r = (()        => {
    switch (role.kind) {
      case 'primary':
        return { x: { kind: 'shown', sides: themeSides(theme.xtick) },
                 y: { kind: 'shown', sides: hasTwin ? { near: true, far: false, labels: 'near' } : themeSides(theme.ytick) },
                 patch: true, yOnRight: false, xOnTop: false };
      case 'twinx':
        return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, patch: false, yOnRight: true, xOnTop: false };
      case 'colorbar':
        // Colorbar._set_ticklocation: set_ticks_position and set_label_position on the long axis; patch on for solids
        switch (role.ticklocation) {
          case 'bottom': return { x: { kind: 'shown', sides: { near: true, far: false, labels: 'near' } }, y: { kind: 'hidden' }, patch: true, yOnRight: false, xOnTop: false };
          case 'top': return { x: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, y: { kind: 'hidden' }, patch: true, yOnRight: false, xOnTop: true };
          case 'right': return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, patch: true, yOnRight: true, xOnTop: false };
          case 'left': return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: true, far: false, labels: 'near' } }, patch: true, yOnRight: false, xOnTop: false };
          default: return assertNever(role.ticklocation);
        }
      default: return assertNever(role);
    }
  })();
  return { ...r, x: unlabel(r.x, hidden.x), y: unlabel(r.y, hidden.y) };
}

/** Each artist's top-level groups carry its provenance, so interactive renderers can find its marks. */
const tagged = (d       , i        , kind        )        =>
  ({ ...d, nodes: d.nodes.map((n)       => (n.kind === 'group' ? { ...n, tag: `artist/${i}/${kind}` } : n)) });
function drawArtists(ax          , f       , theme       , k        , clip      , tracer        )                   {
  return ax.artists.map((a, i) => {
    const c       = a.clip === false ? { kind: 'none' } : clip;
    return tagged(drawArtist(a, f, theme, k, c, tracer), i, a.kind);
  });
}
function drawArtist(a        , f       , theme       , k        , clip      , tracer        )        {
  {
    switch (a.kind) {
      case 'line': return tracer.span('artist.line', { points: a.x.length, stroke: a.stroke.kind, markers: a.markers.kind }, (sp) => drawLine(a, f, theme, k, clip, sp));
      case 'bar': return tracer.span('artist.bar', { rects: a.x.length }, (sp) => drawBar(a, f, k, clip, sp));
      case 'fill': return tracer.span('artist.fill', { points: a.x.length }, () => drawFill(a, f, k, clip));
      case 'text': return tracer.span('artist.text', { text: a.text, coords: a.coords }, () => drawText(a, f, k * 72, resolveFace(theme.font.families, a.weight)));
      case 'scatter': return tracer.span('artist.scatter', { points: a.x.length }, () => drawScatter(a, f, theme, k, clip));
      case 'annotation': return tracer.span('artist.annotation', { }, () => drawAnnotation(a, f, f.W, k * 72, theme, k, clip));
      case 'span': return tracer.span('artist.span', { orientation: a.orientation }, () => drawSpan(a, f, k, clip));
      case 'axline': return tracer.span('artist.axline', { through: a.through.kind }, (sp) => drawAxLine(a, f, theme, k, clip, sp));
      case 'segments': return tracer.span('artist.segments', { segments: a.x0.length }, () => drawSegments(a, f, theme, k, clip));
      case 'polygon': return tracer.span('artist.polygon', { vertices: a.x.length, closed: a.closed }, () => drawPolygon(a, f, k, clip));
      case 'sticky': return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle: none };
      case 'wedge': return tracer.span('artist.wedge', { theta1: a.theta1, theta2: a.theta2, shadow: a.shift.kind === 'some' }, () => drawWedge(a, f, k, clip));
      case 'image': return tracer.span('artist.image', { rows: a.rows, cols: a.cols }, () => drawImage(a, f, clip));
      case 'errorbar': return { nodes: [], lines: [], boxes: [], points: [], paths: [], handle: handleOf(a) };
      default: return assertNever(a);
    }
  }
}

/** Artist.zorder: patches and path/fill collections 1, lines and line collections 2 (or what the artist says), text 3. */
function zorder(a        )         {
  switch (a.kind) {
    case 'bar': case 'fill': case 'span': return 1;
    case 'scatter': case 'image': return a.zorder;
    case 'axline': return 2;
    case 'line': case 'segments': case 'polygon': case 'wedge': return a.zorder;
    case 'text': case 'annotation': case 'errorbar': return 3;
    case 'sticky': return 0;
    default: return assertNever(a);
  }
}

/** A legend entry and the index of the artist it stands for. */
                                                                        
/** _get_legend_handles: Axes children in order, then containers (bars). */
function legendEntries(ax          , drawn                  )                     {
  const children            = [], containers            = [];
  ax.artists.forEach((a, i) => {
    if (a.kind === 'text' || a.kind === 'annotation') return;
    if (a.label.kind === 'none') return;
    const h = drawn[i].handle;
    if (h.kind === 'none') return;
    const e          = { entry: { label: a.label.text, handle: h.value }, artist: i };
    switch (a.kind) {
      // Line2D, patches and collections are Axes children; hist's labelled bar is a child Rectangle
      case 'line': case 'fill': case 'scatter': case 'axline': case 'segments': case 'polygon': case 'wedge': children.push(e); break;
      case 'bar': (a.legend === 'child' ? children : containers).push(e); break;
      case 'span': case 'errorbar': case 'image': containers.push(e); break;
      case 'sticky': break;
      default: assertNever(a);
    }
  });
  return [...children, ...containers];
}

                                                
/**
 * Where a spine's line is (Spine.get_spine_transform): x px for left/right; for bottom/top the y px down, flipped with
 * the text height H (`at`, for tick labels) and with the geometry height Hg (`atG`, for the line and tick marks).
 * 'outward' offsets the axes edge (y down arithmetic, as before); 'axes' is transAxes (w·a + x0, h·a + b); 'data' is
 * transData, where the right/top spine's path sits at 1 and the transform translates by amount − 1.
 */
function spineAt(ax          , side      , f       , k        )                                                                             {
  const b = f.box, p = ax.spines[side].position;
  const vertical = side === 'left' || side === 'right';
  const fromUp = (up        )                                                                             => ({ at: f.H - up, atG: f.Hg - up, up: some(up) });
  if (p.kind === 'none' || p.value.kind === 'outward') {
    const off = p.kind === 'some' && p.value.kind === 'outward' ? p.value.pts * k : 0;
    switch (side) {
      case 'left': return { at: b.x0 - off, atG: b.x0 - off, up: none };
      case 'right': return { at: b.x1 + off, atG: b.x1 + off, up: none };
      case 'bottom': return { at: b.yBot + off, atG: b.yBotG + off, up: none };
      case 'top': return { at: b.yTop - off, atG: b.yTopG - off, up: none };
      default: return assertNever(side);
    }
  }
  const pos = p.value;
  if (pos.kind === 'axes') {
    if (vertical) { const x = b.w * pos.at + b.x0; return { at: x, atG: x, up: none }; }
    return fromUp(b.h * pos.at + b.b);
  }
  const v = side === 'right' || side === 'top' ? 1 + (pos.at - 1) : pos.at;
  if (vertical) { const x = forward(f.xscale, v) * f.ax + f.cx; return { at: x, atG: x, up: none }; }
  return fromUp(forward(f.yscale, v) * f.ay + f.cy);
}

function spinesForAxes(ax          , theme       , f       , k        )                  {
  const baseW = theme.axes.linewidthPt * k, b = f.box;
  const snap = (v        , w        )         => snapIf(f.snap, v, w);
  const sides                                                                                                       = [];
  const ov = ax.spines;
  const sideOn = (side                                     )          => ov[side].visible;
  const wOf = (side                                     )         => {
    const wPt = ov[side].widthPt.kind === 'some' ? ov[side].widthPt.value : theme.axes.linewidthPt;
    return wPt * k;
  };
  const colorOf = (side                                     )      => (ov[side].color.kind === 'some' ? ov[side].color.value : theme.axes.edge);
  // Compute snapped positions per side, with optional outward offsets
  if (sideOn('left')) {
    const w = wOf('left');
    const x = snap(spineAt(ax, 'left', f, k).atG, w), y0 = snap(b.yBotG, w), y1 = snap(b.yTopG, w);
    sides.push({ side: 'left', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('right')) {
    const w = wOf('right');
    const x = snap(spineAt(ax, 'right', f, k).atG, w), y0 = snap(b.yBotG, w), y1 = snap(b.yTopG, w);
    sides.push({ side: 'right', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('bottom')) {
    const w = wOf('bottom');
    const y = snap(spineAt(ax, 'bottom', f, k).atG, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
    sides.push({ side: 'bottom', x0, y0: y, x1, y1: y });
  }
  if (sideOn('top')) {
    const w = wOf('top');
    const y = snap(spineAt(ax, 'top', f, k).atG, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
    sides.push({ side: 'top', x0, y0: y, x1, y1: y });
  }
  const nodes         = [];
  for (const s of sides) {
    const w = Math.max(baseW, wOf(s.side));   // at least theme width; overrides can widen
    if (w <= 0) continue;
    const stroke         = { color: colorOf(s.side), width: w, cap: 'square', join: 'miter', dash: { kind: 'solid' } };
    nodes.push(pathNode([[ 'M', s.x0, s.y0 ], [ 'L', s.x1, s.y1 ]], { kind: 'stroke', stroke }));
  }
  return nodes;
}

                                                                                                                                                                

/** What each decoration occupies, for Axes.get_tightbbox. An empty Text's extent is a point,
 *  which Axis.get_tightbbox drops (Bbox._is_finite), so empty labels take no room. */
                  
                                                             
                                                                                                  
                                   
                                                                                   
                                        
  
/** x and y: each Axis' offset text and label, drawn with that Axis (its zorder, after its ticks); title: the Axes title (zorder 3). */
                                                                                                                                          
/** for_layout_only: an x label keeps 1 px of its width, a y label 1 px of its height (centred) */
const collapseX = (b       )        => (b.x1 > b.x0 ? { ...b, x0: (b.x0 + b.x1) / 2 - 0.5, x1: (b.x0 + b.x1) / 2 + 0.5 } : b);
const collapseY = (b       )        => (b.y1 > b.y0 ? { ...b, y0: (b.y0 + b.y1) / 2 - 0.5, y1: (b.y0 + b.y1) / 2 + 0.5 } : b);
const optBox = (o               , adjust                        = (box) => box)                   => (o.kind === 'some' ? [adjust(o.value)] : []);
export const unionBox = (bs                  )        => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

const edges = (e                                              )          => ({ b: e.y0, t: e.y1 });
/** A tight bbox from its parts; a part's display y-up edge, when known in matplotlib's arithmetic, wins over H − y. */
                                                               
const flip = (H        ) => (box       )            => ({ box, up: { b: H - box.y1, t: H - box.y0 } });
function tightOf(parts                      )           {
  const u = unionBox(parts.map((p) => p.box));
  return { ...u, b: Math.min(...parts.map((p) => p.up.b)), t: Math.max(...parts.map((p) => p.up.t)) };
}

/** Offset texts, axis labels, title (Axis._update_label_position / _update_offset_text_position). */
function decorations(ax          , roles       , theme       , f       , k        , dpi        , sp                                                                                                      , xt         , yt         , xb         , yb         )            {
  const b = f.box, A = theme.axes, xOut         = [], yOut         = [], titleOut         = [];
  let out = xOut;
  const half = A.linewidthPt * k / 2;
  const put = (s        , x        , y        , p           , sizePt        , color     , weight         = theme.font.weight)                => {
    if (s === '') return none;
    const tb = placeText(s, sizePt, dpi, resolveFace(theme.font.families, weight), x, y, p);
    out.push(...labelNodes(tb, k, color));
    return some({ x0: tb.x0, y0: tb.y0, x1: tb.x1, y1: tb.y1 });
  };
  const pad = theme.offsetTextPadPt * k, lp = A.labelPadPt * k;
  const xBoxes          = [], yBoxes          = [], xUp            = [];
  // the same text's bottom edge in display y-up: XAxis._update_{offset_text,label}_position anchor it at
  // union(tick labels, spine).y0 − pad·dpi/72, then Text.get_window_extent (va='top')
  const bottomUp = (s        , x        , padPt        , ha        , sizePt        , weight        )          =>
    edges(windowExtent(measure(s, sizePt, dpi, resolveFace(theme.font.families, weight), ha), x, Math.min(f.H - (sp.yBottom + half), ...xb.nearUp.map((e) => e.b)) - padPt * dpi / 72, ha, 'top'));
  // the top twin of bottomUp: union(top tick labels, spine).y1 + pad·dpi/72; set_label_position('top') makes the label
  // va='baseline', set_ticks_position('top') the offset text va='bottom'
  const topUp = (s        , x        , from        , padPt        , ha        , va                       , sizePt        , weight        )          =>
    edges(windowExtent(measure(s, sizePt, dpi, resolveFace(theme.font.families, weight), ha), x, from + padPt * dpi / 72, ha, va));
  if (roles.x.kind === 'shown' && roles.xOnTop) {
    // the label sits above union(top tick labels, top spine); the offset text above the tick labels (else the axes top)
    let top = sp.yTop - half;
    for (const lb of xb.far) top = Math.min(top, lb.y0);
    const topLabelsUp = Math.max(f.H - (sp.yTop - half), ...xb.farUp.map((e) => e.t));
    const offFrom = xb.far.length > 0 ? Math.min(...xb.far.map((lb) => lb.y0)) : b.yTop;
    const offFromUp = xb.farUp.length > 0 ? Math.max(...xb.farUp.map((e) => e.t)) : b.t;
    if (!ax.hiddenLabels.x) {
      const o = optBox(put(xt.offset, b.x1, offFrom - pad, { kind: 'horizontal', ha: 'right', va: 'bottom' }, theme.xtick.labelSizePt, theme.xtick.color));
      xBoxes.push(...o);
      if (o.length > 0) xUp.push(topUp(xt.offset, b.x1, offFromUp, theme.offsetTextPadPt, 'right', 'bottom', theme.xtick.labelSizePt, theme.font.weight));
    }
    const l = optBox(put(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, top - lp, { kind: 'horizontal', ha: 'center', va: 'baseline' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseX);
    xBoxes.push(...l);
    if (l.length > 0) xUp.push(topUp(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, topLabelsUp, A.labelPadPt, 'center', 'baseline', A.labelSizePt, theme.font.labelWeight));
  } else if (roles.x.kind === 'shown') {
    // the bottom spine's extent (where set_position put it) joins the tick labels'
    let bottom = sp.yBottom + half;
    for (const lb of xb.near) bottom = Math.max(bottom, lb.y1);
    if (!ax.hiddenLabels.x) {
      const o = optBox(put(xt.offset, b.x1, bottom + pad, { kind: 'horizontal', ha: 'right', va: 'top' }, theme.xtick.labelSizePt, theme.xtick.color));
      xBoxes.push(...o);
      if (o.length > 0) xUp.push(bottomUp(xt.offset, b.x1, theme.offsetTextPadPt, 'right', theme.xtick.labelSizePt, theme.font.weight));
    }
    const l = optBox(put(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, bottom + lp, { kind: 'horizontal', ha: 'center', va: 'top' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseX);
    xBoxes.push(...l);
    if (l.length > 0) xUp.push(bottomUp(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, A.labelPadPt, 'center', A.labelSizePt, theme.font.labelWeight));
  }
  out = yOut;
  if (roles.yOnRight) {
    let right = sp.xRight + half;
    for (const lb of yb.far) right = Math.max(right, lb.x1);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x1, b.yTop - pad, { kind: 'horizontal', ha: 'right', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, right + lp, b.yTop + (b.yBot - b.yTop) / 2, { kind: 'ylabelRight' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  } else {
    let left = sp.xLeft - half;
    for (const lb of yb.near) left = Math.min(left, lb.x0);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x0, b.yTop - pad, { kind: 'horizontal', ha: 'left', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, left - lp, b.yTop + (b.yBot - b.yTop) / 2, { kind: 'ylabel' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  }
  // Axes.get_children: title, _left_title, _right_title (all zorder 3, drawn in that order)
  out = titleOut;
  const T = ax.titles;
  const titleParts = ([['center', T.center], ['left', T.left], ['right', T.right]]         ).flatMap(([loc, t])              => {
    // Agg BboxTransform: x0 + frac*w. (x0+x1)/2 is 1 ulp off when x0+x1 is not dyadic (shifts FreeType 26.6 half-pen).
    const tx0 = loc === 'left' ? b.x0 : loc === 'right' ? b.x1 : b.x0 + (b.x1 - b.x0) / 2;
    // transAxes + ScaledTranslation(0, pad/72): (x, y) maps to h·y + (b + pad/72·dpi). Agg flips after the pad: at the
    // top (y = 1) H - (bbox.t + pad), since yTop - pad is 1 ulp off when t*H is not dyadic.
    const yDraw = t.y === 1 ? f.H - (b.t + T.padPt * k) : f.H - (b.h * t.y + (b.b + T.padPt * k));
    const tb = put(t.text, tx0, yDraw, { kind: 'horizontal', ha: loc, va: 'baseline' }, t.sizePt, t.color, t.weight);
    if (tb.kind !== 'some') return [];
    // the title's top in display y-up (moved above top tick labels, it has no exact form here: fall back to the flipped box)
    const up          = xb.far.length > 0 ? { b: f.H - tb.value.y1, t: f.H - tb.value.y0 }
      : edges(windowExtent(measure(t.text, t.sizePt, dpi, resolveFace(theme.font.families, t.weight), loc), tx0, b.h * t.y + (b.b + (T.padPt / 72) * dpi), loc, 'baseline'));
    // Axes.get_tightbbox keeps 1 px of a title's width; zero-size boxes (empty titles) drop out
    return [{ box: collapseX(tb.value), up }];
  });
  return { x: xOut, y: yOut, title: titleOut, boxes: { x: xBoxes, y: yBoxes, xUp, titles: titleParts } };
}

/** Spine.get_window_extent: the spine's path, padded by the ticks it carries (not their labels). */
function spineBoxes(ax          , roles       , f       , k        , xt         , yt         )                   {
  const b = f.box, ov = ax.spines;
  const pads = (tt           , minor         )                                                 => {
    const size = (minor ? tt.minorSizePt : tt.sizePt) * k;
    switch (tt.direction) {
      case 'out': return { out: size, inn: 0 };
      case 'in': return { out: 0, inn: size };
      case 'inout': return { out: size / 2, inn: size / 2 };
      default: return assertNever(tt.direction);
    }
  };
  const boxes          = [];
  const spine = (side                                     , vis                , ticks         , tt           )       => {
    if (!ov[side].visible) return;
    const at = spineAt(ax, side, f, k).at;
    const line        = side === 'left' || side === 'right' ? { x0: at, x1: at, y0: b.yTop, y1: b.yBot } : { x0: b.x0, x1: b.x1, y0: at, y1: at };
    boxes.push(line);
    if (vis.kind !== 'shown') return;
    const near = side === 'left' || side === 'bottom';
    if (!(near ? vis.sides.near : vis.sides.far)) return;
    for (const minor of [false, true]) {
      if (!ticks.visible.some((t) => t.minor === minor)) continue;
      const p = pads(tt, minor);
      switch (side) {
        case 'left': boxes.push({ ...line, x0: line.x0 - p.out, x1: line.x1 + p.inn }); break;
        case 'right': boxes.push({ ...line, x0: line.x0 - p.inn, x1: line.x1 + p.out }); break;
        case 'bottom': boxes.push({ ...line, y0: line.y0 - p.inn, y1: line.y1 + p.out }); break;
        case 'top': boxes.push({ ...line, y0: line.y0 - p.out, y1: line.y1 + p.inn }); break;
        default: assertNever(side);
      }
    }
  };
  // the y axis sits on the right for a twin: its spines' axis is still the y axis
  spine('left', roles.yOnRight ? { kind: 'hidden' } : roles.y, yt, ax.tick.y);
  spine('right', roles.y, yt, ax.tick.y);
  spine('bottom', roles.x, xt, ax.tick.x);
  spine('top', roles.x, xt, ax.tick.x);
  return boxes;
}

const NOTHING            = { grid: [], marks: [], nearBoxes: [], farBoxes: [], nearUp: [], farUp: [] };
function shown(v                , draw                             )            {
  switch (v.kind) {
    case 'hidden': return NOTHING;
    case 'shown': return draw(v.sides);
    default: return assertNever(v);
  }
}

/** The shared x axis of a twin group, planned once and applied to every member. */
                                                                                                            
                                                                                                           

/**
 * One axis of a share group (sharex/sharey, twinx): autoscale_view over the union of the siblings' data
 * limits, and the shared locator, whose tick space is its own (the leader's) axis length.
 */

/** Shrink `position` to physical aspect `boxAspect` (= height/width in display units), anchored at [ax,ay]. */
function shrinkToBoxAspect(position          , boxAspect        , figW        , figH        , anchor                           )           {
  const figAspect = figH / figW;
  const [l, b, r, top] = position;
  const w = r - l, h = top - b;
  const Htry = w * boxAspect / figAspect;
  let W        , HH        ;
  if (Htry <= h) { W = w; HH = Htry; } else { W = h * figAspect / boxAspect; HH = h; }
  // Bbox([p0, p0 + (W, H)]).anchored(anchor, container): its bounds (x1 − x0) and the shift, as matplotlib rounds them
  const x1 = l + W, y1 = b + HH, Ws = x1 - l, Hs = y1 - b;
  const dx = (l + anchor[0] * (w - Ws)) - l, dy = (b + anchor[1] * (h - Hs)) - b;
  return [l + dx, b + dy, x1 + dx, y1 + dy];
}

/** matplotlib.colorbar._ColorbarAxesLocator: shrink axes for triangular/rectangular extends. */
function applyColorbarExtend(position          , role                  , ext                            )           {
  if (ext.kind === 'none' || role.kind !== 'colorbar') return position;
  const [l, b, r, t] = position;
  const w = r - l, h = t - b;
  const len = 1 + ext.value.lower + ext.value.upper;
  const shrink = 1 / len, offset = ext.value.lower / len;
  if (role.orientation === 'vertical') {
    const hh = h * shrink;
    return [l, b + offset * h, r, b + offset * h + hh];
  }
  const ww = w * shrink;
  return [l + offset * w, b, l + offset * w + ww, t];
}

/** Bbox.shrunk_to_aspect + anchored: data aspect (adjustable='box') and/or set_box_aspect. */
function applyAspect(position          , aspect                    , boxAspect                       ,
                     anchor                           ,
                     xlim                           , ylim                           ,
                     xscale       , yscale       , figW        , figH        )           {
  // matplotlib: box_aspect is applied first (when set), then data aspect if not 'auto'.
  let pos = position;
  if (boxAspect.kind === 'some') pos = shrinkToBoxAspect(pos, boxAspect.value, figW, figH, anchor);
  if (aspect.kind === 'auto') return pos;
  const ratio = aspect.kind === 'equal' ? 1 : aspect.value;
  const tx0 = forward(xscale, xlim[0]), tx1 = forward(xscale, xlim[1]);
  const ty0 = forward(yscale, ylim[0]), ty1 = forward(yscale, ylim[1]);
  const xsize = Math.max(Math.abs(tx1 - tx0), 1e-30);
  const ysize = Math.max(Math.abs(ty1 - ty0), 1e-30);
  const dataBoxAspect = ratio * (ysize / xsize);
  return shrinkToBoxAspect(pos, dataBoxAspect, figW, figH, anchor);
}

function planAxis(which           , leader          , extent        , fig            , tracer        )         {
  const theme = fig.theme, dpi = fig.dpi;
  const box = axesBox(leader.position, fig.widthIn * dpi, fig.heightIn * dpi);
  const spec = which === 'x' ? leader.x : leader.y;
  const sc = scaleOf(spec);
  const lim = tracer.span(`limits.${which}`, { mode: spec.limits.kind, scale: sc.kind }, () => viewLimits(spec, sc, extent, which === 'x' ? theme.axes.xmargin : theme.axes.ymargin));
  const ticks = tracer.span(`ticks.${which}`, { axis: spec.kind, scale: sc.kind, ticks: spec.ticks.kind, labels: spec.labels.kind },
    (sp) => {
      const t = computeTicks(spec, lim, tickSpace(which, which === 'x' ? box.w : box.h, dpi, which === 'x' ? theme.xtick.labelSizePt : theme.ytick.labelSizePt), theme, extent.minpos);
      sp.setAttribute('major', t.locs.length).setAttribute('minor', t.minor.length).setAttribute('offset', t.offset); return t;
    });
  return { lim, ticks, minpos: extent.minpos };
}

/** 'scene' lays out everything; 'tight' (tight_layout's measuring pass) needs only each Axes' tight bbox, which
 *  no artist enters except through a loc='best' legend's placement, so it draws artists only for that. */
                                    

/**
 * What an annotated (interactive) SVG needs from layout, per Axes: how many top-level scene nodes it drew (an
 * Axes' nodes are contiguous in Scene.nodes), its exact data → px frame, and each legend entry's box (px, y down)
 * with the index of the artist it stands for.
 */
                                                                                                                                                        
                                                                                                        

function layoutAxes(inp        , fig            , mode            , dev        , tracer        )           {
  const { ax } = inp;
  const theme = fig.theme, dpi = fig.dpi, k = pxPerPt(dpi);
  const W = fig.widthIn * dpi, H = fig.heightIn * dpi;
  const Hg = geomHeight(H, dev);
  const box = axesBox(ax.position, W, H, Hg);
  const roles = roleImplies(ax.role, inp.hasTwin, theme, ax.hiddenLabels);
  const xs = scaleOf(ax.x), ys = scaleOf(ax.y);

  const xlim = inp.x.lim, ylim = inp.y.lim;
  const xt = inp.x.ticks, yt = inp.y.ticks;
  const f = frame(box, W, H, dev, xlim, ylim, xs, ys);
  const clip       = { kind: 'rect', x: box.x0, y: box.yTopG, w: box.w, h: box.h };

  // _AxesBase.draw: the axes patch and the spines draw only when the frame is on (set_frame_on)
  const face = roles.patch && ax.frameOn ? inkOf(theme.axes.face, none) : none;
  // The axes patch is a rectilinear, edgeless path: Agg snaps its corners to whole pixels (snap value 0).
  // (matplotlib's SVG backend draws it unsnapped)
  const bx0 = snapIf(f.snap, box.x0, 0), bx1 = snapIf(f.snap, box.x1, 0), by0 = snapIf(f.snap, box.yTopG, 0), by1 = snapIf(f.snap, box.yBotG, 0);
  const background                  = face.kind === 'some' ? [rectNode(bx0, by0, bx1 - bx0, by1 - by0, face.value)] : [];
  const undrawn = ()                   => ax.artists.map((a)        => ({ nodes: [], lines: [], boxes: [], points: [], paths: [], handle: handleOf(a) }));
  const needArtists = mode === 'scene' || (ax.legend.kind === 'on' && ax.legend.loc.kind === 'best' && legendEntries(ax, undrawn()).length > 0);
  const drawn = needArtists ? tracer.span('artists', { count: ax.artists.length }, () => drawArtists(ax, f, theme, k, clip, tracer)) : undrawn();
  const userTexts = drawn.flatMap((d, i) => (zorder(ax.artists[i]) === 3 ? d.nodes : []));
  const artistLayers = drawn.flatMap((d, i)                                         => { const z = zorder(ax.artists[i]); return z === 3 ? [] : [[z, d.nodes]]; });
  // Spine outward offsets move the axis baseline (ticks and labels follow)
  const at = (side      ) => spineAt(ax, side, f, k);
  const baseX = { xLeft: at('left').at, xRight: at('right').at };
  const baseY = { yBottom: at('bottom').at, yTop: at('top').at };
  const baseYG = { yBottomG: at('bottom').atG, yTopG: at('top').atG, yBottomUp: at('bottom').up, yTopUp: at('top').up };
  const bases = { ...baseX, ...baseY, ...baseYG };
  const xa = shown(roles.x, (sides) => tracer.span('axis.x', { ticks: xt.visible.length }, () =>
    drawAxis('x', xt, ax.tick.x, sides, ax.grid.x, ax.tickLabels.x, f, theme, dpi, tracer, bases)));
  const ya = shown(roles.y, (sides) => tracer.span('axis.y', { ticks: yt.visible.length, side: roles.yOnRight ? 'right' : 'left' }, () =>
    drawAxis('y', yt, ax.tick.y, sides, ax.grid.y, ax.tickLabels.y, f, theme, dpi, tracer, bases)));
  const decTheme        = { ...theme, xtick: ax.tick.x, ytick: ax.tick.y };
  const deco = tracer.span('decorations', { role: ax.role.kind }, () =>
    decorations(ax, roles, decTheme, f, k, dpi, bases, xt, yt, { near: xa.nearBoxes, far: xa.farBoxes, nearUp: xa.nearUp, farUp: xa.farUp }, { near: ya.nearBoxes, far: ya.farBoxes, nearUp: ya.nearUp, farUp: ya.farUp }));

  const sourced = legendEntries(ax, drawn), entries = sourced.map((e) => e.entry);
  const axesUp      = { x0: box.x0, x1: box.x1, y0: box.b, y1: box.t };
  const spec = ax.legend;
  const legend = spec.kind === 'on' && entries.length > 0
    ? some({ code: spec.loc, out: tracer.span('legend', { entries: entries.length }, () => layoutLegend({
        entries, theme, dpi, W, H, Hg, snap: f.snap, axesBox: axesUp, lines: drawn.flatMap((d) => d.lines), points: drawn.flatMap((d) => d.points), paths: drawn.flatMap((d) => d.paths), boxes: drawn.flatMap((d) => d.boxes),
        loc: spec.loc, ncols: spec.ncols, frame: spec.frame, fontSizePt: spec.fontSizePt, markers: spec.markers }, tracer)) })
    : none;

  // Gridlines clip to the axes like every artist; each Axis draws as a unit (x, then y).
  const clipped = (ns                 )                  => (ns.length > 0 ? [{ kind: 'group', clip, nodes: ns, tag: '' }] : []);
  // z-order: patches 1, axis (grid/ticks) per axisbelow, lines 2, spines 2.5, text 3, legend 5. The sort is
  // stable and ties keep matplotlib's get_children order (children, spines, then the axes), which
  // matters for axisbelow=False: the axis (2.5) then draws over the spines (2.5).
  const layers                                                    = [
    ...artistLayers, [2.5, ax.frameOn ? spinesForAxes(ax, theme, f, k) : []],
    // Axis.draw: gridlines, ticks and tick labels, then the offset text and the axis label
    [axisZ(theme.axes.axisBelow), [...clipped(xa.grid), ...xa.marks, ...deco.x, ...clipped(ya.grid), ...ya.marks, ...deco.y]],
    [3, [...userTexts, ...deco.title]], [5, legend.kind === 'some' ? legend.value.out.nodes : []],
  ];
  const nodes = [...background, ...layers.toSorted((a, b) => a[0] - b[0]).flatMap(([, n]) => n)];
  const legendBoxes = legend.kind === 'some'
    ? legend.value.out.entries.map((e, j) => ({ artist: sourced[j].artist, box: { x0: e.x0, x1: e.x1, y0: Hg - e.y1, y1: Hg - e.y0 } })) : [];
  return {
    nodes,
    annot: { nodes: nodes.length, frame: f, legend: legendBoxes },
    meta: {
      x: shortAxisOf(ax.role) === 'x' ? noTicksMeta(xlim) : axisMeta(xlim, xt, ax.hiddenLabels.x),
      y: shortAxisOf(ax.role) === 'y' ? noTicksMeta(ylim) : axisMeta(ylim, yt, ax.hiddenLabels.y),
      frame: { box: { x0: box.x0, x1: box.x1, yTop: box.yTop, yBot: box.yBot }, xlim, ylim, xscale: xs, yscale: ys, H },
      tight: tightOf([
        { box: { x0: box.x0, y0: box.yTop, x1: box.x1, y1: box.yBot }, up: { b: box.b, t: box.t } },
        // the axes patch (a default bbox extra artist) maps the unit square through transAxes: its top is h·1 + b
        ...(roles.patch ? [{ box: { x0: box.x0, y0: box.yTop, x1: box.x1, y1: box.yBot }, up: { b: box.h * 0 + box.b, t: box.h * 1 + box.b } }] : []),
        ...(roles.x.kind === 'shown' ? [
          ...xa.nearBoxes.map((bx, i) => ({ box: bx, up: xa.nearUp[i] })), ...xa.farBoxes.map((bx, i) => ({ box: bx, up: xa.farUp[i] })),
          ...deco.boxes.x.map((bx, i) => ({ box: bx, up: deco.boxes.xUp[i] }))] : []),
        ...(roles.y.kind === 'shown' ? [
          ...ya.nearBoxes.map((bx, i) => ({ box: bx, up: ya.nearUp[i] })), ...ya.farBoxes.map((bx, i) => ({ box: bx, up: ya.farUp[i] })),
          ...deco.boxes.y.map(flip(H))] : []),
        ...deco.boxes.titles,
        // get_default_bbox_extra_artists drops the spines when the frame is off
        ...(ax.frameOn ? spineBoxes(ax, roles, f, k, xt, yt).map(flip(H)) : []),
        ...(legend.kind === 'some' ? [{ box: { x0: legend.value.out.box.x0, x1: legend.value.out.box.x1, y0: H - legend.value.out.box.y1, y1: H - legend.value.out.box.y0 },
                                        up: { b: legend.value.out.box.y0, t: legend.value.out.box.y1 } }] : []),
      ]),
      legend: legend.kind === 'some'
        ? some({ loc: legend.value.code.kind === 'best' ? 0 : legend.value.code.code, x0: legend.value.out.box.x0, x1: legend.value.out.box.x1,
                 top: H - legend.value.out.box.y1, bottom: H - legend.value.out.box.y0 })
        : none,
    },
  };
}

/** Axes i's twin group: its host and every twinx of that host. */
function twinGroup(axes                     , i        )                    {
  const root = (j        )         => { const r = axes[j].role; return r.kind === 'twinx' ? r.host : j; };
  const host = root(i);
  return axes.map((_, j) => j).filter((j) => root(j) === host);
}

/** Window extents (px, y down) of the suptitle and the supx/supylabels, where present. */
export function supBoxes(fig            )                                                                                          {
  const W = fig.widthIn * fig.dpi, H = fig.heightIn * fig.dpi;
                                    
  const place = (o     , vertical         )                => {
    if (o.kind !== 'some') return none;
    const s = o.value;
    const b = placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), s.x * W, H - s.y * H,
      vertical ? { kind: 'vertical', ha: s.ha, va: s.va } : { kind: 'horizontal', ha: s.ha, va: s.va });
    return some({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  };
  return { title: place(fig.suptitle, false), x: place(fig.supx, false), y: place(fig.supy, true) };
}

function layoutParts(fig            , mode            , dev        , tracer        )                      {
  const ext = fig.axes.map((ax) => tracer.span('datalimits', { artists: ax.artists.length }, (sp) => {
    const e = dataExtents(ax.artists); sp.setAttribute('values', e.x.count + e.y.count); return e;
  }));
  const Wpx = fig.widthIn * fig.dpi, Hpx = fig.heightIn * fig.dpi;
  // Limits first (no box size needed), then apply_aspect to each Axes' position, then ticks on the adjusted box.
                                                                                  
  const limsX        = [];
  const limsY        = [];
  const limCache = new Map             ();
  const limitsOf = (which           , i        )      => {
    const lead = which === 'x' ? fig.axes[i].xShare : fig.axes[i].yShare;
    const key = `${which}${lead}`;
    const found = lookup(limCache, key);
    if (found.kind === 'some') return found.value;
    const group = fig.axes.map((_, j) => j).filter((j) => (which === 'x' ? fig.axes[j].xShare : fig.axes[j].yShare) === lead);
    const leader = fig.axes[lead];
    const spec = which === 'x' ? leader.x : leader.y;
    const sc = scaleOf(spec);
    const extent = unionExtent(group.map((j) => ext[j][which]));
    const lim = viewLimits(spec, sc, extent, which === 'x' ? fig.theme.axes.xmargin : fig.theme.axes.ymargin);
    const L      = { lim, minpos: extent.minpos };
    limCache.set(key, L);
    return L;
  };
  for (let i = 0; i < fig.axes.length; i++) { limsX.push(limitsOf('x', i)); limsY.push(limitsOf('y', i)); }
  const adjusted             = fig.axes.map((ax, i) => {
    const afterExt = applyColorbarExtend(ax.position, ax.role, ax.colorbarExtend);
    const pos = applyAspect(afterExt, ax.aspect, ax.boxAspect, ax.anchor, limsX[i].lim, limsY[i].lim, scaleOf(ax.x), scaleOf(ax.y), Wpx, Hpx);
    return pos === ax.position ? ax : { ...ax, position: pos };
  });
  const fig2             = { ...fig, axes: adjusted };
  const planned = new Map                ();
  const shared = (which           , i        )         => {
    const lead = which === 'x' ? adjusted[i].xShare : adjusted[i].yShare;
    const key = `${which}${lead}`;
    const found = lookup(planned, key);
    if (found.kind === 'some') return found.value;
    const group = adjusted.map((_, j) => j).filter((j) => (which === 'x' ? adjusted[j].xShare : adjusted[j].yShare) === lead);
    const p = tracer.span(`plan.${which}`, { group: group.length }, () => planAxis(which, adjusted[lead], unionExtent(group.map((j) => ext[j][which])), fig2, tracer));
    planned.set(key, p);
    return p;
  };
  return adjusted.map((ax, i) => tracer.span('axes.layout', { artists: ax.artists.length, role: ax.role.kind, index: i, mode }, () =>
    layoutAxes({ ax, x: shared('x', i), y: shared('y', i), hasTwin: ax.role.kind === 'primary' && twinGroup(adjusted, i).length > 1 }, fig2, mode, dev, tracer)));
}

/** Each Axes' tight bbox (px, y down), as layoutFigure's meta[i].tight, without drawing what does not enter it. */
export function tightBoxes(fig            , tracer        )                      {
  return layoutParts(fig, 'tight', 'agg', tracer).map((p) => p.meta.tight);
}

/** The figure's scene for one device: 'agg' (PNG) or 'svg' (see Device). Text and ticks are the same on both. */
export function layoutFigure(fig            , tracer        , dev         = 'agg')                                                                                                      {
  const parts = layoutParts(fig, 'scene', dev, tracer);
  const W = fig.widthIn * fig.dpi, H = fig.heightIn * fig.dpi, k = pxPerPt(fig.dpi);
  const figTexts         = [];
  // generic fig.text
  for (const t of fig.figText) {
    const x = t.x * W, y = H - t.y * H;
    figTexts.push(...labelNodes(placeText(t.text, t.sizePt, fig.dpi, resolveFace(fig.theme.font.families, t.weight), x, y, { kind: 'horizontal', ha: t.ha, va: t.va }), k, t.color));
  }
  // suptitle and supx/supylabel
  if (fig.suptitle.kind === 'some') {
    const s = fig.suptitle.value, x = s.x * W, y = H - s.y * H;
    figTexts.push(...labelNodes(placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'horizontal', ha: s.ha, va: s.va }), k, s.color));
  }
  if (fig.supx.kind === 'some') {
    const s = fig.supx.value, x = s.x * W, y = H - s.y * H;
    figTexts.push(...labelNodes(placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'horizontal', ha: s.ha, va: s.va }), k, s.color));
  }
  if (fig.supy.kind === 'some') {
    const s = fig.supy.value, x = s.x * W, y = H - s.y * H;
    const b = placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'vertical', ha: s.ha, va: s.va });
    figTexts.push(...labelNodes(b, k, s.color));
  }
  return {
    scene: { width: W, height: H, dpi: fig.dpi, background: fig.theme.figure.background, nodes: [...parts.flatMap((p) => p.nodes), ...figTexts] },
    meta: parts.map((p) => p.meta),
    annot: parts.map((p) => p.annot),
  };
}
