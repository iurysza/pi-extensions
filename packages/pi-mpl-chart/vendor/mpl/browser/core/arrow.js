// Annotation arrows: matplotlib 3.11.2 Annotation.update_positions feeding FancyArrowPatch. Without an arrowstyle
// it "approximately simulates the YAArrow" with ConnectionStyle.Arc3(rad=0) and ArrowStyle.Simple; with one it is
// that ArrowStyle (the _Curve family, Simple, Fancy, Wedge) along Arc3(rad).
// Ported from text.py, patches.py and bezier.py so the vertices match to the last bit (pure).
// All coordinates are display px with y UP, as matplotlib computes them; the caller flips for Agg.

                                                               
import { assertNever, none, some } from './types.js';
import { lookup } from './std.js';

                                           
                                  
                                 
                                                                                                         
/** Path codes in matplotlib's order: M, L, Q (one CURVE3 pair), Z. */
                      
                                          
                                          
                                                          
                           

                               
                                                                              
                                                                                                                 
                                                         
                              
  

/** bezier.inside_circle */
const insideCircle = (cx        , cy        , r        )         => {
  const r2 = r ** 2;
  return ([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 < r2;
};

/** BezierSegment.__call__ for a quadratic: (1-t)^2 P0 + (1-t) t (2 P1) + t^2 P2, summed in that order. */
const quadAt = (q      , t        )     => {
  const a = (1 - t) ** 2, b = (1 - t) * t, c = t ** 2;
  return [a * q[0][0] + b * (2 * q[1][0]) + c * q[2][0], a * q[0][1] + b * (2 * q[1][1]) + c * q[2][1]];
};

const samePt = (a    , b    )          => a[0] === b[0] && a[1] === b[1];

/** bezier.find_bezier_t_intersecting_with_closedpath (bisection, tolerance 0.01); none when both ends agree. */
function findT(q      , inside        , tolerance = 0.01)                                    {
  let t0 = 0, t1 = 1;
  let start = quadAt(q, t0), end = quadAt(q, t1);
  let startInside = inside(start);
  const endInside = inside(end);
  if (startInside === endInside && !samePt(start, end)) return none;
  for (;;) {
    if (Math.hypot(start[0] - end[0], start[1] - end[1]) < tolerance) return some([t0, t1]);
    const mt = 0.5 * (t0 + t1);
    const middle = quadAt(q, mt);
    const middleInside = inside(middle);
    if (startInside !== middleInside) {
      t1 = mt;
      if (samePt(end, middle)) return some([t0, t1]);
      end = middle;
    } else {
      t0 = mt;
      if (samePt(start, middle)) return some([t0, t1]);
      start = middle; startInside = middleInside;
    }
  }
}

/** bezier.split_de_casteljau for a quadratic. */
function splitQuad(q      , t        )                        {
  const lerp = (a    , b    )     => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
  const a = lerp(q[0], q[1]), b = lerp(q[1], q[2]), m = lerp(a, b);
  return [[q[0], a, m], [m, b, q[2]]];
}

/** bezier.split_bezier_intersecting_with_closedpath */
function splitAt(q      , inside        )                                {
  const t = findT(q, inside);
  return t.kind === 'none' ? none : some(splitQuad(q, (t.value[0] + t.value[1]) / 2));
}

/** ConnectionStyle._Base._clip on a single quadratic: keep the part outside `start`, then inside `stop`. */
function clip(q      , start                , stop                )       {
  const s = start.kind === 'some' ? splitAt(q, start.value) : none;   // a ValueError leaves the path as is
  const afterStart = s.kind === 'some' ? s.value[1] : q;
  const e = stop.kind === 'some' ? splitAt(afterStart, stop.value) : none;
  return e.kind === 'some' ? e.value[0] : afterStart;
}

/** bezier.get_cos_sin */
const cosSin = (x0        , y0        , x1        , y1        )     => {
  const dx = x1 - x0, dy = y1 - y0, d = (dx * dx + dy * dy) ** 0.5;
  return d === 0 ? [0, 0] : [dx / d, dy / d];
};

/** bezier.get_normal_points: (left, right) */
const normalPoints = (cx        , cy        , cos        , sin        , len        )                    =>
  len === 0 ? [[cx, cy], [cx, cy]] : [[len * sin + cx, len * -cos + cy], [len * -sin + cx, len * cos + cy]];

/** bezier.get_intersection; undefined for (near) parallel lines */
function intersection(c1    , cs1    , c2    , cs2    )             {
  const [cos1, sin1] = cs1, [cos2, sin2] = cs2;
  const rhs1 = sin1 * c1[0] - cos1 * c1[1], rhs2 = sin2 * c2[0] - cos2 * c2[1];
  const a = sin1, b = -cos1, c = sin2, d = -cos2;
  const adbc = a * d - b * c;
  if (Math.abs(adbc) < 1e-12) return none;
  const a_ = d / adbc, b_ = -b / adbc, c_ = -c / adbc, d_ = a / adbc;
  return some([a_ * rhs1 + b_ * rhs2, c_ * rhs1 + d_ * rhs2]);
}

/** bezier.check_if_parallel === -1 (antiparallel) */
const antiparallel = (dx1        , dy1        , dx2        , dy2        )          =>
  Math.abs(Math.abs(Math.atan2(dx1, dy1) - Math.atan2(dx2, dy2)) - Math.PI) < 1e-5;

/** bezier.get_parallels: (left, right) quadratics offset by width */
function parallels(q      , width        )                        {
  const [[c1x, c1y], [cmx, cmy], [c2x, c2y]] = q;
  const anti = antiparallel(c1x - cmx, c1y - cmy, cmx - c2x, cmy - c2y);
  const cs1 = anti ? cosSin(c1x, c1y, c2x, c2y) : cosSin(c1x, c1y, cmx, cmy);
  const cs2 = anti ? cs1 : cosSin(cmx, cmy, c2x, c2y);
  const [l1, r1] = normalPoints(c1x, c1y, cs1[0], cs1[1], width);
  const [l2, r2] = normalPoints(c2x, c2y, cs2[0], cs2[1], width);
  const li = intersection(l1, cs1, l2, cs2), ri = intersection(r1, cs1, r2, cs2);
  const both = li.kind === 'some' && ri.kind === 'some';   // one ValueError falls back for both sides
  const lm     = both && li.kind === 'some' ? li.value : [0.5 * (l1[0] + l2[0]), 0.5 * (l1[1] + l2[1])];
  const rm     = both && ri.kind === 'some' ? ri.value : [0.5 * (r1[0] + r2[0]), 0.5 * (r1[1] + r2[1])];
  return [[l1, lm, l2], [r1, rm, r2]];
}

/** bezier.find_control_points */
const controlPoints = (c1    , mm    , c2    )       =>
  [c1, [0.5 * (4 * mm[0] - (c1[0] + c2[0])), 0.5 * (4 * mm[1] - (c1[1] + c2[1]))], c2];

/** bezier.make_wedged_bezier2: (left, right) */
function wedged(q      , width        , w1        , wm        , w2        )                        {
  const [[c1x, c1y], [cmx, cmy], [c3x, c3y]] = q;
  const cs1 = cosSin(c1x, c1y, cmx, cmy), cs2 = cosSin(cmx, cmy, c3x, c3y);
  const [l1, r1] = normalPoints(c1x, c1y, cs1[0], cs1[1], width * w1);
  const [l3, r3] = normalPoints(c3x, c3y, cs2[0], cs2[1], width * w2);
  const c12x = (c1x + cmx) * 0.5, c12y = (c1y + cmy) * 0.5, c23x = (cmx + c3x) * 0.5, c23y = (cmy + c3y) * 0.5;
  const c123x = (c12x + c23x) * 0.5, c123y = (c12y + c23y) * 0.5;
  const cs123 = cosSin(c12x, c12y, c23x, c23y);
  const [lm, rm] = normalPoints(c123x, c123y, cs123[0], cs123[1], width * wm);
  return [controlPoints(l1, lm, l3), controlPoints(r1, rm, r3)];
}

/** patches._point_along_a_line: the point on (x0, y0)-(x1, y1) at distance d from (x0, y0) */
const pointAlong = (p0    , p1    , d        )     => {
  const dx = p0[0] - p1[0], dy = p0[1] - p1[1], ff = d / (dx * dx + dy * dy) ** 0.5;
  return [p0[0] - ff * dx, p0[1] - ff * dy];
};

/** ArrowStyle.Simple.transmute */
function simple(q      , mutation        , headLength        , headWidth        , tailWidth        )                      {
  const [, p1, p2] = q;
  const hl = headLength * mutation;
  const split = splitAt(q, insideCircle(p2[0], p2[1], hl));
  const arrowIn       = split.kind === 'none'
    ? ((a    )       => [a, [0.5 * (a[0] + p2[0]), 0.5 * (a[1] + p2[1])], p2])(pointAlong(p2, p1, hl))
    : split.value[1];
  const [hl0, hr0] = wedged(arrowIn, (headWidth * mutation) / 2, 1, 0.5, 0);
  if (split.kind === 'none') {
    return [{ kind: 'M', p: hr0[0] }, { kind: 'Q', c: hr0[1], p: hr0[2] }, { kind: 'Q', c: hl0[1], p: hl0[0] }, { kind: 'Z' }];
  }
  const [tl, tr] = parallels(split.value[0], (tailWidth * mutation) / 2);
  return [
    { kind: 'M', p: tr[0] }, { kind: 'Q', c: tr[1], p: tr[2] },
    { kind: 'L', p: hr0[0] }, { kind: 'Q', c: hr0[1], p: hr0[2] }, { kind: 'Q', c: hl0[1], p: hl0[0] },
    { kind: 'L', p: tl[2] }, { kind: 'Q', c: tl[1], p: tl[0] },
    { kind: 'L', p: tr[0] }, { kind: 'Z' },
  ];
}

/** min(candidates, key=|c - v|): the first closest (position, relpos) pair */
const pick = (c                                        , v        )                            =>
  c.reduce((best, cur) => (Math.abs(cur[0] - v) < Math.abs(best[0] - v) ? cur : best));

/**
 * The arrow path for annotate(..., arrowprops={...}) with no 'arrowstyle', from the text's window extent
 * `bbox` to the annotated point `xy`. `k` is points_to_pixels(1) (FancyArrowPatch's dpi_cor).
 */
export function yaArrowPath(bbox     , xy    , hasText         , spec                 , k        )                      {
  const [x1, y1] = xy;
  const [x, relx] = pick([[bbox.x0, 0], [(bbox.x0 + bbox.x1) / 2, 0.5], [bbox.x1, 1]], x1);
  const [y, rely] = pick([[bbox.y0, 0], [(bbox.y0 + bbox.y1) / 2, 0.5], [bbox.y1, 1]], y1);
  const r = Math.hypot(y - y1, x - x1);
  const shrinkPx = ((spec.shrink * r) / k) * k;
  const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
  const begin     = [bbox.x0 + w * relx, bbox.y0 + h * rely];
  // ConnectionStyle.Arc3(rad=0).connect
  const q0       = [begin, [(begin[0] + x1) / 2, (begin[1] + y1) / 2], [x1, y1]];
  // patchA: the text bbox padded by 4 pt (Rectangle.contains with radius = its 1.0 linewidth tests the bare rectangle)
  const pad = 4 * k;
  const rx0 = bbox.x0 - pad / 2, ry0 = bbox.y0 - pad / 2, rx1 = rx0 + (w + pad), ry1 = ry0 + (h + pad);
  const inA                 = hasText ? some(([px, py]    ) => px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1) : none;
  const q1 = clip(q0, inA, none);
  const q2 = shrinkPx !== 0 ? clip(q1, some(insideCircle(q1[0][0], q1[0][1], shrinkPx)), some(insideCircle(q1[2][0], q1[2][1], shrinkPx))) : q1;
  const ms = spec.mutationPt;
  return simple(q2, ms * k, spec.headLengthPt / ms, spec.headWidthPt / ms, spec.widthPt / ms);
}

/**
 * Path.get_extents of an arrow path (display px): every segment's end points plus a quadratic's axis-aligned extrema,
 * t = (p0 - c) / (p0 - 2c + p1) where it lies inside (0, 1). Annotation.get_window_extent unions it with the text's.
 */
export function arrowExtents(path                     )      {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p    )       => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
  let pen     = [0, 0];
  for (const sg of path) {
    switch (sg.kind) {
      case 'M': case 'L': add(sg.p); pen = sg.p; break;
      case 'Q': {
        for (const axis of [0, 1]         ) {
          const den = pen[axis] - 2 * sg.c[axis] + sg.p[axis];
          const t = den === 0 ? -1 : (pen[axis] - sg.c[axis]) / den;
          if (t > 0 && t < 1) add(quadAt([pen, sg.c, sg.p], t));
        }
        add(sg.p); pen = sg.p; break;
      }
      case 'Z': break;
      default: return assertNever(sg);
    }
  }
  return { x0, y0, x1, y1 };
}

// ---- annotate(arrowprops={'arrowstyle': ...}): FancyArrowPatch with an explicit ArrowStyle ----

/** An arrowstyle or connectionstyle matplotlib has that this port does not draw (or does not know). */
export class UnsupportedArrowStyleError extends Error {
           style        ;
  constructor(style        , detail        ) {
    super(`UnsupportedArrowStyleError: ${JSON.stringify(style)}: ${detail}`);
    this.name = 'UnsupportedArrowStyleError';
    this.style = style;
  }
}

/** The _Curve family by registered name: the bracket/head ends and the keyword arguments each __init__ takes. */
const CURVE_FULL = ['head_length', 'head_width', 'widthA', 'widthB', 'lengthA', 'lengthB', 'angleA', 'angleB', 'scaleA', 'scaleB'];
const CURVES                                         = new Map([
  ['-', []], ['<-', CURVE_FULL], ['->', CURVE_FULL], ['<->', CURVE_FULL], ['<|-', CURVE_FULL], ['-|>', CURVE_FULL], ['<|-|>', CURVE_FULL],
  [']-', ['widthA', 'lengthA', 'angleA']], ['-[', ['widthB', 'lengthB', 'angleB']],
  [']-[', ['widthA', 'lengthA', 'angleA', 'widthB', 'lengthB', 'angleB']], ['|-|', ['widthA', 'angleA', 'widthB', 'angleB']],
  [']->', ['widthA', 'lengthA', 'angleA']], ['<-[', ['widthB', 'lengthB', 'angleB']],
]);
const PATCH_STYLES                                         = new Map([
  ['simple', ['head_length', 'head_width', 'tail_width']], ['fancy', ['head_length', 'head_width', 'tail_width']],
  ['wedge', ['tail_width', 'shrink_factor']],
]);
/** Every arrowstyle name this port draws, in ArrowStyle's registry order. */
export const ARROW_STYLES                    = [...CURVES.keys(), ...PATCH_STYLES.keys()];

/** _Style.__new__: "name,key=value,..." with spaces removed, the name lower-cased and every value a float. */
function styleArgs(spec        , what        )                                                 {
  const [head, ...rest] = spec.replaceAll(' ', '').split(',');
  const args = new Map                ();
  for (const pair of rest) {
    const kv = pair.split('=');
    const v = kv.length === 2 && kv[1] !== '' ? Number(kv[1]) : Number.NaN;
    if (kv.length !== 2 || Number.isNaN(v)) throw new TypeError(`${what}: incorrect style argument ${JSON.stringify(pair)} in ${JSON.stringify(spec)}`);
    args.set(kv[0], v);
  }
  return [head.toLowerCase(), args];
}

const END_KINDS                                = new Map([
  ['', 'none'], ['<', 'open'], ['>', 'open'], ['<|', 'filled'], ['|>', 'filled'], [']', 'bracket'], ['[', 'bracket'], ['|', 'bracket'],
]);
const endOf = (s        )           => { const e = lookup(END_KINDS, s); return e.kind === 'some' ? e.value : 'none'; };

/**
 * ArrowStyle(spec): a registered name with optional ",key=value" parameters. An unknown name, or a style this port
 * does not draw, throws UnsupportedArrowStyleError; a parameter the style's __init__ does not take throws TypeError
 * as matplotlib does. A rotated bracket (angleA / angleB other than 0) is unsupported.
 */
export function parseArrowStyle(spec        )             {
  const [name, args] = styleArgs(spec, 'arrowstyle');
  const curveKeys = lookup(CURVES, name), patchKeys = lookup(PATCH_STYLES, name);
  const allowed = curveKeys.kind === 'some' ? curveKeys.value : patchKeys.kind === 'some' ? patchKeys.value : [];
  if (curveKeys.kind === 'none' && patchKeys.kind === 'none') throw new UnsupportedArrowStyleError(spec, `unknown arrowstyle; supported: ${ARROW_STYLES.join(' ')}`);
  for (const key of args.keys()) {
    if (!allowed.includes(key)) throw new TypeError(`arrowstyle ${JSON.stringify(name)}: unexpected keyword argument '${key}'`);
  }
  const scale = (key        )                 => lookup(args, key);
  const get = (key        , d        )         => { const v = scale(key); return v.kind === 'some' ? v.value : d; };
  if (name === 'simple') return { kind: 'simple', headLength: get('head_length', 0.5), headWidth: get('head_width', 0.5), tailWidth: get('tail_width', 0.2) };
  if (name === 'fancy') return { kind: 'fancy', headLength: get('head_length', 0.4), headWidth: get('head_width', 0.4), tailWidth: get('tail_width', 0.4) };
  if (name === 'wedge') return { kind: 'wedge', tailWidth: get('tail_width', 0.3), shrinkFactor: get('shrink_factor', 0.5) };
  for (const a of ['angleA', 'angleB']) {
    if (get(a, 0) !== 0) throw new UnsupportedArrowStyleError(spec, `${a} (a rotated bracket) is not supported`);
  }
  const dash = name.indexOf('-');
  const bar = name === '|-|';
  return {
    kind: 'curve', name, begin: endOf(name.slice(0, dash)), end: endOf(name.slice(dash + 1)),
    headLength: get('head_length', name === '-' ? 0.2 : 0.4), headWidth: get('head_width', name === '-' ? 0.1 : 0.2),
    widthA: get('widthA', 1), widthB: get('widthB', 1), lengthA: bar ? 0 : get('lengthA', 0.2), lengthB: bar ? 0 : get('lengthB', 0.2),
    scaleA: scale('scaleA'), scaleB: scale('scaleB'),
  };
}

/** ConnectionStyle(spec): only "arc3" (optionally ",rad=r") is drawn; the result is rad. */
export function parseConnectionStyle(spec        )         {
  const [name, args] = styleArgs(spec, 'connectionstyle');
  if (name !== 'arc3') throw new UnsupportedArrowStyleError(spec, 'only the arc3 connectionstyle is supported');
  for (const key of args.keys()) {
    if (key !== 'rad') throw new TypeError(`connectionstyle "arc3": unexpected keyword argument '${key}'`);
  }
  const rad = lookup(args, 'rad');
  return rad.kind === 'some' ? rad.value : 0;
}

/** One path of a FancyArrowPatch: `fillable` paths take the facecolor (when it is not transparent). */
                                                                                            

const quadSegs = (q      )                      => [{ kind: 'M', p: q[0] }, { kind: 'Q', c: q[1], p: q[2] }];

/** ArrowStyle._Curve._get_arrow_wedge: the head's three vertices and the shaft's pad (ddx, ddy). */
function arrowWedge(x0        , y0        , x1        , y1        , headDist        , cos        , sin        , linewidth        )                                       {
  const dx0 = x0 - x1, dy0 = y0 - y1;
  const d = Math.hypot(dx0, dy0);
  const padProjected = (0.5 * linewidth) / sin;
  const cp = d === 0 ? 1 : d;
  const ddx = (padProjected * dx0) / cp, ddy = (padProjected * dy0) / cp;
  const dx = (dx0 / cp) * headDist, dy = (dy0 / cp) * headDist;
  const dx1 = cos * dx + sin * dy, dy1 = -sin * dx + cos * dy;
  const dx2 = cos * dx - sin * dy, dy2 = sin * dx + cos * dy;
  return [[[x1 + ddx + dx1, y1 + ddy + dy1], [x1 + ddx, y1 + ddy], [x1 + ddx + dx2, y1 + ddy + dy2]], [ddx, ddy]];
}

/** ArrowStyle._Curve._get_bracket (angle 0) */
function bracket(x0        , y0        , x1        , y1        , width        , length        )                      {
  const [cos, sin] = cosSin(x1, y1, x0, y0);
  const [a, b] = normalPoints(x0, y0, cos, sin, width);
  const dx = length * cos, dy = length * sin;
  return [{ kind: 'M', p: [a[0] + dx, a[1] + dy] }, { kind: 'L', p: a }, { kind: 'L', p: b }, { kind: 'L', p: [b[0] + dx, b[1] + dy] }];
}

const isHead = (end          )          => end === 'open' || end === 'filled';
/** A _Curve head: open (M L L) or, for '<|' / '|>', closed and fillable. */
const headPiece = (v                       , filled         )             => ({
  segs: [{ kind: 'M', p: v[0] }, { kind: 'L', p: v[1] }, { kind: 'L', p: v[2] }, ...(filled ? [{ kind: 'Z' }         ] : [])],
  fillable: filled,
});

/** ArrowStyle._Curve.transmute on an Arc3 quadratic: the shaft, then the start's head or bracket, then the end's. */
function curve(st                                        , q      , mutation        , linewidth        )                        {
  const hl = st.headLength * mutation, hw = st.headWidth * mutation;
  const headDist = Math.hypot(hl, hw);
  const cos = hl / headDist, sin = hw / headDist;
  const scaleA = st.scaleA.kind === 'some' ? st.scaleA.value : mutation;
  const scaleB = st.scaleB.kind === 'some' ? st.scaleB.value : mutation;
  const [[x0, y0], [x1, y1], [x3, y3]] = q;
  const x2 = x1, y2 = y1;   // path.vertices[-2] of a three-vertex path is the control point
  const hasBegin = isHead(st.begin) && !(x0 === x1 && y0 === y1);
  const hasEnd = isHead(st.end) && !(x2 === x3 && y2 === y3);
  const wA = hasBegin ? some(arrowWedge(x1, y1, x0, y0, headDist, cos, sin, linewidth)) : none;
  const wB = hasEnd ? some(arrowWedge(x2, y2, x3, y3, headDist, cos, sin, linewidth)) : none;
  const [ddxA, ddyA] = wA.kind === 'some' ? wA.value[1] : [0, 0];
  const [ddxB, ddyB] = wB.kind === 'some' ? wB.value[1] : [0, 0];
  const shaft             = { segs: quadSegs([[x0 + ddxA, y0 + ddyA], [x1, y1], [x3 + ddxB, y3 + ddyB]]), fillable: false };
  const begin                        = wA.kind === 'some' ? [headPiece(wA.value[0], st.begin === 'filled')]
    : st.begin === 'bracket' ? [{ segs: bracket(x0, y0, x1, y1, st.widthA * scaleA, st.lengthA * scaleA), fillable: false }] : [];
  const end                        = wB.kind === 'some' ? [headPiece(wB.value[0], st.end === 'filled')]
    : st.end === 'bracket' ? [{ segs: bracket(x3, y3, x2, y2, st.widthB * scaleB, st.lengthB * scaleB), fillable: false }] : [];
  return [shaft, ...begin, ...end];
}

/** split_bezier_intersecting_with_closedpath where matplotlib lets NonIntersectingPathException escape draw(). */
function mustSplit(q      , inside        , what        )                        {
  const s = splitAt(q, inside);
  if (s.kind === 'none') throw new RangeError(`arrowstyle "fancy": the arrow is too short for its ${what} (matplotlib raises NonIntersectingPathException)`);
  return s.value;
}

/** ArrowStyle.Fancy.transmute */
function fancy(q      , mutation        , headLength        , headWidth        , tailWidth        )                      {
  const [, p1, p2] = q;
  const hl = headLength * mutation;
  const split = splitAt(q, insideCircle(p2[0], p2[1], hl));
  const p0     = split.kind === 'none' ? pointAlong(p2, p1, hl) : q[0];
  const arrowPath       = split.kind === 'none' ? [p0, [0.5 * (p0[0] + p2[0]), 0.5 * (p0[1] + p2[1])], p2] : q;
  const pathHead = split.kind === 'none' ? arrowPath : split.value[1];
  const pathTail = mustSplit(arrowPath, insideCircle(p2[0], p2[1], hl * 0.8), 'head')[0];
  const [headL, headR] = wedged(pathHead, (headWidth * mutation) / 2, 1, 0.6, 0);
  const tw = tailWidth * mutation;
  const [tailL, tailR] = wedged(pathTail, tw * 0.5, 1, 0.6, 0.3);
  const tailStart = mustSplit(arrowPath, insideCircle(p0[0], p0[1], tw * 0.3), 'tail')[0][2];
  return [
    { kind: 'M', p: tailStart }, { kind: 'L', p: tailR[0] }, { kind: 'Q', c: tailR[1], p: tailR[2] },
    { kind: 'L', p: headR[0] }, { kind: 'Q', c: headR[1], p: headR[2] }, { kind: 'Q', c: headL[1], p: headL[0] },
    { kind: 'L', p: tailL[2] }, { kind: 'Q', c: tailL[1], p: tailL[0] }, { kind: 'L', p: tailStart }, { kind: 'Z' },
  ];
}

/** ArrowStyle.Wedge.transmute */
function wedge(q      , mutation        , tailWidth        , shrinkFactor        )                      {
  const [bPlus, bMinus] = wedged(q, (tailWidth * mutation) / 2, 1, shrinkFactor, 0);
  return [
    { kind: 'M', p: bPlus[0] }, { kind: 'Q', c: bPlus[1], p: bPlus[2] },
    { kind: 'L', p: bMinus[2] }, { kind: 'Q', c: bMinus[1], p: bMinus[0] }, { kind: 'Z' },
  ];
}

                               
                                                                        
                                                                                                                    
  

/**
 * The FancyArrowPatch paths for annotate(..., arrowprops={'arrowstyle': ...}), display px y-up: from relpos of the
 * text's window extent `bbox` to `xy` along Arc3(rad), clipped by the padded text box, shrunk by shrinkA / shrinkB,
 * then the style's transmute at mutation_scale * dpi_cor. `k` is points_to_pixels(1).
 */
export function styledArrowPaths(bbox     , xy    , hasText         , spec                 , k        )                        {
  const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
  const [xa, ya]     = [bbox.x0 + w * spec.relpos[0], bbox.y0 + h * spec.relpos[1]];
  const [xb, yb] = xy;
  // ConnectionStyle.Arc3.connect
  const x12 = (xa + xb) / 2, y12 = (ya + yb) / 2, dx = xb - xa, dy = yb - ya;
  const q0       = [[xa, ya], [x12 + spec.rad * dy, y12 - spec.rad * dx], [xb, yb]];
  const pad = 4 * k;
  const rx0 = bbox.x0 - pad / 2, ry0 = bbox.y0 - pad / 2, rx1 = rx0 + (w + pad), ry1 = ry0 + (h + pad);
  const inA                 = hasText ? some(([px, py]    ) => px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1) : none;
  const q1 = clip(q0, inA, none);
  const sa = spec.shrinkAPt * k, sb = spec.shrinkBPt * k;
  const q2 = clip(q1, sa !== 0 ? some(insideCircle(q1[0][0], q1[0][1], sa)) : none, sb !== 0 ? some(insideCircle(q1[2][0], q1[2][1], sb)) : none);
  const ms = spec.mutationPt * k;
  const st = spec.style;
  switch (st.kind) {
    case 'curve': return curve(st, q2, ms, spec.linewidthPt * k);
    case 'simple': return [{ segs: simple(q2, ms, st.headLength, st.headWidth, st.tailWidth), fillable: true }];
    case 'fancy': return [{ segs: fancy(q2, ms, st.headLength, st.headWidth, st.tailWidth), fillable: true }];
    case 'wedge': return [{ segs: wedge(q2, ms, st.tailWidth, st.shrinkFactor), fillable: true }];
    default: return assertNever(st);
  }
}
