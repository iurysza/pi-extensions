// Scene construction helpers and Agg's pixel snapping.
                                                                              
import { none, some } from './types.js';

/** Agg PathSnapper: pixel centres for odd rounded stroke widths, pixel edges for even (top-left raster coords).
 *  After the y-up→y-down flip, vertices land on floor(v + 0.5) + off (off = 0.5 for odd stroke px). */
export const snapOffset = (strokePx        )         => (Math.round(strokePx) % 2 === 1 ? 0.5 : 0.0);
export const snap = (v        , strokePx        )         => Math.floor(v + 0.5) + snapOffset(strokePx);
/** snap() on Agg; the value itself where nothing snaps (matplotlib's SVG backend; Frame.snap false). */
export const snapIf = (on         , v        , strokePx        )         => (on ? Math.floor(v + 0.5) + snapOffset(strokePx) : v);

/** What a shape draws; none when it would draw nothing (fully transparent counts as nothing). */
export function inkOf(fill       , stroke                )              {
  const f = fill.kind === 'solid' && fill.color.alpha > 0 ? some(fill.color) : none;
  const s = stroke.kind === 'some' && stroke.value.color.alpha > 0 && stroke.value.width > 0 ? stroke : none;
  if (f.kind === 'some' && s.kind === 'some') return some({ kind: 'fillStroke', fill: f.value, stroke: s.value });
  if (f.kind === 'some') return some({ kind: 'fill', fill: f.value });
  if (s.kind === 'some') return some({ kind: 'stroke', stroke: s.value });
  return none;
}

export const rectNode = (x        , y        , w        , h        , ink     )       => ({ kind: 'rect', x, y, w, h, ink });
export const pathNode = (segs                , ink     , antialiased = true)       =>
  ({ kind: 'path', segs, ink, antialiased });
export const group = (nodes                 , clip      )       => ({ kind: 'group', clip, nodes, tag: '' });
export const NO_CLIP       = { kind: 'none' };
