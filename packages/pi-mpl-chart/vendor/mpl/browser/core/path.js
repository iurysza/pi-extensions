// A Line2D stroke's path cleanup, ported from matplotlib 3.11.2 src/path_converters.h in Agg's order
// (RendererAgg::draw_path): PathNanRemover → PathClipper → PathSnapper → PathSimplifier. Each converter is a
// pull-based vertex source in C++; here each is a loop over the previous stage's output, which emits the same
// command sequence (the converters' queues only batch output, they never reorder it).

import { snapOffset } from './scene.js';
                                           

                                                                          
/** Vertices in device px (y down). MOVETO at the indices in `moves` (ascending), LINETO everywhere else. */
                                                                                                             

/** One subpath starting at vertex 0 (shared; never mutated). */
export const MOVE0              = Uint32Array.of(0);
const isFin = (v        )          => v - v === 0;   // false for NaN and ±Infinity

/** Growable vertex/command buffer (the converters' output). */
class Out {
  xs              ; ys              ; n = 0;
  moves             ; nm = 0;
  constructor(cap        ) { this.xs = new Float64Array(cap); this.ys = new Float64Array(cap); this.moves = new Uint32Array(8); }
          grow()       {
    const xs = new Float64Array(this.xs.length * 2), ys = new Float64Array(this.ys.length * 2);
    xs.set(this.xs); ys.set(this.ys); this.xs = xs; this.ys = ys;
  }
  line(x        , y        )       {
    if (this.n === this.xs.length) this.grow();
    this.xs[this.n] = x; this.ys[this.n] = y; this.n++;
  }
  move(x        , y        )       {
    if (this.nm === this.moves.length) { const m = new Uint32Array(this.moves.length * 2); m.set(this.moves); this.moves = m; }
    this.moves[this.nm++] = this.n;
    this.line(x, y);
  }
  done()           { return { xs: this.xs.subarray(0, this.n), ys: this.ys.subarray(0, this.n), moves: this.moves.subarray(0, this.nm) }; }
}

// ------------------------------------------------------------------ PathNanRemover + PathClipper
// agg::clip_line_segment (agg_clip_liang_barsky.h) on the rect (x1, y1, x2, y2); results in CLIP.
const CLIP = new Float64Array(4);
function clipFlags(x        , y        , x1        , y1        , x2        , y2        )         {
  return (x > x2 ? 1 : 0) | (y > y2 ? 2 : 0) | (x < x1 ? 4 : 0) | (y < y1 ? 8 : 0);
}
/** clip_move_point: moves point `which` (0 or 1) of CLIP onto the rect; false when it cannot. */
function clipMovePoint(tx1        , ty1        , tx2        , ty2        , x1        , y1        , x2        , y2        , which        , flags        )          {
  let x = CLIP[2 * which], y = CLIP[2 * which + 1];
  if (flags & 5) {
    if (tx1 === tx2) return false;
    const bound = flags & 4 ? x1 : x2;
    y = (bound - tx1) * (ty2 - ty1) / (tx2 - tx1) + ty1;
    x = bound;
  }
  const fy = (y > y2 ? 2 : 0) | (y < y1 ? 8 : 0);
  if (fy & 10) {
    if (ty1 === ty2) return false;
    const bound = fy & 8 ? y1 : y2;
    x = (bound - ty1) * (tx2 - tx1) / (ty2 - ty1) + tx1;
    y = bound;
  }
  CLIP[2 * which] = x; CLIP[2 * which + 1] = y;
  return true;
}
/** Returns ≥ 4 when fully clipped; bit 0: first point moved; bit 1: second point moved. */
function clipLineSegment(ax        , ay        , bx        , by        , x1        , y1        , x2        , y2        )         {
  CLIP[0] = ax; CLIP[1] = ay; CLIP[2] = bx; CLIP[3] = by;
  const f1 = clipFlags(ax, ay, x1, y1, x2, y2), f2 = clipFlags(bx, by, x1, y1, x2, y2);
  if ((f1 | f2) === 0) return 0;
  if ((f1 & 5) !== 0 && (f1 & 5) === (f2 & 5)) return 4;
  if ((f1 & 10) !== 0 && (f1 & 10) === (f2 & 10)) return 4;
  let ret = 0;
  if (f1) {
    if (!clipMovePoint(ax, ay, bx, by, x1, y1, x2, y2, 0, f1)) return 4;
    if (CLIP[0] === CLIP[2] && CLIP[1] === CLIP[3]) return 4;
    ret |= 1;
  }
  if (f2) {
    if (!clipMovePoint(ax, ay, bx, by, x1, y1, x2, y2, 1, f2)) return 4;
    if (CLIP[0] === CLIP[2] && CLIP[1] === CLIP[3]) return 4;
    ret |= 2;
  }
  return ret;
}

/**
 * PathNanRemover (the no-codes fast path: a non-finite vertex is skipped and the next finite one becomes a MOVETO)
 * feeding PathClipper (Liang-Barsky against the rect widened by 1 px on every side). A polyline that is finite and
 * inside the rect comes back as itself.
 */
function nanRemoveAndClip(xs              , ys              , x1        , y1        , x2        , y2        )           {
  const n = xs.length;
  let inside = true;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!(x >= x1 && x <= x2 && y >= y1 && y <= y2)) { inside = false; break; }   // NaN fails too
  }
  if (inside) return { xs, ys, moves: n > 0 ? MOVE0 : new Uint32Array(0) };
  const out = new Out(n + 8);
  const inRect = (x        , y        )          => x >= x1 && x <= x2 && y >= y1 && y <= y2;
  let lastX = NaN, lastY = NaN, moveto = true, hasInit = false;
  let i = 0, first = true;
  while (i < n) {
    // PathNanRemover: one vertex out per call
    let x = xs[i], y = ys[i], isMove = first;
    i++;
    if (!(isFin(x) && isFin(y))) {
      let found = false;
      while (i < n) { x = xs[i]; y = ys[i]; i++; if (isFin(x) && isFin(y)) { found = true; break; } }
      if (!found) break;
      isMove = true;
    }
    first = false;
    // PathClipper
    if (isMove) {
      if (moveto && hasInit && inRect(lastX, lastY)) out.move(lastX, lastY);
      lastX = x; lastY = y; hasInit = true; moveto = true;
    } else {
      const moved = clipLineSegment(lastX, lastY, x, y, x1, y1, x2, y2);
      if (moved < 4) {
        if ((moved & 1) !== 0 || moveto) out.move(CLIP[0], CLIP[1]);
        out.line(CLIP[2], CLIP[3]);
        moveto = false;
      }
      lastX = x; lastY = y;
    }
  }
  if (moveto && hasInit && inRect(lastX, lastY)) out.move(lastX, lastY);
  return out.done();
}

// ------------------------------------------------------------------ PathSnapper
/** PathSnapper::should_snap for SNAP_AUTO: at most 1024 vertices in the original path, and every LINETO
 *  axis-aligned (within 1e-4 px) with the vertex before it. */
function shouldSnap(p          , totalVertices        )          {
  if (totalVertices > 1024 || p.xs.length === 0) return false;
  let mi = 1;
  for (let i = 1; i < p.xs.length; i++) {
    if (mi < p.moves.length && p.moves[mi] === i) { mi++; continue; }
    if (Math.abs(p.xs[i - 1] - p.xs[i]) >= 1e-4 && Math.abs(p.ys[i - 1] - p.ys[i]) >= 1e-4) return false;
  }
  return true;
}
function snapAll(p          , strokePx        )           {
  const off = snapOffset(strokePx);
  const xs = new Float64Array(p.xs.length), ys = new Float64Array(p.ys.length);
  for (let i = 0; i < xs.length; i++) { xs[i] = Math.floor(p.xs[i] + 0.5) + off; ys[i] = Math.floor(p.ys[i] + 0.5) + off; }
  return { xs, ys, moves: p.moves };
}

// ------------------------------------------------------------------ PathSimplifier
const grownF64 = (a              , cap        )               => { const b = new Float64Array(cap); b.set(a); return b; };
const grownU32 = (a             , cap        )              => { const b = new Uint32Array(cap); b.set(a); return b; };

/**
 * PathSimplifier::vertex, line for line (Allan Haldane / Michael Droettboom / Kevin Rose): consecutive vertices
 * whose perpendicular distance from the current vector stays under the threshold merge into it; the run's
 * furthest forward and backward points are kept. `thr` is path.simplify_threshold in px (compared squared).
 * The arithmetic is the C++'s, operation for operation. The loop is one closure-free function with the output
 * written inline: a closure over the state would context-allocate every variable the loop touches, which costs the
 * most in the interpreter and baseline tiers where short-lived isolates run.
 */
export function simplifyPath(p          , thr        )           {
  const xs = p.xs, ys = p.ys, moves = p.moves, n = xs.length, nIn = moves.length;
  let cap = n + 16, m = 0;
  let ox               = new Float64Array(cap), oy               = new Float64Array(cap);
  let mcap = 2 * nIn + 8, nm = 0;
  let mv              = new Uint32Array(mcap);
  const thr2 = thr * thr;
  let moveto = true, afterMoveto = false, clipped = false;
  let lastx = 0, lasty = 0;
  let origdx = 0, origdy = 0, origdNorm2 = 0, dnorm2ForwardMax = 0, dnorm2BackwardMax = 0;
  let lastForwardMax = false, lastBackwardMax = false;
  let nextX = 0, nextY = 0, nextBackwardX = 0, nextBackwardY = 0, currVecStartX = 0, currVecStartY = 0;
  let mi = 0, nextMove = nIn > 0 ? moves[0] : n;

  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (moveto || i === nextMove) {
      if (i === nextMove) { mi++; nextMove = mi < nIn ? moves[mi] : n; }
      if (origdNorm2 !== 0.0 && !afterMoveto) {
        // _push(x, y) at a MOVETO (a NaN or clip break); the state it resets is overwritten just below
        if (m + 4 > cap) { cap *= 2; ox = grownF64(ox, cap); oy = grownF64(oy, cap); }
        if (nm + 1 > mcap) { mcap *= 2; mv = grownU32(mv, mcap); }
        if (dnorm2BackwardMax > 0.0) {
          if (lastForwardMax) { ox[m] = nextBackwardX; oy[m] = nextBackwardY; m++; ox[m] = nextX; oy[m] = nextY; m++; }
          else { ox[m] = nextX; oy[m] = nextY; m++; ox[m] = nextBackwardX; oy[m] = nextBackwardY; m++; }
        } else { ox[m] = nextX; oy[m] = nextY; m++; }
        if (clipped) { mv[nm++] = m; ox[m] = lastx; oy[m] = lasty; m++; }
        else if (!lastForwardMax && !lastBackwardMax) { ox[m] = lastx; oy[m] = lasty; m++; }
        lastForwardMax = true; lastBackwardMax = false;
        nextX = x; nextY = y;
      }
      afterMoveto = true;
      lastx = x; lasty = y;
      moveto = false;
      origdNorm2 = 0.0;
      dnorm2BackwardMax = 0.0;
      clipped = true;
      continue;
    }
    afterMoveto = false;
    if (origdNorm2 === 0.0) {
      if (clipped) {
        if (m + 1 > cap) { cap *= 2; ox = grownF64(ox, cap); oy = grownF64(oy, cap); }
        if (nm + 1 > mcap) { mcap *= 2; mv = grownU32(mv, mcap); }
        mv[nm++] = m; ox[m] = lastx; oy[m] = lasty; m++;
        clipped = false;
      }
      origdx = x - lastx; origdy = y - lasty;
      origdNorm2 = origdx * origdx + origdy * origdy;
      dnorm2ForwardMax = origdNorm2;
      dnorm2BackwardMax = 0.0;
      lastForwardMax = true;
      lastBackwardMax = false;
      currVecStartX = lastx; currVecStartY = lasty;
      nextX = lastx = x; nextY = lasty = y;
      continue;
    }
    const totdx = x - currVecStartX, totdy = y - currVecStartY;
    const totdot = origdx * totdx + origdy * totdy;
    const paradx = totdot * origdx / origdNorm2, parady = totdot * origdy / origdNorm2;
    const perpdx = totdx - paradx, perpdy = totdy - parady;
    if (perpdx * perpdx + perpdy * perpdy < thr2) {
      const paradNorm2 = paradx * paradx + parady * parady;
      lastForwardMax = false;
      lastBackwardMax = false;
      if (totdot > 0.0) {
        if (paradNorm2 > dnorm2ForwardMax) { lastForwardMax = true; dnorm2ForwardMax = paradNorm2; nextX = x; nextY = y; }
      } else if (paradNorm2 > dnorm2BackwardMax) {
        lastBackwardMax = true; dnorm2BackwardMax = paradNorm2; nextBackwardX = x; nextBackwardY = y;
      }
      lastx = x; lasty = y;
      continue;
    }
    // _push(x, y): emit the finished vector (and its backward extreme), then start the next one at (x, y)
    if (m + 4 > cap) { cap *= 2; ox = grownF64(ox, cap); oy = grownF64(oy, cap); }
    if (dnorm2BackwardMax > 0.0) {
      if (lastForwardMax) { ox[m] = nextBackwardX; oy[m] = nextBackwardY; m++; ox[m] = nextX; oy[m] = nextY; m++; }
      else { ox[m] = nextX; oy[m] = nextY; m++; ox[m] = nextBackwardX; oy[m] = nextBackwardY; m++; }
    } else { ox[m] = nextX; oy[m] = nextY; m++; }
    if (clipped) {
      if (nm + 1 > mcap) { mcap *= 2; mv = grownU32(mv, mcap); }
      mv[nm++] = m; ox[m] = lastx; oy[m] = lasty; m++;
    } else if (!lastForwardMax && !lastBackwardMax) { ox[m] = lastx; oy[m] = lasty; m++; }   // "would be move_to if not for the artifacts"
    origdx = x - lastx; origdy = y - lasty;
    origdNorm2 = origdx * origdx + origdy * origdy;
    dnorm2ForwardMax = origdNorm2;
    lastForwardMax = true;
    currVecStartX = ox[m - 1]; currVecStartY = oy[m - 1];
    lastx = nextX = x; lasty = nextY = y;
    dnorm2BackwardMax = 0.0;
    lastBackwardMax = false;
    clipped = false;
  }
  // end of path: flush the open vector, then the last vertex
  if (m + 3 > cap) { cap += 3; ox = grownF64(ox, cap); oy = grownF64(oy, cap); }
  if (nm + 3 > mcap) { mcap += 3; mv = grownU32(mv, mcap); }
  if (origdNorm2 !== 0.0) {
    const asMove = moveto || afterMoveto;
    if (asMove) mv[nm++] = m;
    ox[m] = nextX; oy[m] = nextY; m++;
    if (dnorm2BackwardMax > 0.0) { if (asMove) mv[nm++] = m; ox[m] = nextBackwardX; oy[m] = nextBackwardY; m++; }
    moveto = false;
  }
  if (moveto || afterMoveto) mv[nm++] = m;
  ox[m] = lastx; oy[m] = lasty; m++;
  return { xs: ox.subarray(0, m), ys: oy.subarray(0, m), moves: mv.subarray(0, nm) };
}

/**
 * RendererAgg::draw_path for an unfilled, unhatched stroke (clip = simplify-eligible = true): drop non-finite
 * vertices, clip to the canvas (W × H, integers) widened by 1 px, snap when SNAP_AUTO says so, then simplify when
 * Path.should_simplify holds (path.simplify on and at least 128 vertices in the original path).
 * `strokePx` is the stroke width in px (it picks the snap offset). snapOn false is matplotlib's SVG backend (no PathSnapper).
 */
export function cleanupStroke(xs              , ys              , W        , H        , strokePx        , simplify          , snapOn          = true)           {
  const n = Math.min(xs.length, ys.length);
  let p = nanRemoveAndClip(xs.length === n ? xs : xs.subarray(0, n), ys.length === n ? ys : ys.subarray(0, n), -1.0, -1.0, W + 1.0, H + 1.0);
  if (snapOn && shouldSnap(p, n)) p = snapAll(p, strokePx);
  if (simplify.kind === 'on' && simplify.thresholdPx > 0 && n >= 128) p = simplifyPath(p, simplify.thresholdPx);
  return p;
}

/**
 * PathSnapper::should_snap for SNAP_AUTO: at most 1024 vertices, and every segment axis-aligned within
 * 1e-4 px (|dx| < 1e-4 or |dy| < 1e-4). Such paths snap to pixel centres (or edges) in Agg.
 */
export function isRectilinear(xs              , ys              )          {
  if (xs.length < 2 || xs.length > 1024) return false;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - xs[i - 1]) >= 1e-4 && Math.abs(ys[i] - ys[i - 1]) >= 1e-4) return false;
  return true;
}

/** decimateMinMax keeps both ends of any step between samples of one column longer than this (device px). */
export const DECIMATE_STEP_PX = 2;
/**
 * Min/max decimation per device-pixel column (plot's opt-in `decimate`, see Decimate in types.ts). A column is
 * floor(x · perPx). In each run of finite samples sharing one, these are kept, in sample order: the first and the last;
 * the lowest and the highest y, each with the samples either side of it in the run (so a spike keeps the slopes of its
 * flanks, not a chord from the run's ends); and both ends of every step longer than DECIMATE_STEP_PX (so a jump is
 * drawn where it happens, not moved to an extreme's x). A non-finite sample is kept and ends the run, so NaN still
 * breaks the line. x must be non-decreasing over its finite values (a time series); otherwise the input comes back
 * unchanged.
 *
 * Measured on fixture dense_timeseries_tag (3 × 11,641 samples, 720 × 480) against the exact render: first/min/max/last
 * alone changed 4.65 % of the canvas (1,950 px by more than 64); with the flanks and steps, 2.02 % (437 px).
 */
export function decimateMinMax(xs              , ys              , perPx        )     {
  const n = xs.length;
  let last = -Infinity;
  for (let i = 0; i < n; i++) { const v = xs[i]; if (v === v) { if (v < last) return { xs, ys }; last = v; } }
  const keep = new Uint8Array(n);
  let col = 0, first = -1, lo = 0, hi = 0, end = 0, m = 0;
  const flush = ()       => {
    if (first < 0) return;
    keep[first] = 1; keep[end] = 1;
    keep[lo] = 1; if (lo > first) keep[lo - 1] = 1; if (lo < end) keep[lo + 1] = 1;
    keep[hi] = 1; if (hi > first) keep[hi - 1] = 1; if (hi < end) keep[hi + 1] = 1;
    first = -1;
  };
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!(x - x === 0 && y - y === 0)) { flush(); keep[i] = 1; continue; }
    const c = Math.floor(x * perPx);
    if (first < 0 || c !== col) { flush(); col = c; first = lo = hi = end = i; continue; }
    end = i;
    if (Math.abs(y - ys[i - 1]) > DECIMATE_STEP_PX) { keep[i - 1] = 1; keep[i] = 1; }
    if (y < ys[lo]) lo = i;
    if (y > ys[hi]) hi = i;
  }
  flush();
  for (let i = 0; i < n; i++) m += keep[i];
  if (m === n) return { xs, ys };
  const ox = new Float64Array(m), oy = new Float64Array(m);
  for (let i = 0, j = 0; i < n; i++) if (keep[i] === 1) { ox[j] = xs[i]; oy[j] = ys[i]; j++; }
  return { xs: ox, ys: oy };
}
