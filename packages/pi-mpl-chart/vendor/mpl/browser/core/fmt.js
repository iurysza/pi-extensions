// Parsers for plot format strings, line styles and marker names.
// Port of matplotlib.axes._base._process_plot_format.
import { MARKERS, MARKER_NAMES } from './data/markers.js';
import { parsePaint } from './colors.js';
                                                                                       
import { err, none, ok, some } from './types.js';
import { isNullish } from './std.js';

/** What a fmt string says about shape. 'default' = neither given (rc decides); naming one implies the other is off. */
                      
                                
                                                           
                                                            
                                                                                         
                                                                               

const FMT_LINES                                                  = [['--', 'dashed'], ['-.', 'dashdot'], ['-', 'solid'], [':', 'dotted']];
const BASE_COLORS = 'bgrcmykw';
const ANY_CYCLE = [{ hex: '#000000', alpha: 1 }];

function markerFromChar(c        )                     {
  for (const m of MARKER_NAMES) if (m === c) return some(m);
  return none;
}

export function parseFmt(fmt        )              {
  if (fmt === '') return ok({ color: none, shape: { kind: 'default' } });
  // matplotlib first tries the whole string as a color ('red', '#ff0000', 'C1', '0.5').
  if (parsePaint(fmt, ANY_CYCLE).ok) return ok({ color: some(fmt), shape: { kind: 'default' } });
  let color                 = none, line                        = none, marker                     = none;
  let i = 0;
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const ls = FMT_LINES.find(([tok]) => rest.startsWith(tok));
    if (ls) {
      if (line.kind === 'some') return err(`Illegal format string "${fmt}"; two linestyle symbols`);
      line = some(ls[1]); i += ls[0].length; continue;
    }
    const c = fmt[i];
    const mk = markerFromChar(c);
    if (mk.kind === 'some') {
      if (marker.kind === 'some') return err(`Illegal format string "${fmt}"; two marker symbols`);
      marker = mk; i += 1; continue;
    }
    if (BASE_COLORS.includes(c) || (c === 'C' && /\d/.test(fmt.slice(i + 1, i + 2)))) {
      if (color.kind === 'some') return err(`Illegal format string "${fmt}"; two color symbols`);
      let j = i + 1;
      if (c === 'C') while (j < fmt.length && /\d/.test(fmt[j])) j++;
      color = some(fmt.slice(i, j)); i = j; continue;
    }
    return err(`Unrecognized character ${c} in format string "${fmt}"`);
  }
  if (line.kind === 'some' && marker.kind === 'some') return ok({ color, shape: { kind: 'both', line: line.value, marker: marker.value } });
  if (line.kind === 'some') return ok({ color, shape: { kind: 'line', line: line.value } });
  if (marker.kind === 'some') return ok({ color, shape: { kind: 'marker', marker: marker.value } });
  return ok({ color, shape: { kind: 'default' } });
}

/** '-', 'solid', '--', 'dashed', ... ; 'None' / 'none' / '' / ' ' parse to none. */
/** Python's float modulo (the result takes the divisor's sign), as _get_dash_pattern's `offset %= dsum`. */
function pyMod(x        , d        )         {
  const m = x % d;
  return m !== 0 ? ((d < 0) !== (m < 0) ? m + d : m) : 0;
}

/**
 * A linestyle: a name ('-', '--', '-.', ':' or their long forms; 'None', 'none', '' and ' ' draw nothing) or an
 * [offset, [on, off, ...]] dash tuple in pt, as lines._get_dash_pattern and GraphicsContextBase.set_dashes accept
 * it: the offset wraps into one cycle, a null or empty sequence is solid, values are non-negative and one positive.
 */
export function parseLinestyle(v         )                            {
  if (Array.isArray(v)) { const t = parseDashTuple(v); return t.ok ? ok(some(t.value)) : t; }
  if (typeof v !== 'string') return err(`linestyle must be a string or an [offset, [on, off, ...]] dash tuple, got ${typeof v}`);
  switch (v) {
    case '-': case 'solid': return ok(some('solid'));
    case '--': case 'dashed': return ok(some('dashed'));
    case '-.': case 'dashdot': return ok(some('dashdot'));
    case ':': case 'dotted': return ok(some('dotted'));
    case 'None': case 'none': case '': case ' ': return ok(none);
    default: return err(`unknown linestyle ${JSON.stringify(v)}`);
  }
}

function parseDashTuple(v                    )                    {
  const shown = JSON.stringify(v);
  if (v.length !== 2) return err(`unrecognized linestyle ${shown}: a dash tuple is [offset, [on, off, ...]]`);
  const [offset, seq] = v;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return err(`unrecognized linestyle ${shown}: the offset must be a finite number`);
  if (isNullish(seq)) return ok({ kind: 'dashes', offset, onoff: none });
  if (!Array.isArray(seq)) return err(`unrecognized linestyle ${shown}: the on-off sequence must be an array of numbers`);
  const onoff           = [];
  for (const d of seq) {
    if (typeof d !== 'number' || !Number.isFinite(d)) return err(`unrecognized linestyle ${shown}: the on-off sequence must be finite numbers`);
    onoff.push(d);
  }
  if (onoff.length === 0) return ok({ kind: 'dashes', offset, onoff: none });
  if (onoff.some((d) => d < 0)) return err(`linestyle ${shown}: all values in the dash list must be non-negative`);
  if (!onoff.some((d) => d > 0)) return err(`linestyle ${shown}: at least one value in the dash list must be positive`);
  const dsum = onoff.reduce((a, b) => a + b, 0);
  return ok({ kind: 'dashes', offset: pyMod(offset, dsum), onoff: some(onoff) });
}

/** Marker codes matplotlib accepts as integers (CARETLEFTBASE..CARETDOWNBASE). */
const MARKER_CODES                                               = [[8, 'caretleftbase'], [9, 'caretrightbase'], [10, 'caretupbase'], [11, 'caretdownbase']];

export function parseMarker(v         )                             {
  const code = MARKER_CODES.find(([n]) => n === v);
  if (code) return ok(some(code[1]));
  if (typeof v !== 'string') return err(`marker must be a string, got ${typeof v}`);
  if (v === 'None' || v === 'none' || v === '' || v === ' ') return ok(none);
  const m = markerFromChar(v);
  return m.kind === 'some' && Object.hasOwn(MARKERS, v) ? ok(m) : err(`unknown marker ${JSON.stringify(v)}`);
}
