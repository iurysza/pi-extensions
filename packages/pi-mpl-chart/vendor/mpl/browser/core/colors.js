// Color parsing after matplotlib.colors.to_rgba. Strings are parsed once at
// the boundary (theme, kwargs); the core only ever sees Rgb / Paint.
import { NAMED } from './data/colors.js';
import { lookup } from './std.js';
                                                     
import { err, ok } from './types.js';

const hex2 = (v        )         => Math.round(v * 255).toString(16).padStart(2, '0');
const solid = (hex        , alpha        )        => ({ kind: 'solid', color: { hex, alpha } });

/**
 * '#rgb' '#rgba' '#rrggbb' '#rrggbbaa', named, 'tab:blue', 'CN' (via cycle),
 * grayscale '0.8', [r, g, b(, a)] in 0..1, or 'none'.
 */
export function parsePaint(spec         , cycle                )                {
  if (Array.isArray(spec)) {
    const v                     = spec;
    if ((v.length === 3 || v.length === 4) && v.every((c) => typeof c === 'number' && c >= 0 && c <= 1)) {
      const n = v.map(Number);
      return ok(solid(`#${hex2(n[0])}${hex2(n[1])}${hex2(n[2])}`, n.length === 4 ? n[3] : 1));
    }
    return err(`invalid RGB(A) sequence ${JSON.stringify(spec)}`);
  }
  if (typeof spec !== 'string') return err(`color must be a string or RGB(A) sequence, got ${typeof spec}`);
  const t = spec.trim();
  const lower = t.toLowerCase();
  if (lower === 'none') return ok({ kind: 'none' });
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(t);
  if (m) return ok(solid(`#${m[1].toLowerCase()}`, m[2] ? parseInt(m[2], 16) / 255 : 1));
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/i.exec(t);
  if (m) return ok(solid(`#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase(), m[4] ? parseInt(m[4] + m[4], 16) / 255 : 1));
  m = /^C(\d+)$/.exec(t);
  if (m) {
    if (cycle.length === 0) return err(`'${t}' needs a color cycle`);
    const c = cycle[Number(m[1]) % cycle.length];
    return ok({ kind: 'solid', color: c });
  }
  if (/^(?:0|1|0?\.\d+|1\.0*|0\.\d*)$/.test(t)) return ok(solid(`#${hex2(Number(t)).repeat(3)}`, 1));
  const named = lookup(NAMED, lower);
  if (named.kind === 'some') return ok(solid(named.value, 1));
  return err(`unknown color ${JSON.stringify(spec)}`);
}

/** A color that must be visible-capable (not 'none'). */
export function parseRgb(spec         , cycle                )              {
  const p = parsePaint(spec, cycle);
  if (!p.ok) return p;
  return p.value.kind === 'solid' ? ok(p.value.color) : err(`'none' is not allowed here`);
}

/** rc files also accept bare hex ('E5E5E5'); normalize before parsing. */
export const rcColorString = (s        )         => (/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(s.trim()) ? `#${s.trim()}` : s);
