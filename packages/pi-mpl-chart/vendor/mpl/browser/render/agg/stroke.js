// Agg's vector pipeline after the path converters: conv_curve (curve3_div/curve4_div),
// conv_dash (vcgen_dash) and conv_stroke (vcgen_stroke + math_stroke), ported from
// matplotlib's vendored agg24-svn with the same float operations in the same order.
                                                          
import { assertNever } from '../../core/types.js';

/** Where polygons go: Agg's rasterizer add_vertex interface. */
                                                                                                                   

/** A flattened subpath. */
                                                                                             

const EPS = 1e-14;                      // vertex_dist_epsilon
const INTERSECTION_EPS = 1e-30;
const COLLINEARITY_EPS = 1e-30;
const RECURSION_LIMIT = 32;
const TOL2 = 0.25;                      // (0.5 / approximation_scale)^2

// ------------------------------------------------------------------ curves
function bez3(out     , x1        , y1        , x2        , y2        , x3        , y3        , level        )       {
  if (level > RECURSION_LIMIT) return;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2, x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2;
  const dx = x3 - x1, dy = y3 - y1;
  let d = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  if (d > COLLINEARITY_EPS) {
    if (d * d <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x123); out.ys.push(y123); return; }
  } else {
    const da = dx * dx + dy * dy;
    if (da === 0) d = sq(x1, y1, x2, y2);
    else {
      d = ((x2 - x1) * dx + (y2 - y1) * dy) / da;
      if (d > 0 && d < 1) return;
      if (d <= 0) d = sq(x2, y2, x1, y1);
      else if (d >= 1) d = sq(x2, y2, x3, y3);
      else d = sq(x2, y2, x1 + d * dx, y1 + d * dy);
    }
    if (d < TOL2) { out.xs.push(x2); out.ys.push(y2); return; }
  }
  bez3(out, x1, y1, x12, y12, x123, y123, level + 1);
  bez3(out, x123, y123, x23, y23, x3, y3, level + 1);
}

function bez4(out     , x1        , y1        , x2        , y2        , x3        , y3        , x4        , y4        , level        )       {
  if (level > RECURSION_LIMIT) return;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2, x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const x34 = (x3 + x4) / 2, y34 = (y3 + y4) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2, x234 = (x23 + x34) / 2, y234 = (y23 + y34) / 2;
  const x1234 = (x123 + x234) / 2, y1234 = (y123 + y234) / 2;
  const dx = x4 - x1, dy = y4 - y1;
  let d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
  let d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);
  switch (((d2 > COLLINEARITY_EPS ? 1 : 0) << 1) + (d3 > COLLINEARITY_EPS ? 1 : 0)) {
    case 0: {
      let k = dx * dx + dy * dy;
      if (k === 0) { d2 = sq(x1, y1, x2, y2); d3 = sq(x4, y4, x3, y3); }
      else {
        k = 1 / k;
        d2 = k * ((x2 - x1) * dx + (y2 - y1) * dy);
        d3 = k * ((x3 - x1) * dx + (y3 - y1) * dy);
        if (d2 > 0 && d2 < 1 && d3 > 0 && d3 < 1) return;
        if (d2 <= 0) d2 = sq(x2, y2, x1, y1); else if (d2 >= 1) d2 = sq(x2, y2, x4, y4); else d2 = sq(x2, y2, x1 + d2 * dx, y1 + d2 * dy);
        if (d3 <= 0) d3 = sq(x3, y3, x1, y1); else if (d3 >= 1) d3 = sq(x3, y3, x4, y4); else d3 = sq(x3, y3, x1 + d3 * dx, y1 + d3 * dy);
      }
      if (d2 > d3) { if (d2 < TOL2) { out.xs.push(x2); out.ys.push(y2); return; } }
      else if (d3 < TOL2) { out.xs.push(x3); out.ys.push(y3); return; }
      break;
    }
    case 1:
      if (d3 * d3 <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    case 2:
      if (d2 * d2 <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    case 3:
      if ((d2 + d3) * (d2 + d3) <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    default: throw new Error('unreachable: two-bit collinearity code');
  }
  bez4(out, x1, y1, x12, y12, x123, y123, x1234, y1234, level + 1);
  bez4(out, x1234, y1234, x234, y234, x34, y34, x4, y4, level + 1);
}

const sq = (x1        , y1        , x2        , y2        )         => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };

/**
 * conv_curve over a Seg list, split into subpaths at M (and after Z). Curve start
 * points are the current point; curve_div emits interior points then the end point.
 * `dx, dy` translate every vertex first (conv_transform).
 */
export function flatten(segs                , dx        , dy        )        {
  const out        = [];
  let cur      = { xs: [], ys: [], closed: false };
  let sx = 0, sy = 0, lx = 0, ly = 0;
  const flush = ()       => { if (cur.xs.length > 0) out.push(cur); };
  for (const s of segs) {
    switch (s[0]) {
      case 'M': flush(); cur = { xs: [s[1] + dx], ys: [s[2] + dy], closed: false }; sx = lx = s[1] + dx; sy = ly = s[2] + dy; break;
      case 'L': if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); } lx = s[1] + dx; ly = s[2] + dy; cur.xs.push(lx); cur.ys.push(ly); break;
      case 'Q': {
        if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); }
        const x2 = s[1] + dx, y2 = s[2] + dy, x3 = s[3] + dx, y3 = s[4] + dy;
        bez3(cur, lx, ly, x2, y2, x3, y3, 0); cur.xs.push(x3); cur.ys.push(y3); lx = x3; ly = y3; break;
      }
      case 'C': {
        if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); }
        const x2 = s[1] + dx, y2 = s[2] + dy, x3 = s[3] + dx, y3 = s[4] + dy, x4 = s[5] + dx, y4 = s[6] + dy;
        bez4(cur, lx, ly, x2, y2, x3, y3, x4, y4, 0); cur.xs.push(x4); cur.ys.push(y4); lx = x4; ly = y4; break;
      }
      case 'Z': cur = { xs: cur.xs, ys: cur.ys, closed: true }; flush(); cur = { xs: [], ys: [], closed: false }; lx = sx; ly = sy; break;
      default: assertNever(s);
    }
  }
  flush();
  return out;
}

/** Fill: every subpath becomes a polygon (the rasterizer auto-closes). */
export function fillPath(subs                , sink          )       {
  for (const s of subs) {
    sink.moveTo(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) sink.lineTo(s.xs[i], s.ys[i]);
    sink.close();
  }
}

// ------------------------------------------------------------------ vertex_sequence<vertex_dist>
/** Agg's vertex_sequence: drops coincident vertices, caches each vertex's distance to the next. */
class VSeq {
  xs           = []; ys           = []; ds           = [];
  get size()         { return this.xs.length; }
          link(i        , j        )          {
    const dx = this.xs[j] - this.xs[i], dy = this.ys[j] - this.ys[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    const ok = d > EPS;
    this.ds[i] = ok ? d : 1 / EPS;
    return ok;
  }
          removeLast()       { if (this.xs.length > 0) { this.xs.pop(); this.ys.pop(); this.ds.pop(); } }
  add(x        , y        )       {
    const n = this.size;
    if (n > 1 && !this.link(n - 2, n - 1)) this.removeLast();
    this.xs.push(x); this.ys.push(y); this.ds.push(0);
  }
  modifyLast(x        , y        )       { this.removeLast(); this.add(x, y); }
  close(closed         )       {
    while (this.size > 1) {
      if (this.link(this.size - 2, this.size - 1)) break;
      const x = this.xs[this.size - 1], y = this.ys[this.size - 1];
      this.removeLast(); this.modifyLast(x, y);
    }
    if (closed) while (this.size > 1) { if (this.link(this.size - 1, 0)) break; this.removeLast(); }
  }
}

// ------------------------------------------------------------------ math_stroke
                                                      
                                                                                                                                                       
/** Where math_stroke's vertices go: straight to the sink (vcgen_stroke emits each join's vertices in order). */
                                                       
function put(o     , x        , y        )       {
  if (o.first) { o.sink.moveTo(x, y); o.first = false; } else o.sink.lineTo(x, y);
}

/** matplotlib's GCAgg mapping: 'miter' → miter_join_revert, 'projecting' (square) caps. */
export function stroker(width        , cap     , join      , miterLimit        )          {
  const w = width * 0.5;
  const lj     = join === 'miter' ? 'miterRevert' : join === 'round' ? 'round' : 'bevel';
  return { w, wAbs: Math.abs(w), wEps: w / 1024, cap, join: lj, miterLimit };
}

const cross = (x1        , y1        , x2        , y2        , x        , y        )         => (x - x2) * (y2 - y1) - (y - y2) * (x2 - x1);

function intersect(ax        , ay        , bx        , by        , cx        , cy        , dx        , dy        , o                          )          {
  const num = (ay - cy) * (dx - cx) - (ax - cx) * (dy - cy);
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < INTERSECTION_EPS) return false;
  const r = num / den;
  o.x = ax + r * (bx - ax); o.y = ay + r * (by - ay);
  return true;
}

function calcArc(st         , vc     , x        , y        , dx1        , dy1        , dx2        , dy2        )       {
  let a1 = Math.atan2(dy1, dx1);
  let a2 = Math.atan2(dy2, dx2);
  let da = Math.acos(st.wAbs / (st.wAbs + 0.125)) * 2;
  put(vc, x + dx1, y + dy1);
  if (a1 > a2) a2 += 2 * Math.PI;
  const n = Math.trunc((a2 - a1) / da);
  da = (a2 - a1) / (n + 1);
  a1 += da;
  for (let i = 0; i < n; i++) { put(vc, x + Math.cos(a1) * st.w, y + Math.sin(a1) * st.w); a1 += da; }
  put(vc, x + dx2, y + dy2);
}

const P = { x: 0, y: 0 };

function calcMiter(st         , vc     , v0x        , v0y        , v1x        , v1y        , v2x        , v2y        ,
                   dx1        , dy1        , dx2        , dy2        , lj    , mlimit        , dbevel        )       {
  let xi = v1x, yi = v1y, di = 1;
  const lim = st.wAbs * mlimit;
  let exceeded = true, failed = true;
  if (intersect(v0x + dx1, v0y - dy1, v1x + dx1, v1y - dy1, v1x + dx2, v1y - dy2, v2x + dx2, v2y - dy2, P)) {
    xi = P.x; yi = P.y;
    const ex = xi - v1x, ey = yi - v1y;
    di = Math.sqrt(ex * ex + ey * ey);
    if (di <= lim) { put(vc, xi, yi); exceeded = false; }
    failed = false;
  } else {
    const x2 = v1x + dx1, y2 = v1y - dy1;
    if ((cross(v0x, v0y, v1x, v1y, x2, y2) < 0) === (cross(v1x, v1y, v2x, v2y, x2, y2) < 0)) {
      put(vc, v1x + dx1, v1y - dy1); exceeded = false;
    }
  }
  if (!exceeded) return;
  switch (lj) {
    case 'miterRevert':
      put(vc, v1x + dx1, v1y - dy1); put(vc, v1x + dx2, v1y - dy2); return;
    case 'round':
      calcArc(st, vc, v1x, v1y, dx1, -dy1, dx2, -dy2); return;
    case 'miter': case 'bevel':
      if (failed) {
        put(vc, v1x + dx1 + dy1 * mlimit, v1y - dy1 + dx1 * mlimit);
        put(vc, v1x + dx2 - dy2 * mlimit, v1y - dy2 - dx2 * mlimit);
      } else {
        const x1 = v1x + dx1, y1 = v1y - dy1, x2 = v1x + dx2, y2 = v1y - dy2;
        di = (lim - dbevel) / (di - dbevel);
        put(vc, x1 + (xi - x1) * di, y1 + (yi - y1) * di);
        put(vc, x2 + (xi - x2) * di, y2 + (yi - y2) * di);
      }
      return;
    default: assertNever(lj);
  }
}

function calcCap(st         , vc     , v0x        , v0y        , v1x        , v1y        , len        )       {
  let dx1 = (v1y - v0y) / len, dy1 = (v1x - v0x) / len;
  dx1 *= st.w; dy1 *= st.w;
  if (st.cap !== 'round') {
    let dx2 = 0, dy2 = 0;
    if (st.cap === 'square') { dx2 = dy1; dy2 = dx1; }
    put(vc, v0x - dx1 - dx2, v0y + dy1 - dy2);
    put(vc, v0x + dx1 - dx2, v0y - dy1 - dy2);
    return;
  }
  let da = Math.acos(st.wAbs / (st.wAbs + 0.125)) * 2;
  const n = Math.trunc(Math.PI / da);
  da = Math.PI / (n + 1);
  put(vc, v0x - dx1, v0y + dy1);
  let a1 = Math.atan2(dy1, -dx1) + da;
  for (let i = 0; i < n; i++) { put(vc, v0x + Math.cos(a1) * st.w, v0y + Math.sin(a1) * st.w); a1 += da; }
  put(vc, v0x + dx1, v0y - dy1);
}

const INNER_MITER_LIMIT = 1.01;

function calcJoin(st         , vc     , v0x        , v0y        , v1x        , v1y        , v2x        , v2y        , len1        , len2        )       {
  const dx1 = st.w * (v1y - v0y) / len1, dy1 = st.w * (v1x - v0x) / len1;
  const dx2 = st.w * (v2y - v1y) / len2, dy2 = st.w * (v2x - v1x) / len2;
  const cp = cross(v0x, v0y, v1x, v1y, v2x, v2y);
  if (cp > EPS && st.w > 0) {
    let limit = (len1 < len2 ? len1 : len2) / st.wAbs;
    if (limit < INNER_MITER_LIMIT) limit = INNER_MITER_LIMIT;
    calcMiter(st, vc, v0x, v0y, v1x, v1y, v2x, v2y, dx1, dy1, dx2, dy2, 'miterRevert', limit, 0);
    return;
  }
  const mx = (dx1 + dx2) / 2, my = (dy1 + dy2) / 2;
  const dbevel = Math.sqrt(mx * mx + my * my);
  if ((st.join === 'round' || st.join === 'bevel') && st.wAbs - dbevel < st.wEps) {
    if (intersect(v0x + dx1, v0y - dy1, v1x + dx1, v1y - dy1, v1x + dx2, v1y - dy2, v2x + dx2, v2y - dy2, P)) { put(vc, P.x, P.y); }
    else { put(vc, v1x + dx1, v1y - dy1); }
    return;
  }
  switch (st.join) {
    case 'miter': case 'miterRevert':
      calcMiter(st, vc, v0x, v0y, v1x, v1y, v2x, v2y, dx1, dy1, dx2, dy2, st.join, st.miterLimit, dbevel); return;
    case 'round': calcArc(st, vc, v1x, v1y, dx1, -dy1, dx2, -dy2); return;
    case 'bevel': put(vc, v1x + dx1, v1y - dy1); put(vc, v1x + dx2, v1y - dy2); return;
    default: assertNever(st.join);
  }
}

// ------------------------------------------------------------------ vcgen_stroke
/** One subpath through vcgen_stroke: the outline polygon(s) into the sink. */
function strokeSeq(st         , v      , closedIn         , sink          )       {
  v.close(closedIn);
  const n = v.size;
  const closed = n < 3 ? false : closedIn;
  if (n < 2 + (closed ? 1 : 0)) return;
  const vc      = { sink, first: true };
  const X = v.xs, Y = v.ys, D = v.ds;
  let i        ;
  if (!closed) {
    // interior vertices: prev(i) = i - 1 and next(i) = i + 1
    calcCap(st, vc, X[0], Y[0], X[1], Y[1], D[0]);
    for (i = 1; i < n - 1; i++) calcJoin(st, vc, X[i - 1], Y[i - 1], X[i], Y[i], X[i + 1], Y[i + 1], D[i - 1], D[i]);
    calcCap(st, vc, X[n - 1], Y[n - 1], X[n - 2], Y[n - 2], D[n - 2]);
    for (i = n - 2; i >= 1; i--) calcJoin(st, vc, X[i + 1], Y[i + 1], X[i], Y[i], X[i - 1], Y[i - 1], D[i], D[i - 1]);
    sink.close();
    return;
  }
  const prev = (k        )         => (k + n - 1) % n, next = (k        )         => (k + 1) % n;
  for (i = 0; i < n; i++) calcJoin(st, vc, X[prev(i)], Y[prev(i)], X[i], Y[i], X[next(i)], Y[next(i)], D[prev(i)], D[i]);
  sink.close();
  vc.first = true;
  for (i = n - 1; i >= 0; i--) calcJoin(st, vc, X[next(i)], Y[next(i)], X[i], Y[i], X[prev(i)], Y[prev(i)], D[i], D[prev(i)]);
  sink.close();
}

/** Stroke flattened subpaths (conv_adaptor_vcgen<vcgen_stroke>). */
export function strokePath(subs                , st         , sink          )       {
  for (const s of subs) {
    const v = new VSeq();
    v.modifyLast(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) v.add(s.xs[i], s.ys[i]);
    strokeSeq(st, v, s.closed, sink);
  }
}

// ------------------------------------------------------------------ vcgen_dash
/**
 * conv_dash: each subpath is cut into dashes; returns open subpaths for the stroker.
 * pattern alternates on/off lengths in px; offset is dash_start.
 */
export function dashPath(subs                , pattern                   , offset        )        {
  const dashes = pattern.length % 2 === 0 ? pattern : [...pattern, ...pattern];
  const nd = dashes.length;
  const out        = [];
  if (nd < 2) return out;
  let total = 0;
  for (const d of dashes) total += d;
  if (!(total > 0)) return [...subs];
  let curDash = 0, curStart = 0;
  const calcStart = (ds0        )       => {
    let ds = ds0;
    curDash = 0; curStart = 0;
    while (ds > 0) {
      if (ds > dashes[curDash]) { ds -= dashes[curDash]; curDash++; curStart = 0; if (curDash >= nd) curDash = 0; }
      else { curStart = ds; ds = 0; }
    }
  };
  calcStart(Math.abs(offset));
  for (const s of subs) {
    const v = new VSeq();
    v.modifyLast(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) v.add(s.xs[i], s.ys[i]);
    v.close(s.closed);
    const n = v.size;
    if (n < 2) continue;
    // the generator emits move_to/line_to; the stroke adaptor splits at every move_to
    let cur      = { xs: [v.xs[0]], ys: [v.ys[0]], closed: false };
    const moveTo = (x        , y        )       => { if (cur.xs.length > 1) out.push(cur); cur = { xs: [x], ys: [y], closed: false }; };
    const lineTo = (x        , y        )       => { cur.xs.push(x); cur.ys.push(y); };
    let srcV = 1, i1 = 0, i2 = 1;
    let rest = v.ds[i1];
    if (offset >= 0) calcStart(offset);
    for (;;) {
      const dashRest = dashes[curDash] - curStart;
      const isMove = (curDash & 1) === 1;
      let x        , y        , stop = false;
      if (rest > dashRest) {
        rest -= dashRest;
        curDash++; if (curDash >= nd) curDash = 0;
        curStart = 0;
        x = v.xs[i2] - (v.xs[i2] - v.xs[i1]) * rest / v.ds[i1];
        y = v.ys[i2] - (v.ys[i2] - v.ys[i1]) * rest / v.ds[i1];
      } else {
        curStart += rest;
        x = v.xs[i2]; y = v.ys[i2];
        srcV++;
        i1 = i2;
        rest = v.ds[i1];
        if (s.closed) { if (srcV > n) stop = true; else i2 = srcV >= n ? 0 : srcV; }
        else if (srcV >= n) stop = true; else i2 = srcV;
      }
      if (isMove) moveTo(x, y); else lineTo(x, y);
      if (stop) break;
    }
    if (cur.xs.length > 1) out.push(cur);
  }
  return out;
}
