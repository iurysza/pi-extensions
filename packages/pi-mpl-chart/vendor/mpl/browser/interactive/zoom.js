// mpl/zoom: zoom and pan for an annotated SVG (fig.toSVG({ interactive: true })) where every frame is a real mpljs
// render. The page keeps its server-rendered SVG as the first paint (no JS, no change). The first gesture lazily loads
// the figure from a factory the page supplies (mpljs cannot rebuild a figure from SVG); after that each frame is
// set_xlim / set_ylim on that live Figure and a fresh toSVG({ interactive: true }), or for dense charts toRGBA() on a
// canvas while the gesture runs, then one SVG frame when it settles. Frames are scheduled with requestAnimationFrame:
// input only updates the wanted view, so there is at most one render per frame and an overrunning frame drops the
// states in between. After each SVG frame an `mpl:render` event on the <svg> makes mpl/interactive re-read the new
// sidecars, so hover readouts, tooltips and legend toggles keep working in the zoomed view.
//
//   import { attach } from 'mpl/interactive';
//   import { zoom } from 'mpl/zoom';
//   attach(document);
//   zoom(svgElement, { idPrefix: 'c1-', load: async () => (await import('./chart.js')).build() });
//
// Gestures: wheel / trackpad pinch zooms about the pointer (horizontal wheel pans x), drag pans, Shift+drag zooms to a
// box (a thin box zooms one axis, as matplotlib's zoom tool does), double-click or Escape resets, two-finger touch pinches
// and pans. Over an axis' tick strip (just outside the plot box) only that axis moves. Keys on a focused chart: + and -
// zoom, arrows (Shift+arrows on a plot the hover client has focused) pan, 0 or Escape reset. Log axes zoom in log space;
// date and category axes are linear in their numbers. Axes that share an axis (sharex/sharey, twinx; the sidecar's `g`)
// move together, and by default so do Axes of a figure that show the same x (mpl/interactive's sync rule): x-limits are
// set on all of them in the one render of the frame, y stays each Axes' own, as it was. `sync: 'name'` extends that to
// every figure zoomed with that name; `sync: false` keeps only the shared axes.
                                        
                                               
                                                               
import { groupOf, hubFor, parseSidecar } from './client.js';

/** 'auto' renders SVG frames, or canvas frames during a gesture for a chart above `threshold` SVG elements or whose SVG
 *  frames run over `budgetMs`; 'canvas' always uses canvas during gestures; 'svg' never does. The settled frame is SVG. */
                                                 
/** One rendered frame: what drew it, at what raster scale, how long the render and the DOM update took, and the SVG text
 *  (empty for canvas frames). `settle` marks the SVG frame that follows canvas frames. */
                         
                                                                                                             
                                                                      
  
/** Each Axes' view limits in data units (date numbers on date axes), in data-mpl-axes order; lo > hi when inverted.
 *  `set` says which limits zoom has set on the figure (set_xlim / set_ylim); the others are the figure's own (autoscaled
 *  or set by the page), so the same Figure with these set_*lim calls renders the same frame anywhere, Node included. */
                             
                                                                                                                                           
    
                           
                                                                                                         
                                                
                                                                                                            
                            
                              
                                                                                                               
                             
                                                                                                                     
                               
                            
                                                                                                                            
                                                
                                                                                                               
                                                                                     
                               
                                                                                                             
                            
                                                                                                                      
                                        
                                                                                                                    
                                                                                                                     
                                            
                                                     
                                           
                                                                                                                                   
                                  
  
                              
                                                        
                            
                                                                                               
                                                                                                    
                                                                                                         
                             
                                                                                                                      
                                                        
                                     
                                                                               
                                 
                                                                                  
                               
  

const NS = 'http://www.w3.org/2000/svg';
const CSS = `svg[data-mpl-zoom]{user-select:none;-webkit-user-select:none}
.mpl-zoom-box{fill:var(--mpl-zoom-fill,rgb(30 120 255/.12));stroke:var(--mpl-zoom-stroke,currentColor);stroke-dasharray:4 3;vector-effect:non-scaling-stroke;pointer-events:none}
svg[data-mpl-zoom]:focus-visible{outline:2px solid var(--mpl-focus,Highlight);outline-offset:2px}`;

/** One axis' limits in its zoom space (log axes: log base b of the value). */
                                   
                                                          
                       
                             

const fwd = (a          , v        )         => (a.s === 'log' ? Math.log(v) / Math.log(a.b) : v);
const inv = (a          , u        )         => (a.s === 'log' ? a.b ** u : u);
const now = ()         => performance.now();

/** Zoom U by f about the value at fraction ta, and put that value at fraction tb (f = 1: a pan). */
function remap(u   , ta        , f        , tb        )    {
  const span = u[1] - u[0], a = u[0] + ta * span, s = f * span, lo = a - tb * s;
  return [lo, lo + s];
}

const onLegend = (e       )          => e.target instanceof Element && !!e.target.closest('.mpl-lg');
/** The centre of an Axes' plot box. */
const centre = (a    )                    => [(a.info.box[0] + a.info.box[2]) / 2, (a.info.box[1] + a.info.box[3]) / 2];

/** Make `svg` (an annotated SVG in the page) zoomable; see the module comment. */
export function zoom(svg               , options                                                  )                 {
  const o = options;
  const idPrefix = typeof o.idPrefix === 'string' ? o.idPrefix : '';
  const renderer           = o.renderer === 'svg' || o.renderer === 'canvas' ? o.renderer : 'auto';
  const threshold = typeof o.threshold === 'number' ? o.threshold : 1200;
  const budgetMs = typeof o.budgetMs === 'number' ? o.budgetMs : 12;
  const wheelMode = o.wheel === 'modifier' || o.wheel === 'off' ? o.wheel : 'always';
  const settleMs = typeof o.settleMs === 'number' ? o.settleMs : 150;
  const onFrame = typeof o.onFrame === 'function' ? o.onFrame : ()       => {};
  /** A throwing onFrame must not stall the frame loop (or idle()). */
  const report = (f           )       => { try { onFrame(f); } catch (e) { console.error('mpl/zoom: onFrame threw', e); } };
  const svgText = typeof o.svgText === 'function' ? o.svgText : (t        )         => t;

  if (document.querySelectorAll('style.mpl-zoom-css').length === 0) {
    const s = document.createElement('style');
    s.className = 'mpl-zoom-css';
    s.textContent = CSS;
    document.head.append(s);
  }
  // the server's first paint, kept to restore on reset (exactly what the page shipped)
  // (without any overlay a client already added: they re-add their own)
  const original = Array.from(svg.childNodes).filter((n) => !(n instanceof Element && /\bmpl-(zoom-)?overlay\b/.test(n.getAttribute('class') || ''))).map((n) => n.cloneNode(true));
  const elements = svg.getElementsByTagName('*').length;
  svg.setAttribute('data-mpl-zoom', '');
  const hadTabindex = svg.hasAttribute('tabindex');
  if (!hadTabindex) svg.setAttribute('tabindex', '0');
  if (!svg.hasAttribute('aria-label')) svg.setAttribute('aria-label', 'Chart: scroll or + and - to zoom, drag or arrow keys to pan, Escape to reset');
  svg.style.touchAction = typeof o.touchAction === 'string' ? o.touchAction : 'pan-y';

  // ------------------------------------------------------------ the view: limits per share group, in zoom space
  let axes                = [];
  const readAxes = ()                => Array.from(svg.querySelectorAll('g[data-mpl-axes]')).flatMap((g)       => {
    const md = Array.from(g.children).filter((c) => c.tagName.toLowerCase() === 'metadata');
    return md.length === 0 ? [] : [{ k: Number(g.getAttribute('data-mpl-axes')), info: parseSidecar(md[0].textContent || '{}') }];
  });
  const axisOf = (a    , w       )           => (w === 'x' ? a.info.x : a.info.y);
  /** A share group's key: 'x' or 'y' and the index of the Axes leading it (its own index when the sidecar has no `g`). */
  const hub = hubFor(o.sync === false || typeof o.sync === 'string' ? o.sync : true, svg);
  const gids = new Map                ();
  const key = (a    , w       )         => {
    const g = axisOf(a, w).g;
    if (w === 'x' && hub.length > 0) {
      let id = gids.get(a.k);
      if (typeof id !== 'number') { id = groupOf(hub[0], svg, a.k, a.info); gids.set(a.k, id); }
      return `x${id}`;
    }
    return `${w}${g >= 0 ? g : a.k}`;
  };
  const orig = new Map           (), want = new Map           (), dirty = new Set        ();
  const learn = ()       => {
    for (const a of axes) for (const w of ['x', 'y']         ) {
      const k = key(a, w), ax = axisOf(a, w), u    = [fwd(ax, ax.lim[0]), fwd(ax, ax.lim[1])];
      if (!orig.has(k)) orig.set(k, u);
      if (!dirty.has(k)) want.set(k, u);
    }
  };
  axes = readAxes();
  learn();
  const limOf = (k        )    => want.get(k) || orig.get(k) || [0, 1];
  const view = ()       => axes.map((a) => {
    const kx = key(a, 'x'), ky = key(a, 'y'), y = limOf(ky);
    // an Axes zoom has not moved keeps its own limits (its sync group may be a little different)
    const x    = dirty.has(kx) ? limOf(kx) : [fwd(a.info.x, a.info.x.lim[0]), fwd(a.info.x, a.info.x.lim[1])];
    return { x: [inv(a.info.x, x[0]), inv(a.info.x, x[1])], y: [inv(a.info.y, y[0]), inv(a.info.y, y[1])], set: { x: dirty.has(kx), y: dirty.has(ky) } };
  });
  /** Set a group's limits, kept to a sane zoom range: 1e-9 to 1e4 times the original span. */
  const put = (k        , u   , tell = true)       => {
    const o0 = orig.get(k) || u, span0 = Math.abs(o0[1] - o0[0]) || 1, span = Math.abs(u[1] - u[0]);
    if (!Number.isFinite(u[0]) || !Number.isFinite(u[1]) || span < span0 * 1e-9 || span > span0 * 1e4) return;
    want.set(k, u);
    dirty.add(k);
    // the same x-limits in every figure of the group; each renders in its own requestAnimationFrame callback of this frame
    if (tell && k[0] === 'x') for (const h of hub) for (const z of h.zooms) if (z !== self) z.setX(k, u);
  };

  // ------------------------------------------------------------ pointer geometry
  const toSvg = (cx        , cy        )                    => {
    const m = svg.getScreenCTM();
    if (!m) return [];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const frac = (a    , w       , p                   )         => {
    const b = a.info.box;
    return w === 'x' ? (p[0] - b[0]) / (b[2] - b[0]) : (b[3] - p[1]) / (b[3] - b[1]);
  };
  /** The Axes a gesture at SVG point p moves, and which of their axes: inside a plot box both, on a tick strip one. */
  const targets = (p                   )                                                        => {
    const nav = axes.filter((a) => !a.info.cb), x = p[0], y = p[1];
    const inBox = nav.filter((a) => x >= a.info.box[0] && x <= a.info.box[2] && y >= a.info.box[1] && y <= a.info.box[3]);
    if (inBox.length > 0) return { axes: inBox, mode: 'xy' };
    const strip = (a    , w       )          => {
      const b = a.info.box, mx = 0.18 * (b[2] - b[0]), my = 0.25 * (b[3] - b[1]);
      return w === 'x' ? x >= b[0] && x <= b[2] && ((y > b[3] && y <= b[3] + my) || (y < b[1] && y >= b[1] - my))
        : y >= b[1] && y <= b[3] && ((x < b[0] && x >= b[0] - mx) || (x > b[2] && x <= b[2] + mx));
    };
    const xs = nav.filter((a) => strip(a, 'x'));
    if (xs.length > 0) return { axes: xs, mode: 'x' };
    const ys = nav.filter((a) => strip(a, 'y'));
    return { axes: ys, mode: 'y' };
  };
  /** Apply a zoom/pan to every target axis: from `base` limits, factor f about fraction-of-p0 moved to fraction-of-p1. */
  const move = (base                        , t                                                       , p0                   , p1                   , f        )       => {
    const done = new Set        ();
    for (const a of t.axes) for (const w of ['x', 'y']         ) {
      if (t.mode !== 'xy' && t.mode !== w) continue;
      const k = key(a, w), u = base.get(k);
      if (done.has(k) || !u) continue;
      done.add(k);
      put(k, remap(u, frac(a, w, p0), f, frac(a, w, p1)));
    }
  };

  // ------------------------------------------------------------ the figure and rendering
  let fig                    = [], state                                          = 'idle';
  let saved                                                                                                               = [];
  const applied = new Map           ();
  const ensure = ()       => {
    if (state !== 'idle') return;
    state = 'loading';
    svg.style.cursor = 'progress';
    const loaded = async ()                => {
      try {
        const f = await o.load();
        fig = [f];
        saved = f.axes.map((a) => [a.xaxis.limits, a.yaxis.limits]         );
        state = 'ready';
        schedule();
      } catch (e) { state = 'failed'; console.error('mpl/zoom: load() failed', e); flush(); }
      svg.style.cursor = '';
    };
    void loaded();
  };

  let raf = 0, timer = 0, pressed = 0, lastInput = -Infinity, failed = 0;
  const svgMs           = [];   // the last 5 SVG frames' cost (render + DOM)
  let shown                                = 'original';
  let lastFrame            = { kind: 'svg', scale: 1, renderMs: 0, domMs: 0, svg: '', settle: false, view: view() };
  const waiters                 = [];
  const schedule = ()       => { if (raf === 0) raf = requestAnimationFrame(frame); };
  const busy = ()          => raf !== 0 || timer !== 0 || state === 'loading' || (state === 'ready' && needsFrame(false));
  const flush = ()       => { if (!busy()) for (const w of waiters.splice(0)) w(); };
  const input = ()       => { lastInput = now(); if (state === 'ready') schedule(); else ensure(); };
  const moving = ()          => pressed > 0 || now() - lastInput < settleMs;
  const sameView = ()          => [...dirty].every((k) => { const a = applied.get(k), w = want.get(k); return !!a && !!w && a[0] === w[0] && a[1] === w[1]; });
  /** Whether the shown frame is stale: the view changed, or canvas frames are up and the gesture has settled. */
  const needsFrame = (gesture         )          => {
    if (dirty.size === 0) return false;
    if (!sameView() || shown === 'original') return true;
    return shown === 'canvas' && !gesture;
  };
  /** auto: canvas for a chart past the element threshold, or whose recent SVG frames run over budget (their median, so
   *  one GC pause does not flip it). */
  const useCanvas = ()          => {
    if (renderer !== 'auto') return renderer === 'canvas';
    const m = svgMs.toSorted((a, b) => a - b);
    return elements > threshold || (m.length >= 3 && m[Math.floor(m.length / 2)] > budgetMs);
  };

  const overlay = document.createElementNS(NS, 'g');
  overlay.setAttribute('class', 'mpl-zoom-overlay');
  const boxEl = document.createElementNS(NS, 'rect');
  boxEl.setAttribute('class', 'mpl-zoom-box');
  boxEl.style.display = 'none';
  overlay.append(boxEl);
  svg.append(overlay);
  const fo = document.createElementNS(NS, 'foreignObject'), cv = document.createElement('canvas');
  cv.style.cssText = 'display:block;width:100%;height:100%';
  fo.append(cv);
  let img                       = [];
  /** The last canvas frame's raster: once its pixels are on the page, the next frame renders into it (toRGBA({ out })). */
  let spare                    = [];

  /** Replace the SVG's content and tell the hover client (`mpl:render`); a focused plot or legend control hands its focus
   *  to its counterpart in the new content (the chart itself when there is none, as on a canvas frame). */
  const swap = (nodes                 )       => {
    const ctl = Array.from(svg.querySelectorAll('.mpl-kb, .mpl-lg')), act = document.activeElement;
    const fi = act instanceof Element ? ctl.indexOf(act) : -1;
    svg.replaceChildren(...nodes);
    svg.dispatchEvent(new Event('mpl:render'));
    if (fi < 0) return;
    const next = Array.from(svg.querySelectorAll            ('.mpl-kb, .mpl-lg'));
    if (fi < next.length) next[fi].focus({ preventScroll: true }); else svg.focus({ preventScroll: true });
  };
  const scaleFor = (f        )         => {
    const r = svg.getBoundingClientRect(), w = f.widthIn * f.dpi;
    return Math.max(1, Math.min(3, Math.round((r.width * (window.devicePixelRatio || 1)) / w)));
  };
  const applyView = (f        )       => {
    for (const k of dirty) {
      const u = want.get(k), a = applied.get(k);
      if (!u || (a && a[0] === u[0] && a[1] === u[1])) continue;
      const w        = k[0] === 'x' ? 'x' : 'y', members = axes.filter((x) => key(x, w) === k);
      if (members.length === 0) continue;
      const info = axisOf(members[0], w), lo = inv(info, u[0]), hi = inv(info, u[1]);
      // each share group's leader takes the limits (a sharex or twin follows it); all of them in this one render
      for (const g of new Set(members.map((m) => { const s = axisOf(m, w).g; return s >= 0 ? s : m.k; }))) {
        if (g >= f.axes.length) continue;
        if (w === 'x') f.axes[g].set_xlim(lo, hi); else f.axes[g].set_ylim(lo, hi);
      }
      applied.set(k, u);
    }
  };
  /** The figure's limits as load() built them (autoscaled or the page's own); nothing zoom set is applied any more. */
  function restoreLimits(f        )       {
    applied.clear();
    f.axes.forEach((a, i) => { if (i < saved.length) { a.xaxis.limits = saved[i][0]; a.yaxis.limits = saved[i][1]; } });
  }
  function frame()       {
    raf = 0;
    if (state !== 'ready' || fig.length === 0) { ensure(); flush(); return; }
    const f = fig[0], gesture = moving();
    if (!needsFrame(gesture)) { armSettle(); flush(); return; }
    const canvas = gesture && useCanvas(), settle = !canvas && shown === 'canvas', t0 = now();
    const before = new Map(applied);
    try {
      applyView(f);
      if (canvas) {
        const scale = scaleFor(f), c = f.toRGBA(spare.length > 0 ? { scale, out: spare[0] } : { scale }), t1 = now();
        if (cv.width !== c.w || cv.height !== c.h) { cv.width = c.w; cv.height = c.h; img = []; }
        const ctx = cv.getContext('2d');
        if (!ctx) throw new Error('mpl/zoom: no 2d canvas context');
        if (img.length === 0) img = [ctx.createImageData(c.w, c.h)];
        img[0].data.set(c.px.subarray(0, c.w * c.h * 4));
        ctx.putImageData(img[0], 0, 0);
        spare = [c];
        if (shown !== 'canvas') {
          const vb = svg.viewBox.baseVal;
          for (const [k, v] of [['x', vb.x], ['y', vb.y], ['width', vb.width], ['height', vb.height]]         ) fo.setAttribute(k, String(v));
          swap([fo, overlay]);
        }
        shown = 'canvas';
        lastFrame = { kind: 'canvas', scale, renderMs: t1 - t0, domMs: now() - t1, svg: '', settle: false, view: view() };
      } else {
        const text = f.toSVG({ interactive: true, idPrefix }), t1 = now();
        const tpl = document.createElement('template');
        tpl.innerHTML = svgText(text);
        const next = tpl.content.querySelector('svg');
        if (!next) throw new Error('mpl/zoom: toSVG() gave no <svg>');
        swap([...Array.from(next.childNodes), overlay]);
        axes = readAxes();
        learn();
        shown = 'svg';
        const t2 = now();
        svgMs.push(t2 - t0);
        if (svgMs.length > 5) svgMs.shift();
        lastFrame = { kind: 'svg', scale: 1, renderMs: t1 - t0, domMs: t2 - t1, svg: text, settle, view: view() };
      }
    } catch (e) {
      // a view the figure cannot draw: back to the last one it drew. The figure may hold some of the failed limits, so
      // restore its own and let the next frame set the good ones again (applied is empty, so every dirty one is re-set).
      for (const k of Array.from(dirty)) { const b = before.get(k); if (b) want.set(k, b); else { dirty.delete(k); want.set(k, orig.get(k) || [0, 1]); } }
      restoreLimits(f);
      console.error('mpl/zoom: render failed', e);
      // twice in a row (the last good view fails too): something other than the view is wrong; stop rendering
      if (++failed >= 2) state = 'failed'; else schedule();
      flush();
      return;
    }
    failed = 0;
    report(lastFrame);
    if (needsFrame(moving())) schedule();
    armSettle();
    flush();
  }
  /** Canvas frames are up: check back after the quiet time, when the settled SVG frame replaces them. */
  function armSettle()       { if (shown === 'canvas' && timer === 0) timer = window.setTimeout(() => { timer = 0; schedule(); }, settleMs); }

  const reset0 = ()       => {
    dirty.clear();
    for (const [k, u] of orig) want.set(k, u);
    if (fig.length > 0) restoreLimits(fig[0]);
    swap([...original.map((n) => n.cloneNode(true)), overlay]);
    axes = readAxes();
    shown = 'original';
    lastFrame = { kind: 'svg', scale: 1, renderMs: 0, domMs: 0, svg: '', settle: false, view: view() };
    report(lastFrame);
    flush();
  };
  const reset = ()       => { reset0(); for (const h of hub) for (const z of h.zooms) if (z !== self) z.reset(); };
  const self          = {
    svg,
    setX: (k, u) => { if (!orig.has(k)) return; put(k, u, false); input(); },
    reset: reset0,
  };
  for (const h of hub) h.zooms.add(self);

  // ------------------------------------------------------------ input
                                                                                                                                                                                                          
  let drag                  = [];
  const touches = new Map                           ();
  let pinch                                                                                                                                                                               = [];
  const showBox = (a                   , b                   )       => {
    boxEl.setAttribute('x', String(Math.min(a[0], b[0]))); boxEl.setAttribute('y', String(Math.min(a[1], b[1])));
    boxEl.setAttribute('width', String(Math.abs(a[0] - b[0]))); boxEl.setAttribute('height', String(Math.abs(a[1] - b[1])));
    boxEl.style.display = '';
  };
  const mid = ()                    => {
    const ps = [...touches.values()];
    return [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2];
  };
  const dist = ()         => { const ps = [...touches.values()]; return Math.hypot(ps[0][0] - ps[1][0], ps[0][1] - ps[1][1]); };

  const down = (e              )       => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || onLegend(e)) return;
    const p = toSvg(e.clientX, e.clientY);
    if (p.length !== 2) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, p);
      if (touches.size === 2) {
        const m = mid(), t = targets(m);
        drag = [];
        pinch = t.axes.length > 0 ? [{ d0: dist(), m0: m, base: new Map(want), t }] : [];
        return;
      }
    }
    const t = targets(p);
    if (t.axes.length === 0) return;
    // no text selection or drag image; focus stays where it was (keyboard users Tab to the chart; focusing here would
    // light the focus ring on Shift+drag, which Chrome counts as keyboard use)
    if (e.pointerType !== 'touch') e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    pressed++;
    ensure();
    drag = [{ id: e.pointerId, start: p, base: new Map(want), t, box: e.shiftKey }];
    svg.style.cursor = e.shiftKey ? 'crosshair' : 'grabbing';
  };
  const pmove = (e              )       => {
    const p = toSvg(e.clientX, e.clientY);
    if (p.length !== 2) return;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, p);
      if (touches.size === 2 && pinch.length > 0) {
        const pc = pinch[0], d = dist();
        if (d > 0) { move(pc.base, pc.t, pc.m0, mid(), pc.d0 / d); input(); }
        return;
      }
    }
    if (drag.length === 0 || drag[0].id !== e.pointerId) {
      if (e.buttons === 0) svg.style.cursor = targets(p).axes.length > 0 ? (e.shiftKey ? 'crosshair' : 'grab') : '';
      return;
    }
    const d = drag[0];
    if (d.box) { showBox(d.start, p); return; }
    move(d.base, d.t, d.start, p, 1);
    input();
  };
  const up = (e              )       => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch.length > 0) { pinch = []; pressed = 0; drag = []; lastInput = now(); schedule(); return; }
    }
    if (drag.length === 0 || drag[0].id !== e.pointerId) return;
    const d = drag[0];
    drag = [];
    pressed = Math.max(0, pressed - 1);
    svg.style.cursor = '';
    if (d.box && e.type === 'pointerup') {
      boxEl.style.display = 'none';
      const p = toSvg(e.clientX, e.clientY);
      if (p.length === 2) boxZoom(d, p);
    }
    boxEl.style.display = 'none';
    lastInput = -Infinity;   // released: the next frame is the settled one
    if (state === 'ready') schedule();
  };
  /** matplotlib's zoom-to-rect: a box under 5 px on one side zooms only the other axis; under 5 px on both, nothing. */
  const boxZoom = (d      , p                   )       => {
    const m = svg.getScreenCTM(), sx = m ? Math.hypot(m.a, m.b) : 1, sy = m ? Math.hypot(m.c, m.d) : 1;
    const wOk = Math.abs(p[0] - d.start[0]) * sx >= 5, hOk = Math.abs(p[1] - d.start[1]) * sy >= 5;   // screen pixels
    if (!wOk && !hOk) return;
    const done = new Set        ();
    for (const a of d.t.axes) for (const w of ['x', 'y']         ) {
      if ((w === 'x' && (!wOk || d.t.mode === 'y')) || (w === 'y' && (!hOk || d.t.mode === 'x'))) continue;
      const k = key(a, w), u = d.base.get(k);
      if (done.has(k) || !u) continue;
      done.add(k);
      const t0 = frac(a, w, d.start), t1 = frac(a, w, p), lo = Math.min(t0, t1), hi = Math.max(t0, t1);
      put(k, [u[0] + lo * (u[1] - u[0]), u[0] + hi * (u[1] - u[0])]);
    }
    input();
  };
  const wheel = (e            )       => {
    if (wheelMode === 'off' || (wheelMode === 'modifier' && !e.ctrlKey && !e.metaKey)) return;
    const p = toSvg(e.clientX, e.clientY);
    if (p.length !== 2) return;
    const t = targets(p);
    if (t.axes.length === 0) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? svg.getBoundingClientRect().height : 1;
    const dy = e.deltaY * unit, dx = e.deltaX * unit;
    if (Math.abs(dx) > Math.abs(dy) && !e.ctrlKey) {
      // a sideways scroll pans x, by the scrolled pixels
      const m = svg.getScreenCTM(), sx = m ? Math.hypot(m.a, m.b) : 1;
      move(new Map(want), { axes: t.axes, mode: t.mode === 'y' ? 'y' : 'x' }, p, t.mode === 'y' ? [p[0], p[1] - dx / sx] : [p[0] - dx / sx, p[1]], 1);
    } else {
      // trackpad pinch arrives as ctrl+wheel with small deltas: a steeper curve
      const f = Math.exp(Math.max(-1, Math.min(1, dy * (e.ctrlKey ? 0.01 : 0.002))));
      move(new Map(want), t, p, p, f);
    }
    input();
  };
  const dbl = (e            )       => { if (!onLegend(e)) reset(); };
  const key0 = (e               )       => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act = document.activeElement, kb = act instanceof Element && act.classList.contains('mpl-kb');
    const k = kb && act instanceof Element ? Number(act.getAttribute('data-mpl-k')) : -1;
    const nav = axes.filter((a) => !a.info.cb && (k < 0 || a.k === k));
    if (nav.length === 0) return;
    const zoomBy = (f        )       => { for (const a of nav) move(new Map(want), { axes: [a], mode: 'xy' }, centre(a), centre(a), f); };
    const panBy = (fx        , fy        )       => {
      for (const a of nav) {
        const p = centre(a), b = a.info.box;
        move(new Map(want), { axes: [a], mode: 'xy' }, p, [p[0] - fx * (b[2] - b[0]), p[1] + fy * (b[3] - b[1])], 1);
      }
    };
    const arrows                                                      = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, 0.1], ArrowDown: [0, -0.1] };
    if (e.key === '+' || e.key === '=') zoomBy(0.8);
    else if (e.key === '-' || e.key === '_') zoomBy(1.25);
    else if (Object.hasOwn(arrows, e.key) && (!kb || e.shiftKey)) panBy(arrows[e.key][0], arrows[e.key][1]);
    else if (e.key === '0' || e.key === 'Escape') { if (drag.length > 0 && drag[0].box) { drag = []; pressed = 0; boxEl.style.display = 'none'; return; } reset(); return; }
    else return;
    e.preventDefault();
    lastInput = -Infinity;   // a key press is a whole gesture: draw it settled
    if (state === 'ready') schedule(); else ensure();
  };
  const hover = ()       => { if (o.preload === 'hover') ensure(); };

  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', pmove);
  svg.addEventListener('pointerup', up);
  svg.addEventListener('pointercancel', up);
  svg.addEventListener('wheel', wheel, { passive: false });
  svg.addEventListener('dblclick', dbl);
  svg.addEventListener('keydown', key0);
  svg.addEventListener('pointerenter', hover);
  svg.addEventListener('focusin', hover);

  return {
    view,
    setView: (k, x, y) => {
      const a = axes.find((v) => v.k === k);
      if (!a) return;
      put(key(a, 'x'), [fwd(a.info.x, x[0]), fwd(a.info.x, x[1])]);
      put(key(a, 'y'), [fwd(a.info.y, y[0]), fwd(a.info.y, y[1])]);
      lastInput = -Infinity;
      if (state === 'ready') schedule(); else ensure();
    },
    reset,
    idle: () => new Promise      ((r) => { waiters.push(r); flush(); }),
    last: () => lastFrame,
    destroy: () => {
      svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', pmove); svg.removeEventListener('pointerup', up);
      svg.removeEventListener('pointercancel', up); svg.removeEventListener('wheel', wheel); svg.removeEventListener('dblclick', dbl);
      svg.removeEventListener('keydown', key0); svg.removeEventListener('pointerenter', hover); svg.removeEventListener('focusin', hover);
      if (raf !== 0) cancelAnimationFrame(raf);
      if (timer !== 0) clearTimeout(timer);
      raf = 0; timer = 0;
      overlay.remove();
      svg.removeAttribute('data-mpl-zoom');
      for (const h of hub) h.zooms.delete(self);
      if (!hadTabindex) svg.removeAttribute('tabindex');
      flush();
    },
  };
}
