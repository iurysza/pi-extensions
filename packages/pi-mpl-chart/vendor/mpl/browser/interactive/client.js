// mpl/interactive: hover readouts, nearest-point tooltips, artist highlighting and legend toggles over SVGs written
// by fig.toSVG({ interactive: true }). Zero dependencies, no framework, nothing re-rendered: it reads each Axes'
// sidecar (<g data-mpl-axes="k"><metadata class="mpl-axes">, schema in src/render/annotate.ts), maps the pointer
// with getScreenCTM (so scaled, responsive and several inlined SVGs all work), and only toggles classes and draws a
// small overlay. Theming is CSS custom properties (--mpl-*) and classes (.mpl-*); see README, "Interactive SVG".
// When the SVG's content is replaced (mpl/zoom re-renders it), an `mpl:render` event on the <svg> re-reads the new
// sidecars; legend toggles carry over.
//
//   import { attach } from 'mpl/interactive';
//   const detach = attach(document);      // every annotated SVG under the root

/** One axis of an Axes as the sidecar describes it. `lim` is the view interval (inverted when lim[0] > lim[1]); `g` the
 *  index of the Axes that leads its share group (sharex/sharey/twinx), -1 when the sidecar predates it; `t` the axis
 *  label; `fixed` whether the axis has fixed tick labels (set_xticklabels) and `tk` those labels as [loc, text] pairs; `step` the resolution of the value being formatted (days on a date axis; 0 when unknown: the client fills it in). */
                                                                                                                                                                                                                                                                                                                
/** One artist: its kind, label, colour and points (data `d` and pixel `p`, flat x/y pairs), as the sidecar has them. */
                          
                                                                                                                          
                                                                                                                  
  
                        
                                                                                                                            
                                                                                                      
  
/** Formats a value on an axis for display (`exact`: a data point, not the cursor); the default is formatValue. A custom
 *  formatter's text is used as is: the axis unit is only appended to the default formatter's. */
                                                                                                                 

// ---------------------------------------------------------------- sidecar parsing (no casts: parse, don't assert)
                                             
const isObj = (v         )           => typeof v === 'object' && !!v && !Array.isArray(v);
const field = (o         , k        )          => (isObj(o) && Object.hasOwn(o, k) ? o[k] : 0);
const nums = (v         )           => (Array.isArray(v) ? v.filter((n)              => typeof n === 'number') : []);
const str = (v         , d = '')         => (typeof v === 'string' ? v : d);
const num = (v         , d        )         => (typeof v === 'number' ? v : d);

/** A sidecar axis' fixed tick labels: [loc, text] pairs. Bad rows are dropped. */
const tickLabels = (v         )                                         =>
  (Array.isArray(v) ? v.flatMap((r)                                => (Array.isArray(r) && typeof r[0] === 'number' && typeof r[1] === 'string' ? [[r[0], r[1]]] : [])) : []);
/** The fixed label of a tick exactly at v (within rounding of the sidecar's numbers), or '': the axis shows nothing there. */
const tickLabelAt = (tk                                        , v        )         =>
  tk.reduce((found, [loc, text]) => (found === '' && Math.abs(loc - v) <= 1e-9 * Math.max(1, Math.abs(loc)) ? text : found), '');

function axisOf(o         , px        )           {
  const lim = nums(field(o, 'lim')), b = field(o, 'b'), names = field(o, 'names'), g = field(o, 'g');
  return { s: str(field(o, 's'), 'linear'), lim: [lim[0] || 0, lim.length > 1 ? lim[1] : 1], b: typeof b === 'number' ? b : 10,
           names: Array.isArray(names) ? names.map((n) => String(n)) : [], px, g: typeof g === 'number' && Object.hasOwn(Object(o), 'g') ? g : -1, t: str(field(o, 't')), step: 0, fixed: Array.isArray(field(o, 'tk')), tk: tickLabels(field(o, 'tk')) };
}

/** The sidecar JSON of one Axes, parsed. Throws on text that is not JSON. */
export function parseSidecar(text        )           {
  const j          = JSON.parse(text);
  const bx = nums(field(j, 'box'));
  const box                                   = [bx[0] || 0, bx[1] || 0, bx[2] || 0, bx[3] || 0];
  const arts = field(j, 'a'), lg = field(j, 'lg');
  return {
    box, x: axisOf(field(j, 'x'), box[2] - box[0]), y: axisOf(field(j, 'y'), box[3] - box[1]), cb: field(j, 'cb') === 1,
    a: (Array.isArray(arts) ? arts : []).map((o         , i)             => ({
      i, k: str(field(o, 'k')), l: str(field(o, 'l')), c: str(field(o, 'c'), 'currentColor'), s: str(field(o, 's'), 'xy'), ds: str(field(o, 'ds')),
      d: nums(field(o, 'd')), p: nums(field(o, 'p')), b: nums(field(o, 'b')), r: num(field(o, 'r'), 0),
    })),
    lg: (Array.isArray(lg) ? lg : []).map(nums).filter((e) => e.length === 5), ti: str(field(j, 'ti')),
  };
}

// ---------------------------------------------------------------- data <-> pixel (the inverse of core/frame.ts)
const fwd = (a          , v        )         => (a.s === 'log' ? Math.log(v) / Math.log(a.b) : v);
const inv = (a          , v        )         => (a.s === 'log' ? a.b ** v : v);

/** A pixel (SVG user units, y down) to data on one axis of an Axes. */
export function pixelToData(ax          , which           , p        )         {
  const a = which === 'x' ? ax.x : ax.y;
  const t = which === 'x' ? (p - ax.box[0]) / (ax.box[2] - ax.box[0]) : (ax.box[3] - p) / (ax.box[3] - ax.box[1]);
  const v0 = fwd(a, a.lim[0]), v1 = fwd(a, a.lim[1]);
  return inv(a, v0 + t * (v1 - v0));
}
/** Data to a pixel (SVG user units, y down) on one axis of an Axes. */
export function dataToPixel(ax          , which           , v        )         {
  const a = which === 'x' ? ax.x : ax.y;
  const v0 = fwd(a, a.lim[0]), v1 = fwd(a, a.lim[1]), t = (fwd(a, v) - v0) / (v1 - v0);
  return which === 'x' ? ax.box[0] + t * (ax.box[2] - ax.box[0]) : ax.box[3] - t * (ax.box[3] - ax.box[1]);
}

// ---------------------------------------------------------------- formatting
const trim = (s        )         => (/^-0\.?0*$/.test(s) ? s.slice(1) : s);
const clip0 = (s        )         => trim(s.includes('.') ? s.replace(/\.?0+$/, '') : s);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n        )         => String(n).padStart(2, '0');
const SEC = 1 / 86400, MIN = 1 / 1440;

/** A date at resolution `r` days: "2026", "Nov 2026", "Nov 5", "Nov 5, 08:40", "Nov 5, 08:40:05", "Nov 5, 08:40:05.25".
 *  Rounded to that resolution, in UTC; the year only when the axis crosses one. */
function formatDate(v        , a          , r        )         {
  const digits = r >= SEC ? 0 : r >= SEC / 10 ? 1 : r >= SEC / 100 ? 2 : 3;
  const unit = r >= 1 ? 1 : r >= MIN ? MIN : r >= SEC ? SEC : SEC / 10 ** digits;
  const d = new Date(Math.round(Math.round(v / unit) * unit * 864e5)), y = d.getUTCFullYear(), mon = MONTHS[d.getUTCMonth()];
  if (r >= 360) return String(y);
  if (r >= 28) return `${mon} ${y}`;
  const crosses = new Date(a.lim[0] * 864e5).getUTCFullYear() !== new Date(a.lim[1] * 864e5).getUTCFullYear();
  const day = `${mon} ${d.getUTCDate()}${crosses ? `, ${y}` : ''}`;
  if (r >= 1) return day;
  const hm = `${day}, ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  if (r >= MIN) return hm;
  const sec = `${hm}:${p2(d.getUTCSeconds())}`;
  return digits === 0 ? sec : `${sec}.${String(d.getUTCMilliseconds()).padStart(3, '0').slice(0, digits)}`;
}

/**
 * Dates in UTC at the resolution they have (the series' `step` for a point, one pixel for the cursor), categories by
 * name, log values to 3 significant digits, linear values to the axis' per-pixel resolution with at least 3 significant
 * digits (a data point keeps no trailing zeros).
 */
export function formatValue(v        , a          , _which           , exact         )         {
  if (!Number.isFinite(v)) return String(v);
  const res = Math.abs(a.lim[1] - a.lim[0]) / Math.max(a.px, 1);
  if (a.s === 'date') return formatDate(v, a, exact && a.step > 0 ? a.step : res);
  if (a.s === 'cat') { const n = a.names[Math.round(v)]; if (typeof n === 'string' && (exact || Math.abs(v - Math.round(v)) < 0.5)) return n; }
  if (a.s === 'log') return Math.abs(v) >= 100 ? String(Math.round(v)) : String(Number(v.toPrecision(3)));
  const axis = Math.ceil(-Math.log10(res));
  if (!exact) return trim(v.toFixed(Math.min(12, Math.max(0, axis))));
  return clip0(v.toFixed(Math.min(12, Math.max(0, axis, v === 0 ? 0 : 2 - Math.floor(Math.log10(Math.abs(v)))))));
}

const steps = new WeakMap                    ();
/** The resolution a series' dates actually have, in days: the coarsest of day / minute / second that every point sits on
 *  (the sidecar keeps 12 significant digits, so a date number is only good to ~5 ms), month or year when every point is
 *  the first of one; irregular sub-second stamps count at their spacing, or a pixel. */
function dateStep(art            , o        , a          )         {
  const memo = steps.get(art);
  if (typeof memo === 'number') return memo;
  const vs = art.d.filter((_, i) => i % 2 === o);
  const on = (u        )          => vs.every((v) => Math.abs(v / u - Math.round(v / u)) * u <= 5 * 10 ** (Math.floor(Math.log10(Math.abs(v) || 1)) - 11));
  const dates = vs.map((v) => new Date(Math.round(v) * 864e5));
  let r = SEC / 100;
  if (on(1)) r = vs.length > 1 && dates.every((d) => d.getUTCDate() === 1) ? (dates.every((d) => d.getUTCMonth() === 0) ? 365 : 30) : 1;
  else if (on(MIN)) r = MIN;
  else if (on(SEC)) r = SEC;
  else {
    const span = Math.max(...vs) - Math.min(...vs), gap = vs.length > 1 ? span / (vs.length - 1) : Infinity;
    r = Math.max(r, Math.min(gap, Math.abs(a.lim[1] - a.lim[0]) / Math.max(a.px, 1)));
  }
  steps.set(art, r);
  return r;
}

const UNIT = /^(%|‰|°[CF]|[nµu]?s|ms|sec|min|hrs?|h|[kKMGTP]?i?[Bb]|bytes?|bps|[kMG]?Hz|[kM]?[WV]|[mck]?m|k?g|rps|qps)$/;
const RATE = /^[^\s/]+ ?\/ ?[^\s/]+$/;
/** An axis label read for units. `plain`: appended to values as is ("ms", from "ms", "latency (ms)" or "Latency [ms]");
 *  `muted`: a rate that reads as a phrase ("requests / s"), shown quietly; `name`: the label without its unit ("latency"). */
export function unitOf(label        )                                                                            {
  const t = label.trim(), p = /^(.*?)\s*[([]([^()[\]]{1,12})[)\]]$/.exec(t);
  const bare = p ? p[1] : t, u = p ? p[2].split(',')[0].trim() : t;
  if (UNIT.test(u)) return { plain: u, muted: '', name: p ? bare : '' };
  if (RATE.test(u) && u.length <= 16) return { plain: '', muted: u, name: p ? bare : '' };
  return { plain: '', muted: '', name: p && /^(log|linear|symlog|logit)/i.test(u) ? bare : t };
}
const glue = (v        , u        )         => (u === '' ? v : `${v}${/^[%‰°]/.test(u) ? '' : ' '}${u}`);

// ---------------------------------------------------------------- nearest point
                                                                                          
/** The nearest visible point to (px, py): ordered series (s 'x' | 'y') snap along their axis (steps to the step
 *  that holds the value there), scatter and unordered lines by 2D distance; across artists, the closest point wins. */
export function nearest(arts                       , px        , py        , off                      = new Set())                 {
  let best                 = [];
  for (const art of arts) {
    const n = art.p.length / 2;
    if (n === 0 || off.has(art.i)) continue;
    const o = art.s === 'y' ? 1 : 0, q = o === 1 ? py : px;
    let j = 0, dj = Infinity;
    for (let i = 0; i < n; i++) {
      const d = art.s === 'xy' ? Math.hypot(art.p[2 * i] - px, art.p[2 * i + 1] - py) : Math.abs(art.p[2 * i + o] - q);
      if (d < dj) { dj = d; j = i; }
    }
    if (art.ds !== '' && n > 1) {
      const dir = Math.sign(art.p[2 * (n - 1) + o] - art.p[o]), side = (q - art.p[2 * j + o]) * dir;
      if (art.ds === 'post' && side < 0 && j > 0) j--;
      if (art.ds === 'pre' && side > 0 && j < n - 1) j++;
    }
    const dist = Math.hypot(art.p[2 * j] - px, art.p[2 * j + 1] - py);
    if (best.length === 0 || dist <= best[0].dist) best = [{ art, j, dist }];   // a tie goes to the later artist (stacked on top)
  }
  return best;
}

// ---------------------------------------------------------------- DOM
const NS = 'http://www.w3.org/2000/svg';
const CSS = `[data-mpl-axes] [data-artist]{transition:none}
@media (prefers-reduced-motion:no-preference){[data-mpl-axes] [data-artist]{transition:opacity .12s}}
.mpl-dim{opacity:var(--mpl-dim-opacity,.5)}.mpl-off{display:none}
.mpl-cross line,.mpl-ghost line{stroke:var(--mpl-crosshair,currentColor);stroke-opacity:var(--mpl-crosshair-opacity,.45);stroke-dasharray:3 3}
.mpl-cross line,.mpl-ghost *,.mpl-dot,.mpl-lg,.mpl-kb{vector-effect:non-scaling-stroke}
.mpl-ghost circle{fill:var(--mpl-dot-fill,Canvas);stroke-width:1.5}
.mpl-dot{fill:var(--mpl-dot-fill,Canvas);stroke:var(--mpl-dot,currentColor);stroke-width:2}
.mpl-lg,.mpl-kb{fill:transparent;outline:none}.mpl-lg{cursor:pointer}
.mpl-lg.mpl-lg-off{fill:var(--mpl-legend-off,Canvas);fill-opacity:var(--mpl-legend-off-opacity,.7)}
.mpl-lg:focus-visible,.mpl-kb:focus-visible{stroke:var(--mpl-focus,Highlight);stroke-width:2}
.mpl-tip{position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;width:max-content;max-width:min(var(--mpl-tip-max-width,100vw),var(--mpl-tip-room,100vw));overflow-wrap:anywhere;font:var(--mpl-tip-font,12px/1.4 system-ui,sans-serif);font-variant-numeric:tabular-nums;background:var(--mpl-tip-bg,Canvas);color:var(--mpl-tip-fg,CanvasText);border:1px solid var(--mpl-tip-border,GrayText);border-radius:var(--mpl-tip-radius,4px);padding:var(--mpl-tip-padding,4px 8px);box-shadow:var(--mpl-tip-shadow,0 2px 8px rgb(0 0 0/.18))}
.mpl-tip-compact{font-size:var(--mpl-tip-compact-size,11px);line-height:1.3;padding:var(--mpl-tip-compact-padding,3px 6px)}
.mpl-tip[hidden]{display:none}.mpl-tip b{font-weight:600;margin-right:.5em}.mpl-tip i{display:inline-block;width:.7em;height:.7em;border-radius:2px;margin-right:.4em}.mpl-tip small{display:block;font-size:var(--mpl-tip-small-size,smaller);opacity:.7}.mpl-tip u{text-decoration:none;opacity:.7}`;

const el =                                       (tag   , attrs                                           )                          => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
const html =                                        (tag   , text = '', cls = '')                           => {
  const e = document.createElement(tag);
  if (text !== '') e.textContent = text;
  if (cls !== '') e.className = cls;
  return e;
};

/** Keyboard stepping on a focused plot: the point index step per key (Home/End jump, Up/Down change series). */
const KEYS                                   = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0, Home: 0, End: 0 };

const inside = (b                 , x        , y        )          => x >= b[0] - 1 && x <= b[2] + 1 && y >= b[1] - 1 && y <= b[3] + 1;

// ---------------------------------------------------------------- sync: which Axes read and move together
/** Whether two Axes show the same x: the same kind of scale (never categories), x-limits at least 80% the same
 *  (intersection over union), and each holding data along x (a series with points on a date axis; on a linear or log axis
 *  a series ordered along x, so scatter plots and horizontal bars, whose x is a value and not a position, stay apart). */
function sameX(a          , b          )          {
  if (a.x.s !== b.x.s || a.x.s === 'cat' || a.cb || b.cb) return false;
  const along = (q          )          => q.a.some((s) => s.p.length > 0 && (q.x.s === 'date' || s.s === 'x'));
  if (!along(a) || !along(b)) return false;
  const lo1 = Math.min(fwd(a.x, a.x.lim[0]), fwd(a.x, a.x.lim[1])), hi1 = Math.max(fwd(a.x, a.x.lim[0]), fwd(a.x, a.x.lim[1]));
  const lo2 = Math.min(fwd(b.x, b.x.lim[0]), fwd(b.x, b.x.lim[1])), hi2 = Math.max(fwd(b.x, b.x.lim[0]), fwd(b.x, b.x.lim[1]));
  const union = Math.max(hi1, hi2) - Math.min(lo1, lo2);
  return union > 0 && (Math.min(hi1, hi2) - Math.max(lo1, lo2)) / union >= 0.8;
}
                                                                                                                                        
                                                                                                                                                                         
/** The Axes that sync with each other: one per figure by default, one per name across figures. */
                                                                                                                                        
/** A zoom controller as its hub sees it: another figure's x-limits arriving, and a reset. */
                                                                                                                                                      
const named = new Map             (), bySvg = new WeakMap                    ();
const newHub = ()      => ({ entries: [], painters: new Set(), zooms: new Set(), last: [] });
/** The hub of `svg` for a `sync` option: true its own figure, a name shared across figures, false none (an empty list). */
export function hubFor(sync                  , svg               )                 {
  if (sync === false) return [];
  const m = typeof sync === 'string' ? named.get(sync) : bySvg.get(svg);
  if (m) return [m];
  const h = newHub();
  if (typeof sync === 'string') named.set(sync, h); else bySvg.set(svg, h);
  return [h];
}
/** The sync group of Axes `k` of `svg`, fixed by its first-paint limits (a zoomed view must not change who it syncs with).
 *  Axes sharing an x axis (sharex, twinx) are one group; otherwise an Axes joins the first group whose leader it matches. */
export function groupOf(h     , svg               , k        , info          )         {
  const known = h.entries.find((e) => e.svg === svg && e.k === k);
  if (known) return known.gid;
  const twin = h.entries.find((e) => e.svg === svg && info.x.g >= 0 && e.info.x.g === info.x.g && !info.cb);
  const lead = twin ? [] : h.entries.filter((e) => e.lead && sameX(e.info, info));
  const gid = twin ? twin.gid : lead.length > 0 ? lead[0].gid : h.entries.reduce((m, e) => Math.max(m, e.gid + 1), 0);
  h.entries.push({ svg, k, info, gid, lead: !twin && lead.length === 0 });
  return gid;
}

                                                                                                                                                 
/** The SVG currently showing the readout: what another SVG, a tap outside, Escape or a scroll asks of it. */
                                                                                                    
/** The tooltip one attach() shares among its SVGs, its settings, and which SVG holds it (at most one). */
                                                                                                                                                                                                                                                                                  

/** The part of `svg` the reader can see, as client [left, top, right, bottom]: its box cut by the viewport and any
 *  ancestor that clips (a sideways-scrolling figure). Empty (right <= left) when it is out of view. */
function room(svg               )                    {
  const r = svg.getBoundingClientRect();
  let l = Math.max(r.left, 0), t = Math.max(r.top, 0), R = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight);
  for (let p = svg.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflow === 'visible') continue;
    const q = p.getBoundingClientRect();
    l = Math.max(l, q.left); t = Math.max(t, q.top); R = Math.min(R, q.right); B = Math.min(B, q.bottom);
  }
  return [l, t, R, B];
}
const clamp = (lo        , hi        , v        )         => Math.max(lo, Math.min(hi, v));
const onLegend = (e       )          => e.target instanceof Element && e.target.classList.contains('mpl-lg');

/** Wire one annotated SVG, and again whenever its content is re-rendered (`mpl:render`); returns its detach function. */
function wire(svg               , tip     )             {
  const offs = new Map                     ();   // legend toggles by Axes index: they survive a re-render
  const at           = [];                        // [x, y, touch 0|1] of the last pointer readout, in SVG user units
  let undo = wireContent(svg, tip, offs, at, false);
  // the readout stays up when it was (a wheel zoom under a resting pointer, a tapped value); whoever replaced the content keeps focus
  const rerender = ()       => { const shown = tip.on.some((o) => o.svg === svg); undo(); undo = wireContent(svg, tip, offs, at, shown); };
  svg.addEventListener('mpl:render', rerender);
  return () => {
    svg.removeEventListener('mpl:render', rerender); undo();
    for (const h of hubFor(tip.sync, svg)) for (let i = h.entries.length - 1; i >= 0; i--) if (h.entries[i].svg === svg) h.entries.splice(i, 1);
  };
}

function wireContent(svg               , tip     , offs                          , at          , shown         )             {
  const { format } = tip;
  const axes         = [];
  for (const g of Array.from(svg.querySelectorAll('g[data-mpl-axes]'))) {
    const md = Array.from(g.children).filter((c) => c.tagName.toLowerCase() === 'metadata');
    if (md.length === 0) continue;
    const groups = new Map                   ();
    for (const e of Array.from(g.querySelectorAll('[data-artist]'))) {
      const i = Number(str(e.getAttribute('data-artist')).split('/')[1]);
      groups.set(i, [...(groups.get(i) || []), e]);
    }
    const k = Number(g.getAttribute('data-mpl-axes')), off = offs.get(k) || new Set        ();
    offs.set(k, off);
    for (const i of off) for (const e of groups.get(i) || []) e.classList.add('mpl-off');
    axes.push({ k, info: parseSidecar(str(md[0].textContent)), groups, off });
  }
  if (axes.length === 0) return () => {};
  const layer = el('g', { class: 'mpl-overlay', 'pointer-events': 'none' });
  const cross = el('g', { class: 'mpl-cross' }), vx = el('line', {}), hy = el('line', {}), dot = el('circle', { class: 'mpl-dot', r: 3.5 });
  cross.append(vx, hy, dot);
  cross.style.display = 'none';
  const hits = el('g', { 'pointer-events': 'all' });
  layer.append(cross, hits);
  svg.append(layer);

  const dims            = [];
  const undim = ()       => { for (const e of dims.splice(0)) e.classList.remove('mpl-dim'); };
  let lx = 0, ly = 0, touch = false;   // where the readout is anchored (SVG user units), and whether a finger put it there
  // the other panels' crosshairs: a line and a dot per series on every synced Axes, moved without re-rendering
  const hub = hubFor(tip.sync, svg);
  const ghosts = hub.length === 0 ? [] : axes.map((a) => {
    const g = el('g', { class: 'mpl-ghost' }), line = el('line', { y1: a.info.box[1], y2: a.info.box[3] }), series = a.info.a.filter((s) => s.s === 'x' && s.p.length > 0);
    const dots = series.map((s) => { const c = el('circle', { r: 2.5 }); c.style.stroke = s.c; return c; });
    g.append(line, ...dots);
    g.style.display = 'none';
    layer.prepend(g);
    return { a, g, line, series, dots, gid: groupOf(hub[0], svg, a.k, a.info), gap: Math.max(8, ...series.map((s) => 1.5 * Math.abs(s.p[s.p.length - 2] - s.p[0]) / Math.max(1, s.p.length / 2 - 1))) };
  });
  const painter          = {
    paint: (gid, v, skip, from, hit) => {
      for (const g of ghosts) {
        const b = g.a.info.box, x = dataToPixel(g.a.info, 'x', v), within = g.gid === gid && x >= b[0] - 1 && x <= b[2] + 1;
        g.g.style.display = within ? '' : 'none';
        if (!within) continue;
        const own = from === svg && skip.includes(g.a.k);    // under the pointer: its crosshair is already there
        g.line.style.display = own ? 'none' : '';
        if (!own) { g.line.setAttribute('x1', String(x)); g.line.setAttribute('x2', String(x)); }
        g.series.forEach((s, i) => {
          const h = hit.includes(s) || g.a.off.has(s.i) ? [] : nearest([s], x, 0), near = h.length > 0 && Math.abs(s.p[2 * h[0].j] - x) <= g.gap;
          g.dots[i].style.display = near ? '' : 'none';
          if (near) { g.dots[i].setAttribute('cx', String(s.p[2 * h[0].j])); g.dots[i].setAttribute('cy', String(s.p[2 * h[0].j + 1])); }
        });
      }
    },
    clear: () => { for (const g of ghosts) g.g.style.display = 'none'; },
  };
  for (const h of hub) { h.painters.add(painter); if (h.last.length === 2) painter.paint(h.last[0], h.last[1], [], svg, []); }
  /** Whether this group spans more than one plot box (a twin alone has nothing to sync with). */
  const spread = (h     , gid        , a      )          => h.entries.some((e) => e.gid === gid && (e.svg !== svg || e.info.box[0] !== a.info.box[0] || e.info.box[1] !== a.info.box[1]));
  const unpaint = ()       => { for (const h of hub) { h.last = []; for (const p of h.painters) p.clear(); } };

  const hide = ()       => {
    cross.style.display = 'none'; undim();
    if (tip.on.some((o) => o === me)) unpaint();
    if (tip.on.some((o) => o === me)) { tip.el.hidden = true; tip.on = []; }
  };
  const dismiss = ()       => { at.splice(0); hide(); };

  /** Put the tooltip by its anchor, inside the visible part of this chart: beside a mouse or focus, above a finger. */
  const place = ()       => {
    const t = tip.el;
    if (t.hidden) return;
    const [L, T, R, B] = room(svg), wide = R - L, m = tip.margin;
    t.style.visibility = wide <= 0 || B <= T ? 'hidden' : '';
    if (wide <= 0 || B <= T) return;
    t.classList.toggle('mpl-tip-compact', wide < tip.compact);
    t.style.setProperty('--mpl-tip-room', `${Math.max(120, wide - 2 * m)}px`);
    const r = t.getBoundingClientRect(), [cx, cy] = toScreen(lx, ly), g = touch ? tip.touchGap : tip.gap;
    const x = touch || tip.above ? cx - r.width / 2 : cx + g + r.width > R - m ? cx - g - r.width : cx + g;
    const y = touch || tip.above ? (cy - g - r.height < T + m ? cy + g : cy - g - r.height) : cy + g + r.height > B - m ? cy - g - r.height : cy + g;
    t.style.left = `${Math.round(clamp(L + m, R - m - r.width, x))}px`;
    t.style.top = `${Math.round(clamp(T + m, B - m - r.height, y))}px`;
  };
  const me        = { svg, hide: dismiss, place };

  /** Show the readout at SVG point (x, y): the nearest point of any Axes there, under the crosshair. */
  const show = (x        , y        , pick                )       => {
    const here = axes.filter((a) => inside(a.info.box, x, y));
    if (here.length === 0) { dismiss(); return; }
    for (const o of tip.on) if (o !== me) o.hide();
    tip.on = [me];
    lx = x; ly = y;
    // series ordered along an axis follow the crosshair; a 2D point (a scatter marker) wins only under the pointer
    const best = (f                            )                 => here.flatMap((a) => nearest(a.info.a.filter(f), x, y, a.off)).reduce((m                , h) => (m.length === 0 || h.dist <= m[0].dist ? [h] : m), []);
    const lines = best((s) => s.s !== 'xy'), spots = best((s) => s.s === 'xy'), ctm = svg.getScreenCTM(), scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
    const onSpot = spots.length > 0 && spots[0].dist <= spots[0].art.r + (touch ? 8 : 3) / scale;
    const hit = pick.length > 0 ? pick : onSpot || lines.length === 0 ? spots : lines;
    // the crosshair snaps to the point the tooltip reports, so the two always agree (not to a far-off 2D point)
    const snap = hit.length > 0 && (pick.length > 0 || onSpot || hit === lines);
    const sx = snap && hit[0].art.s !== 'y' ? hit[0].art.p[2 * hit[0].j] : x, sy = snap && hit[0].art.s === 'y' ? hit[0].art.p[2 * hit[0].j + 1] : y;
    const b = here[0].info.box;
    vx.setAttribute('x1', String(sx)); vx.setAttribute('x2', String(sx)); vx.setAttribute('y1', String(b[1])); vx.setAttribute('y2', String(b[3]));
    hy.setAttribute('y1', String(sy)); hy.setAttribute('y2', String(sy)); hy.setAttribute('x1', String(b[0])); hy.setAttribute('x2', String(b[2]));
    cross.style.display = '';
    const rows                = [];
    undim();
    if (hit.length > 0) {
      const { art, j } = hit[0], owner = here.find((a) => a.info.a[art.i] === art) || axes.find((a) => a.info.a[art.i] === art) || here[0];
      dot.setAttribute('cx', String(art.p[2 * j])); dot.setAttribute('cy', String(art.p[2 * j + 1]));
      dot.style.display = '';
      // barh: the value is along x and the position along y; everything else the other way round
      const horiz = art.s === 'y', V = horiz ? owner.info.x : owner.info.y, P = horiz ? owner.info.y : owner.info.x, vw = horiz ? 'x' : 'y', pw = horiz ? 'y' : 'x';
      const val = art.d[2 * j + (horiz ? 0 : 1)], base = art.b.length > 0 ? art.b[j] : 0;
      const pos = P.s === 'date' ? { ...P, step: dateStep(art, horiz ? 1 : 0, P) } : P;
      // the unit from the value axis' label, else from the title ("API latency (ms, log)")
      const custom = format !== formatValue, vu = unitOf(V.t !== '' ? V.t : owner.info.ti), pu = unitOf(P.t);
      const head = html('div'), sw = html('i');
      sw.style.background = art.c;
      head.append(sw);
      // an unlabelled artist is named, muted, by the value axis' label or else the Axes title, without their parentheses
      const fallback = [unitOf(V.t).name, owner.info.ti.replace(/\s*[([].*$/, '')].find((t) => t !== '' && t.length <= 28) || '';
      if (art.l !== '') head.append(html('b', art.l), ' '); else if (fallback !== '') head.append(html('u', fallback), ' ');
      const stacked = art.b.length > 0 && base !== 0;
      const shown1 = format(stacked ? val - base : val, stacked ? { ...V, s: 'linear' } : V, vw, true, svg);
      head.append(html('span', custom ? shown1 : glue(shown1, vu.plain)));
      if (!custom && vu.muted !== '') head.append(' ', html('u', vu.muted));
      rows.push(head);
      const px1 = format(art.d[2 * j + (horiz ? 1 : 0)], pos, pw, true, svg);
      // a coordinate the axis does not show is not printed: with fixed tick labels, only a point on a tick reads as that label
      const fixedAxis = !custom && P.fixed, onTick = fixedAxis ? tickLabelAt(P.tk, art.d[2 * j + (horiz ? 1 : 0)]) : '';
      const under = fixedAxis && onTick === '' ? [] : [fixedAxis ? onTick : custom || P.s === 'date' || P.s === 'cat' ? px1 : glue(px1, pu.plain)];
      if (stacked) under.push(`${custom ? format(val, V, vw, true, svg) : glue(format(val, V, vw, true, svg), vu.plain)} total`);
      if (under.length > 0) rows.push(html('small', under.join(' · ')));
      // only series in the Axes under the pointer (twins included) give way to the hovered one: other panels stay as they are
      for (const a of here) for (const [i, es] of a.groups) {
        const kind = a.info.a[i];
        if ((a !== owner || i !== art.i) && kind && kind.p.length > 0) for (const e of es) { e.classList.add('mpl-dim'); dims.push(e); }
      }
    } else dot.style.display = 'none';
    for (const h of hub) {
      const gid = groupOf(h, svg, here[0].k, here[0].info);
      unpaint();
      if (!spread(h, gid, here[0])) continue;
      h.last = [gid, snap && hit[0].art.s !== 'y' ? hit[0].art.d[2 * hit[0].j] : pixelToData(here[0].info, 'x', x)];
      for (const p of h.painters) p.paint(gid, h.last[1], here.map((a) => a.k), svg, hit.map((v) => v.art));
    }
    if (tip.cursor) rows.push(html('small', [format(pixelToData(here[0].info, 'x', x), here[0].info.x, 'x', false, svg),
      ...here.map((a) => format(pixelToData(a.info, 'y', y), a.info.y, 'y', false, svg))].join(' · ')));
    tip.el.replaceChildren(...rows);
    tip.el.hidden = rows.length === 0;     // nothing near and no cursor readout: the crosshair alone
    place();
  };
  const toSvg = (cx        , cy        )                    => {
    const m = svg.getScreenCTM();
    if (!m) return [];
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const toScreen = (x        , y        )                    => {
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y];
  };

  let frame = 0, fingers = 0, cur                    = [], press                    = [];
  const showAt = ()       => {
    const p = toSvg(cur[0], cur[1]);
    if (p.length !== 2) return;
    at.splice(0, 3, p[0], p[1], touch ? 1 : 0);
    show(p[0], p[1], []);
  };
  const zoomed = ()          => svg.hasAttribute('data-mpl-zoom');
  const move = (e              )       => {
    if (onLegend(e)) return;
    cur = [e.clientX, e.clientY];
    touch = e.pointerType === 'touch';
    // under mpl/zoom a pressed pointer pans or zooms: no readout until it lifts
    if (e.buttons !== 0 && zoomed()) { dismiss(); return; }
    if (frame !== 0) return;
    frame = requestAnimationFrame(() => { frame = 0; showAt(); });
  };
  const down = (e              )       => {
    if (e.pointerType === 'touch') { press = fingers === 0 && !onLegend(e) ? [e.clientX, e.clientY] : []; fingers++; }
    move(e);
  };
  // under mpl/zoom a touch pans, so the readout comes on lift, when the finger did not travel (a tap)
  const lift = (e              )       => {
    if (e.pointerType !== 'touch') return;
    fingers = Math.max(0, fingers - 1);
    if (e.type === 'pointerup' && press.length === 2 && zoomed() && Math.hypot(e.clientX - press[0], e.clientY - press[1]) < 10) {
      cur = [e.clientX, e.clientY];
      touch = true;
      showAt();
    }
    press = [];
  };
  // a finger lifting fires pointerleave too: a tapped value stays (until the next tap, a tap outside, or Escape)
  const leave = (e              )       => { if (e.pointerType !== 'touch') dismiss(); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointerup', lift);
  svg.addEventListener('pointercancel', lift);
  svg.addEventListener('pointerleave', leave);
  // re-rendered under a resting pointer or a tapped value: the readout follows the new view
  if (at.length === 3 && shown) { touch = at[2] === 1; show(at[0], at[1], []); }

  // legend toggles and keyboard stepping through points
  for (const a of axes) {
    for (const [i, x0, y0, x1, y1] of a.info.lg) {
      const art = a.info.a[i], r = el('rect', { class: 'mpl-lg', x: x0, y: y0, width: x1 - x0, height: y1 - y0, tabindex: 0, role: 'button', 'aria-pressed': 'true' });
      r.setAttribute('aria-label', art && art.l !== '' ? art.l : `${art ? art.k : 'artist'} ${i}`);
      const toggle = ()       => {
        const on = a.off.has(i);
        if (on) a.off.delete(i); else a.off.add(i);
        for (const e of a.groups.get(i) || []) e.classList.toggle('mpl-off', !on);
        r.classList.toggle('mpl-lg-off', !on);
        r.setAttribute('aria-pressed', String(on));
        hide();
      };
      r.addEventListener('click', toggle);
      r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      r.addEventListener('pointermove', (e) => e.stopPropagation());
      r.addEventListener('pointerenter', hide);
      hits.append(r);
    }
    const series = a.info.a.filter((s) => s.p.length > 0);
    if (series.length === 0) continue;
    const b = a.info.box, kb = el('rect', { class: 'mpl-kb', x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1], tabindex: 0, role: 'application', 'data-mpl-k': a.k });
    kb.setAttribute('aria-label', `Plot ${a.k + 1}: arrow keys move between points, up and down between series`);
    kb.setAttribute('pointer-events', 'none');
    let si = 0, pj = -1;
    kb.addEventListener('keydown', (e) => {
      const dir = KEYS[e.key];
      if (e.key === 'Escape') { hide(); pj = -1; return; }
      if (typeof dir !== 'number' || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;   // Shift+arrows: mpl/zoom pans
      e.preventDefault();
      const vis = series.filter((s) => !a.off.has(s.i));
      if (vis.length === 0) return;
      if (e.key === 'ArrowDown') si++;
      if (e.key === 'ArrowUp') si--;
      const s = vis[((si % vis.length) + vis.length) % vis.length], n = s.p.length / 2;
      pj = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : Math.min(n - 1, Math.max(0, pj < 0 ? 0 : pj + dir));
      touch = false;
      show(s.p[2 * pj], s.p[2 * pj + 1], [{ art: s, j: pj, dist: 0 }]);
    });
    kb.addEventListener('blur', hide);
    hits.append(kb);
  }
  return () => {
    svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointerup', lift);
    svg.removeEventListener('pointercancel', lift); svg.removeEventListener('pointerleave', leave);
    if (frame !== 0) cancelAnimationFrame(frame);
    hide(); layer.remove();
    for (const h of hub) h.painters.delete(painter);
    for (const a of axes) for (const es of a.groups.values()) for (const e of es) e.classList.remove('mpl-off');
  };
}

/** Options of attach(); every field is optional. */
                             
                                                
                          
                                                                                                                                         
                           
                                                                                    
                       
                                                                   
                            
                                                                                 
                          
                                                                                                        
                                       
                                                                                    
                           
                                                                                                                       
                                                                                                                
                                  
  

/**
 * Make every annotated SVG under `root` interactive (fig.toSVG({ interactive: true }), inlined in the page).
 * Returns a function that undoes it. The second argument is either a value formatter (see formatValue) or AttachOptions.
 */
export function attach(root             = document, options                                  = {})             {
  if (document.querySelectorAll('style.mpl-css').length === 0) {
    const s = document.createElement('style');
    s.className = 'mpl-css';
    s.textContent = CSS;
    document.head.append(s);
  }
  const o                         = typeof options === 'function' ? { format: options } : options;
  const el0 = html('div', '', 'mpl-tip');
  el0.hidden = true;
  el0.setAttribute('role', 'status');
  document.body.append(el0);
  const tip      = {
    el: el0, format: typeof o.format === 'function' ? o.format : formatValue, compact: num(o.compact, 480), gap: num(o.gap, 14), touchGap: num(o.touchGap, 32),
    margin: num(o.margin, 4), above: o.placement === 'above', cursor: o.cursor === true, sync: typeof o.sync === 'string' || o.sync === false ? o.sync : true, on: [],
  };
  const svgs = Array.from(root.querySelectorAll('svg')).filter((s) => s.querySelectorAll('g[data-mpl-axes]').length > 0);
  if (root instanceof SVGSVGElement) svgs.push(root);
  const undo = svgs.map((s) => wire(s, tip));
  // a tap outside the chart holding the readout, or Escape, dismisses it; it stays by its point through a scroll or resize
  const outside = (e              )       => { if (e.pointerType === 'touch') for (const h of tip.on) if (!(e.target instanceof Node && h.svg.contains(e.target))) h.hide(); };
  const esc = (e               )       => { if (e.key === 'Escape') for (const h of tip.on) h.hide(); };
  const replace = ()       => { for (const h of tip.on) h.place(); };
  document.addEventListener('pointerdown', outside, { capture: true, passive: true });
  document.addEventListener('keydown', esc);
  addEventListener('scroll', replace, { capture: true, passive: true });
  addEventListener('resize', replace);
  return () => {
    for (const u of undo) u();
    el0.remove();
    document.removeEventListener('pointerdown', outside, { capture: true });
    document.removeEventListener('keydown', esc);
    removeEventListener('scroll', replace, { capture: true });
    removeEventListener('resize', replace);
  };
}
