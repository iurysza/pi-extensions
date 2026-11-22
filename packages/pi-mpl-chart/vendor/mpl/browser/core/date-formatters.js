// matplotlib.dates locators and formatters as typed handles: AutoDateLocator (interval_multiples=True, the default),
// the RRuleLocators MonthLocator / DayLocator / HourLocator / MinuteLocator / SecondLocator, YearLocator, DateFormatter
// and ConciseDateFormatter. UTC only.
import { isNullish, isPlainObject, lookup, prop } from './std.js';
import { assertNever, none, some,                                                                           } from './types.js';

/** Positional arguments, then an optional trailing kwargs object, by matplotlib's parameter names (tz must be UTC).
 *  A nullish value counts as not given (matplotlib's None). */
function readArgs(cls        , names                   , args                    )                               {
  const hasKw = args.length > 0 && isPlainObject(args[args.length - 1]);
  const pos = hasKw ? args.slice(0, -1) : args;
  if (pos.length > names.length) throw new TypeError(`${cls}() takes at most ${names.length} positional arguments (${names.join(', ')})`);
  const out = new Map                 ();
  pos.forEach((v, i) => { if (!isNullish(v)) out.set(names[i], v); });
  const kw         = hasKw ? Object(args[args.length - 1]) : {};
  for (const [k, v] of Object.entries(kw)) {
    if (k === 'tz') { if (!isNullish(v) && v !== 'UTC') throw new TypeError(`${cls}: only tz='UTC' is supported, got ${JSON.stringify(v)}`); continue; }
    if (!names.includes(k)) throw new TypeError(`${cls}() got an unexpected keyword argument '${k}'`);
    if (out.has(k)) throw new TypeError(`${cls}() got multiple values for argument '${k}'`);
    if (!isNullish(v)) out.set(k, v);
  }
  return out;
}
const isInt = (v         )              => typeof v === 'number' && Number.isInteger(v);
const fullRange = (lo        , hi        )                    => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
/** An int or a list of ints in [lo, hi]; not given → `dflt` (matplotlib's `None` is the full range). */
function intList(cls        , name        , a                              , lo        , hi        , dflt                    = fullRange(lo, hi))                    {
  const o = lookup(a, name);
  if (o.kind === 'none') return dflt;
  const xs                     = Array.isArray(o.value) ? o.value : [o.value];
  if (xs.length === 0 || !xs.every((x) => isInt(x) && x >= lo && x <= hi)) {
    throw new RangeError(`${cls}: ${name} must be an int or a list of ints in ${lo}..${hi}${lo === 1 && hi === 31 ? ' (negative month days are not supported)' : ''}, got ${JSON.stringify(o.value)}`);
  }
  return xs.filter(isInt);
}
function intArg(cls        , name        , a                              , dflt        , lo        , hi        )         {
  const o = lookup(a, name);
  if (o.kind === 'none') return dflt;
  if (!isInt(o.value) || o.value < lo || o.value > hi) {
    throw new RangeError(`${cls}: ${name} must be an integer ${hi === Infinity ? `greater than ${lo - 1}` : `in ${lo}..${hi}`}, got ${JSON.stringify(o.value)}`);
  }
  return o.value;
}
const interval = (cls        , a                              )         => intArg(cls, 'interval', a, 1, 1, Infinity);
                                                    
const MONTHS = fullRange(1, 12), MONTHDAYS = fullRange(1, 31), HOURS = fullRange(0, 23), SIXTY = fullRange(0, 59);
/** matplotlib's RRuleLocator subclasses fix every unit below the frequency at 0 (hms0d and friends). */
const AT0          = { bymonth: MONTHS, bymonthday: MONTHDAYS, byhour: [0], byminute: [0], bysecond: [0] };
const rule = (freq                   , iv        , by         )            => ({ freq, interval: iv, ...by });

/** AutoDateLocator() — the default date locator (interval_multiples=True). minticks/maxticks/interval_multiples are not supported. */
export class AutoDateLocator {
           kind = 'auto'         ;
           spec                  = { kind: 'auto' };
  constructor(...args                    ) { readArgs('AutoDateLocator', [], args); }
}
/** MonthLocator(bymonth = every month, bymonthday = 1, interval = 1): rrule MONTHLY at 00:00. */
export class MonthLocator {
           kind = 'rrule'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('MonthLocator', ['bymonth', 'bymonthday', 'interval'], args);
    this.spec = { kind: 'rrule', rule: rule('monthly', interval('MonthLocator', a), { ...AT0,
      bymonth: intList('MonthLocator', 'bymonth', a, 1, 12), bymonthday: intList('MonthLocator', 'bymonthday', a, 1, 31, [1]) }) };
  }
}
/** DayLocator(bymonthday = every day, interval = 1): rrule DAILY at 00:00. */
export class DayLocator {
           kind = 'rrule'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('DayLocator', ['bymonthday', 'interval'], args);
    this.spec = { kind: 'rrule', rule: rule('daily', interval('DayLocator', a), { ...AT0, bymonthday: intList('DayLocator', 'bymonthday', a, 1, 31) }) };
  }
}
/** HourLocator(byhour = every hour, interval = 1): rrule HOURLY at :00:00. */
export class HourLocator {
           kind = 'rrule'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('HourLocator', ['byhour', 'interval'], args);
    this.spec = { kind: 'rrule', rule: rule('hourly', interval('HourLocator', a), { ...AT0, byhour: intList('HourLocator', 'byhour', a, 0, 23) }) };
  }
}
/** MinuteLocator(byminute = every minute, interval = 1): rrule MINUTELY at :00. */
export class MinuteLocator {
           kind = 'rrule'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('MinuteLocator', ['byminute', 'interval'], args);
    this.spec = { kind: 'rrule', rule: rule('minutely', interval('MinuteLocator', a), { ...AT0, byhour: HOURS, byminute: intList('MinuteLocator', 'byminute', a, 0, 59) }) };
  }
}
/** SecondLocator(bysecond = every second, interval = 1): rrule SECONDLY. */
export class SecondLocator {
           kind = 'rrule'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('SecondLocator', ['bysecond', 'interval'], args);
    this.spec = { kind: 'rrule', rule: rule('secondly', interval('SecondLocator', a), { ...AT0,
      byhour: HOURS, byminute: SIXTY, bysecond: intList('SecondLocator', 'bysecond', a, 0, 59) }) };
  }
}
/** YearLocator(base = 1, month = 1, day = 1): every base-th year (multiples of base) on that month and day. */
export class YearLocator {
           kind = 'year'         ;
           spec                 ;
  constructor(...args                    ) {
    const a = readArgs('YearLocator', ['base', 'month', 'day'], args);
    const base = intArg('YearLocator', 'base', a, 1, 1, Infinity), month = intArg('YearLocator', 'month', a, 1, 1, 12), day = intArg('YearLocator', 'day', a, 1, 1, 31);
    if (day > [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]) throw new RangeError(`YearLocator: month ${month} has no day ${day} (dateutil: "Invalid rrule byxxx generates an empty set")`);
    this.spec = { kind: 'year', base, month, day };
  }
}
/** Any date locator: set_major_locator takes one, and ConciseDateFormatter(locator) accepts one. */
                                                                                                                                        
export const isDateLocator = (v         )                         =>
  v instanceof AutoDateLocator || v instanceof MonthLocator || v instanceof DayLocator || v instanceof HourLocator
  || v instanceof MinuteLocator || v instanceof SecondLocator || v instanceof YearLocator;

/** DateFormatter(fmt) — fixed strftime. */
export class DateFormatter {
           kind = 'strftime'         ;
           fmt        ;
  constructor(fmt        ) {
    if (typeof fmt !== 'string' || fmt.length === 0) throw new TypeError('DateFormatter fmt must be a non-empty string');
    this.fmt = fmt;
  }
}

/** Six format strings — ConciseDateFormatter level 0..5 (years … seconds), as matplotlib. */
                                                                                       

/**
 * ConciseDateFormatter kwargs, matplotlib-shaped: every field optional; omitted → matplotlib default.
 * Format lists are 6-tuples at the type level; a wrong length still throws RangeError for JS callers.
 * Written as Partial<{…}> (not `x?:`) so check_strict stays happy; absence is lifted via prop().
 */
                                                
                                   
                                        
                                          
                                
   

/** ConciseDateFormatter(locator, { formats, zero_formats, offset_formats, show_offset }). */
export class ConciseDateFormatter {
           kind = 'concise'         ;
           formats                           ;
           zeroFormats                           ;
           offsetFormats                           ;
           showOffset         ;
  constructor(locator                   , opts                           = {}) {
    if (!isDateLocator(locator)) {
      throw new TypeError('ConciseDateFormatter requires a date locator (AutoDateLocator, YearLocator, MonthLocator, DayLocator, HourLocator, MinuteLocator or SecondLocator)');
    }
    if (!isPlainObject(opts)) {
      throw new TypeError('ConciseDateFormatter options must be a plain object');
    }
    this.formats = readFormatList('formats', prop(opts, 'formats'));
    this.zeroFormats = readFormatList('zero_formats', prop(opts, 'zero_formats'));
    this.offsetFormats = readFormatList('offset_formats', prop(opts, 'offset_formats'));
    const show = prop(opts, 'show_offset');
    switch (show.kind) {
      case 'none': this.showOffset = true; break;
      case 'some': {
        if (typeof show.value !== 'boolean') throw new TypeError('show_offset must be a bool');
        this.showOffset = show.value;
        break;
      }
      default: assertNever(show);
    }
  }
}

function readFormatList(name        , o                 )                            {
  switch (o.kind) {
    case 'none': return none;
    case 'some': {
      const v = o.value;
      if (!Array.isArray(v) || v.length !== 6) {
        throw new RangeError(`${name} argument must be a list of 6 format strings (or None)`);
      }
      const out           = [];
      for (let i = 0; i < 6; i++) {
        const x = v[i];
        if (typeof x !== 'string') {
          throw new RangeError(`${name} argument must be a list of 6 format strings (or None)`);
        }
        out.push(x);
      }
      return some(out);
    }
    default: return assertNever(o);
  }
}

                                                                                              

export function formatterSpecOf(f                )                    {
  switch (f.kind) {
    case 'auto': return { kind: 'auto' };
    case 'strftime': return { kind: 'strftime', fmt: f.fmt };
    case 'concise':
      return {
        kind: 'concise',
        formats: f.formats,
        zeroFormats: f.zeroFormats,
        offsetFormats: f.offsetFormats,
        showOffset: f.showOffset,
      };
    default: return assertNever(f);
  }
}
