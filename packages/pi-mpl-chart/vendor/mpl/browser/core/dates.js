// Port of matplotlib.dates (3.11.2): date numbers (days since 1970-01-01 UTC),
// num2date / date2num, dateutil.relativedelta, AutoDateLocator (interval_multiples=True)
// and AutoDateFormatter with the default rc formats. UTC only.
import { pyDivmod } from './ticker.js';
import { assertNever, none, some,                                                   } from './types.js';

const US_PER_DAY = 86_400_000_000;
const DAYS_PER_YEAR = 365, DAYS_PER_MONTH = 30;

/** A calendar instant: whole days since the epoch plus microseconds into the day [0, 86.4e9). */
                                                               
                                                                                                                                                                   

// Howard Hinnant's civil-from-days / days-from-civil (proleptic Gregorian).
function civilFromDays(z0        )                                    {
  const z = z0 + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
export function daysFromCivil(y0        , m        , d        )         {
  const y = y0 - (m <= 2 ? 1 : 0), era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
const monthDays = (y        , m        )         => daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);

function civil(t    )        {
  const [y, m, d] = civilFromDays(t.day);
  const s = Math.floor(t.us / 1e6);
  return { y, m, d, hh: Math.floor(s / 3600), mm: Math.floor(s / 60) % 60, ss: s % 60, micro: t.us - s * 1e6 };
}
const fromCivil = (c       )     => ({ day: daysFromCivil(c.y, c.m, c.d), us: ((c.hh * 60 + c.mm) * 60 + c.ss) * 1e6 + c.micro });
const cmp = (a    , b    )         => (a.day !== b.day ? a.day - b.day : a.us - b.us);

/** A JS Date (ms since the epoch) as a DT. */
export function fromEpochMs(ms        )     {
  const day = Math.floor(ms / 86_400_000);
  return { day, us: (ms - day * 86_400_000) * 1000 };
}

/** date2num via _dt64_to_ordinalf: (whole seconds + extra_ns / 1e9) / 86400. */
export function date2num(t    )         {
  const sec = Math.floor(t.us / 1e6);
  const extraNs = (t.us - sec * 1e6) * 1000;
  return (t.day * 86400 + sec + extraNs / 1e9) / 86400;
}

const rint = (v        )         => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

/** num2date via _from_ordinalf: round to whole µs; beyond 70 years from the epoch, round to 20 µs. */
export function num2date(x        )     {
  const total = BigInt(rint(x * US_PER_DAY));
  const perDay = BigInt(US_PER_DAY);
  let day = total / perDay, rem = total % perDay;
  if (rem < 0n) { rem += perDay; day -= 1n; }
  let t     = { day: Number(day), us: Number(rem) };
  if (Math.abs(x) > 70 * 365) {
    const c = civil(t);
    const ms = rint(c.micro / 20) * 20;
    t = ms === 1e6 ? addSeconds({ ...t, us: t.us - c.micro }, 1) : { ...t, us: t.us - c.micro + ms };
  }
  return t;
}
function addSeconds(t    , s        )     {
  const us = t.us + s * 1e6;
  const dd = Math.floor(us / US_PER_DAY);
  return { day: t.day + dd, us: us - dd * US_PER_DAY };
}

// ---------------------------------------------------------------- dateutil.relativedelta(dt1, dt2), dt1 >= dt2
                                                                                                                      

function addMonths(c       , years        , months        )        {
  let y = c.y + years, m = c.m + months;
  if (m > 12) { y += 1; m -= 12; } else if (m < 1) { y -= 1; m += 12; }
  return { ...c, y, m, d: Math.min(monthDays(y, m), c.d) };
}
const splitMonths = (months        )                            => {
  if (Math.abs(months) <= 11) return [0, months];
  const s = Math.sign(months), [div, mod] = pyDivmod(months * s, 12);
  return [div * s, mod * s];
};
function relativedelta(dt1    , dt2    )           {
  const c1 = civil(dt1), c2 = civil(dt2);
  let months = (c1.y - c2.y) * 12 + (c1.m - c2.m);
  let [years, mo] = splitMonths(months);
  let dtm = fromCivil(addMonths(c2, years, mo));
  while (cmp(dt1, dtm) < 0) {                      // overshot: step back one month
    months -= 1;
    [years, mo] = splitMonths(months);
    dtm = fromCivil(addMonths(c2, years, mo));
  }
  // timedelta dt1 - dtm -> seconds + microseconds, then _fix into minutes and hours
  const totalUs = (dt1.day - dtm.day) * US_PER_DAY + (dt1.us - dtm.us);
  const seconds = Math.floor(totalUs / 1e6);
  let minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  minutes %= 60; hours %= 24;
  return { years, months: mo, hours, minutes };
}

// ---------------------------------------------------------------- AutoDateLocator
/**
 * What AutoDateLocator.get_locator picks. Under interval_multiples every rrule frequency runs
 * at interval 1, fixes all finer units to zero, and filters exactly one field.
 */
                         
                                                      
                                                                    
                                                                     
                                                                  
                                                                      
                                                                      
                                                                                           

const MINTICKS = 5;
const MAXTICKS = [11, 12, 11, 12, 11, 11, 8];
const INTERVALS                                 = [
  [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000, 2000, 4000, 5000, 10000],
  [1, 2, 3, 4, 6],
  [1, 2, 4, 7, 14],                                 // DAILY under interval_multiples
  [1, 2, 3, 4, 6, 12],
  [1, 5, 10, 15, 30],
  [1, 5, 10, 15, 30],
  [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000],
];
const range = (a        , b        , step        )           => { const out           = []; for (let v = a; v < b; v += step) out.push(v); return out; };

export function chooseDateLocator(dmin    , dmax    )              {
  const delta = relativedelta(dmax, dmin);
  const totalUs = (dmax.day - dmin.day) * US_PER_DAY + (dmax.us - dmin.us);
  const numYears = delta.years;
  const numMonths = numYears * 12 + delta.months;
  const numDays = Math.floor(totalUs / US_PER_DAY);                 // timedelta.days
  const numHours = numDays * 24 + delta.hours;
  const numMinutes = numHours * 60 + delta.minutes;
  const numSeconds = Math.floor(totalUs / 1e6);
  const numMicro = Math.floor(totalUs);
  const nums = [numYears, numMonths, numDays, numHours, numMinutes, numSeconds, numMicro];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] < MINTICKS) continue;
    let interval = INTERVALS[i][INTERVALS[i].length - 1];
    for (const iv of INTERVALS[i]) if (nums[i] <= iv * (MAXTICKS[i] - 1)) { interval = iv; break; }
    switch (i) {
      case 0: return { kind: 'yearly', base: interval };
      case 1: return { kind: 'monthly', months: range(1, 13, interval) };
      // matplotlib tests `i in (DAILY, WEEKLY)` against dateutil constants (3, 2): index 2 is daily
      case 2: return { kind: 'daily', monthdays: interval === 14 ? [1, 15] : interval === 7 ? [1, 8, 15, 22] : range(1, 32, interval) };
      case 3: return { kind: 'hourly', hours: range(0, 24, interval) };
      case 4: return { kind: 'minutely', minutes: range(0, 60, interval) };
      case 5: return { kind: 'secondly', seconds: range(0, 60, interval) };
      case 6: return { kind: 'microsecond', interval, unitDays: 1 / US_PER_DAY };
      default: throw new Error(`unreachable frequency index ${i}`);
    }
  }
  // no frequency had enough ticks: MicrosecondLocator(1); self._freq keeps its initial YEARLY
  return { kind: 'microsecond', interval: 1, unitDays: DAYS_PER_YEAR };
}

/** RRuleLocator / YearLocator unit (get_unit_generic), which picks the AutoDateFormatter format. */
export function locatorUnitDays(l             )         {
  switch (l.kind) {
    case 'yearly': return DAYS_PER_YEAR;
    case 'monthly': return DAYS_PER_MONTH;
    case 'daily': return 1;
    case 'hourly': return 1 / 24;
    case 'minutely': return 1 / 1440;
    case 'secondly': return 1 / 86400;
    case 'microsecond': return l.unitDays;
    default: return assertNever(l);
  }
}

/** Every instant in [lo, hi] whose fields match: unit-by-unit enumeration (rrule with interval 1). */
function filtered(lo    , hi    , l                                                                    )       {
  const out       = [];
  const keep = (t    )       => { if (cmp(t, lo) >= 0 && cmp(t, hi) <= 0) out.push(t); };
  const a = civil(lo), b = civil(hi);
  switch (l.kind) {
    case 'monthly':
      for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? (y++, m = 1) : m++) {
        if (l.months.includes(m)) keep({ day: daysFromCivil(y, m, 1), us: 0 });
      }
      return out;
    case 'daily':
      for (let day = lo.day; day <= hi.day; day++) if (l.monthdays.includes(civilFromDays(day)[2])) keep({ day, us: 0 });
      return out;
    case 'hourly': case 'minutely': case 'secondly': {
      const stepUs = l.kind === 'hourly' ? 3.6e9 : l.kind === 'minutely' ? 6e7 : 1e6;
      const field = (t    )         => { const c = civil(t); return l.kind === 'hourly' ? c.hh : l.kind === 'minutely' ? c.mm : c.ss; };
      const allowed = l.kind === 'hourly' ? l.hours : l.kind === 'minutely' ? l.minutes : l.seconds;
      for (let t     = { day: lo.day, us: Math.floor(lo.us / stepUs) * stepUs }; cmp(t, hi) <= 0; t = addUs(t, stepUs)) {
        if (allowed.includes(field(t))) keep(t);
      }
      return out;
    }
    default: return assertNever(l);
  }
}
function addUs(t    , us        )     {
  const v = t.us + us;
  return v >= US_PER_DAY ? { day: t.day + 1, us: v - US_PER_DAY } : { day: t.day, us: v };
}

/** AutoDateLocator.__call__ on the view interval (date numbers). */
export function autoDateTicks(view                           )                                                                      {
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  const dmin = num2date(vmin), dmax = num2date(vmax);
  const l = chooseDateLocator(dmin, dmax);
  switch (l.kind) {
    case 'yearly': {
      // YearLocator._create_rrule: Jan 1 of base-multiples; `start` keeps vmin's microsecond, the rule drops it
      const a = civil(dmin), b = civil(dmax);
      const ymin = Math.max(Math.floor(a.y / l.base) * l.base, 1);
      const ymax = Math.min(Math.ceil(b.y / l.base) * l.base, 9999);
      const start     = { day: daysFromCivil(ymin, 1, 1), us: a.micro };
      const stop     = { day: daysFromCivil(ymax, 1, 1), us: a.micro };
      const out           = [];
      for (let y = ymin; y <= ymax; y += l.base) {
        const t     = { day: daysFromCivil(y, 1, 1), us: 0 };
        if (cmp(t, start) >= 0 && cmp(t, stop) <= 0) out.push(date2num(t));
      }
      return { locs: out.length > 0 ? out : [vmin, vmax], locator: l };
    }
    case 'monthly': case 'daily': case 'hourly': case 'minutely': case 'secondly': {
      const ts = filtered(dmin, dmax, l);
      return { locs: ts.length > 0 ? ts.map(date2num) : [date2num(dmin), date2num(dmax)], locator: l };
    }
    case 'microsecond': {
      // MicrosecondLocator: MultipleLocator(interval) on µs since the start of vmin's day
      const nmin = date2num(dmin), t0 = Math.floor(nmin);
      const lo = (nmin - t0) * US_PER_DAY, hi = (date2num(dmax) - t0) * US_PER_DAY, step = l.interval;
      const [d, m] = pyDivmod(lo, step);
      const first = (Math.abs(m / step) < 1e-10 ? d : d + 1) * step;
      const n = Math.floor((hi - first + 0.001 * step) / step);
      return { locs: Array.from({ length: n + 3 }, (_, i) => (first - step + i * step) / US_PER_DAY + t0), locator: l };
    }
    default: return assertNever(l);
  }
}

// ---------------------------------------------------------------- RRuleLocator and YearLocator
/** A full dateutil relativedelta(dt1, dt2) for dt1 >= dt2: years, months, then the remainder _fix-ed into units. */
                                                                                                                                                                                                
function fullRelativedelta(dt1    , dt2    )            {
  const c1 = civil(dt1), c2 = civil(dt2);
  let months = (c1.y - c2.y) * 12 + (c1.m - c2.m);
  let [years, mo] = splitMonths(months);
  let dtm = fromCivil(addMonths(c2, years, mo));
  while (cmp(dt1, dtm) < 0) { months -= 1; [years, mo] = splitMonths(months); dtm = fromCivil(addMonths(c2, years, mo)); }
  const totalUs = (dt1.day - dtm.day) * US_PER_DAY + (dt1.us - dtm.us);
  const micro = totalUs % 1e6;
  let seconds = (totalUs - micro) / 1e6;
  let minutes = Math.floor(seconds / 60); seconds -= minutes * 60;
  let hours = Math.floor(minutes / 60); minutes -= hours * 60;
  const days = Math.floor(hours / 24); hours -= days * 24;
  return { years, months: mo, days, hours, minutes, seconds, micro };
}
const YEAR1     = { day: daysFromCivil(1, 1, 1), us: 0 };
const YEAR9999_END     = { day: daysFromCivil(9999, 12, 31), us: (86400 - 1) * 1e6 };
/** dt ± relativedelta (relativedelta.__add__: years and months with the day clamped, then a timedelta); none outside years 1..9999. */
function shiftByDelta(t    , d           , sign        )             {
  const c = civil(t);
  let y = c.y + sign * d.years, m = c.m + sign * d.months;
  if (m > 12) { y += 1; m -= 12; } else if (m < 1) { y -= 1; m += 12; }
  if (y < 1 || y > 9999) return none;
  const base = fromCivil({ ...c, y, m, d: Math.min(monthDays(y, m), c.d) });
  const us = base.us + sign * ((((d.days * 24 + d.hours) * 60 + d.minutes) * 60 + d.seconds) * 1e6 + d.micro);
  const dd = Math.floor(us / US_PER_DAY);
  const out     = { day: base.day + dd, us: us - dd * US_PER_DAY };
  return cmp(out, YEAR1) < 0 || cmp(out, YEAR9999_END) > 0 ? none : some(out);
}

const UNIT_US = { daily: US_PER_DAY, hourly: 3.6e9, minutely: 6e7, secondly: 1e6 }         ;
const sorted = (a                   )           => [...new Set(a)].toSorted((p, q) => p - q);

/**
 * dateutil rrule(freq, interval, dtstart, until, by…) occurrences within [lo, hi]. Periods step `interval` units from
 * dtstart's own period (microseconds dropped), so the phase follows dtstart; each period's days pass the bymonth and
 * bymonthday filters and its times are the by-lists' product below the frequency (time(hour, minute, second)).
 * Only occurrences >= dtstart and <= until count.
 */
function rruleBetween(r           , dtstart0    , until    , lo    , hi    )       {
  const dtstart     = { day: dtstart0.day, us: dtstart0.us - (dtstart0.us % 1e6) };
  const out       = [];
  const end = cmp(until, hi) < 0 ? until : hi;
  const keep = (t    )       => { if (cmp(t, dtstart) >= 0 && cmp(t, lo) >= 0 && cmp(t, end) <= 0) out.push(t); };
  const dayOk = (day        )          => { const [, m, d] = civilFromDays(day); return r.bymonth.includes(m) && r.bymonthday.includes(d); };
  const H = sorted(r.byhour), Mi = sorted(r.byminute), S = sorted(r.bysecond);
  if (r.freq === 'monthly') {
    const c = civil(dtstart), e = civil(end);
    const days = sorted(r.bymonthday);
    for (let k = 0; ; k += r.interval) {
      const mm = c.m - 1 + k, y = c.y + Math.floor(mm / 12), m = (mm % 12) + 1;
      if (y > e.y || (y === e.y && m > e.m)) break;
      if (!r.bymonth.includes(m)) continue;
      for (const d of days) {
        if (d > monthDays(y, m)) continue;
        const day = daysFromCivil(y, m, d);
        for (const hh of H) for (const mi of Mi) for (const ss of S) keep({ day, us: ((hh * 60 + mi) * 60 + ss) * 1e6 });
      }
    }
    return out;
  }
  // fixed-length periods: index them from the epoch, and start at the first period that can reach `lo`
  const unit = UNIT_US[r.freq];
  const periodOf = (t    )         => t.day * (US_PER_DAY / unit) + Math.floor(t.us / unit);
  const p0 = periodOf(dtstart), pLo = periodOf(lo), pEnd = periodOf(end);
  const skip = pLo > p0 ? Math.floor((pLo - p0) / r.interval) * r.interval : 0;
  const perDay = US_PER_DAY / unit;
  for (let p = p0 + skip; p <= pEnd; p += r.interval) {
    const day = Math.floor(p / perDay), within = p - day * perDay;
    if (!dayOk(day)) continue;
    switch (r.freq) {
      case 'daily':
        for (const hh of H) for (const mi of Mi) for (const ss of S) keep({ day, us: ((hh * 60 + mi) * 60 + ss) * 1e6 });
        break;
      case 'hourly':
        if (!H.includes(within)) break;
        for (const mi of Mi) for (const ss of S) keep({ day, us: ((within * 60 + mi) * 60 + ss) * 1e6 });
        break;
      case 'minutely': {
        const hh = Math.floor(within / 60), mi = within % 60;
        if (!H.includes(hh) || !Mi.includes(mi)) break;
        for (const ss of S) keep({ day, us: ((hh * 60 + mi) * 60 + ss) * 1e6 });
        break;
      }
      case 'secondly': {
        const hh = Math.floor(within / 3600), mi = Math.floor(within / 60) % 60, ss = within % 60;
        if (H.includes(hh) && Mi.includes(mi) && S.includes(ss)) keep({ day, us: within * 1e6 });
        break;
      }
      default: return assertNever(r.freq);
    }
  }
  return out;
}

/**
 * RRuleLocator.tick_values: _create_rrule sets dtstart = vmin − relativedelta(vmax, vmin) and until = vmax + it
 * (capped at the datetime range), then rule.between(vmin, vmax, inc=True); no occurrence gives [vmin, vmax].
 */
export function rruleTicks(r           , view                           )                    {
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  const dmin = num2date(vmin), dmax = num2date(vmax);
  const delta = fullRelativedelta(dmax, dmin);
  const s = shiftByDelta(dmin, delta, -1), u = shiftByDelta(dmax, delta, 1);
  const start = s.kind === 'some' ? s.value : YEAR1, until = u.kind === 'some' ? u.value : YEAR9999_END;
  const ts = rruleBetween(r, start, until, dmin, dmax);
  return ts.length > 0 ? ts.map(date2num) : [date2num(dmin), date2num(dmax)];
}

/** YearLocator(base, month, day).tick_values: rrule YEARLY from the base multiple at or below vmin's year (month, day, 00:00). */
export function yearTicks(base        , month        , day        , view                           )                    {
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  const dmin = num2date(vmin), dmax = num2date(vmax);
  const a = civil(dmin), b = civil(dmax);
  const ymin = Math.max(Math.floor(a.y / base) * base, 1);
  const ymax = Math.min(Math.ceil(b.y / base) * base, 9999);
  // start = vmin.replace(year, month, day, 0:00:00) keeps vmin's microsecond; the rule's own dtstart drops it
  const start     = { day: daysFromCivil(ymin, month, Math.min(day, monthDays(ymin, month))), us: a.micro };
  const stop     = { day: daysFromCivil(ymax, month, Math.min(day, monthDays(ymax, month))), us: a.micro };
  const out           = [];
  for (let y = ymin; y <= ymax; y += base) {
    if (day > monthDays(y, month)) continue;   // rrule skips a bymonthday the month lacks
    const t     = { day: daysFromCivil(y, month, day), us: 0 };
    if (cmp(t, start) >= 0 && cmp(t, stop) <= 0) out.push(date2num(t));
  }
  return out.length > 0 ? out : [vmin, vmax];
}

/** RRuleLocator.get_unit_generic(freq): the unit AutoDateFormatter picks its format by. */
const RRULE_UNIT_DAYS = { monthly: DAYS_PER_MONTH, daily: 1, hourly: 1 / 24, minutely: 1 / 1440, secondly: 1 / 86400 }         ;

/** A date axis' major tick locations and its locator's unit (days), for any DateLocatorSpec. */
export function dateTicks(spec                 , view                           )                                                                  {
  switch (spec.kind) {
    case 'auto': { const t = autoDateTicks(view); return { locs: t.locs, unitDays: locatorUnitDays(t.locator) }; }
    case 'rrule': return { locs: rruleTicks(spec.rule, view), unitDays: RRULE_UNIT_DAYS[spec.rule.freq] };
    case 'year': return { locs: yearTicks(spec.base, spec.month, spec.day, view), unitDays: DAYS_PER_YEAR };
    default: return assertNever(spec);
  }
}

// ---------------------------------------------------------------- AutoDateFormatter (default rc formats)
const SCALED                                           = [
  [1 / US_PER_DAY, '%M:%S.%f'], [1 / 86400, '%H:%M:%S'], [1 / 1440, '%d %H:%M'], [1 / 24, '%m-%d %H'],
  [1, '%Y-%m-%d'], [DAYS_PER_MONTH, '%Y-%m'], [DAYS_PER_YEAR, '%Y'],
];
const pad = (v        , n        )         => String(v).padStart(n, '0');

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']         ;
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']         ;
const WEEKDAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']         ;
const WEEKDAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']         ;
/** Monday 0 … Sunday 6 (1970-01-01 was a Thursday) */
const weekday = (t    )         => (((t.day + 3) % 7) + 7) % 7;

/** datetime.strftime in the C locale: %Y %y %m %B %b %d %j %a %A %H %I %p %M %S %f %%; any other directive throws. */
export function strftime(t    , fmt        )         {
  const c = civil(t);
  return fmt.replace(/%(.)/g, (_, k        ) => {
    switch (k) {
      case 'Y': return String(c.y);
      case 'y': return pad(c.y % 100, 2);
      case 'B': return MONTH_FULL[c.m - 1];
      case 'a': return WEEKDAY_ABBR[weekday(t)];
      case 'A': return WEEKDAY_FULL[weekday(t)];
      case 'j': return pad(t.day - daysFromCivil(c.y, 1, 1) + 1, 3);
      case 'I': return pad(c.hh % 12 === 0 ? 12 : c.hh % 12, 2);
      case 'p': return c.hh < 12 ? 'AM' : 'PM';
      case 'm': return pad(c.m, 2);
      case 'd': return pad(c.d, 2);
      case 'b': {
        const i = Math.min(11, Math.max(0, c.m - 1));
        for (const [j, name] of MONTH_ABBR.entries()) if (j === i) return name;
        throw new Error('strftime %b: month out of range');
      }
      case 'H': return pad(c.hh, 2);
      case 'M': return pad(c.mm, 2);
      case 'S': return pad(c.ss, 2);
      case 'f': return pad(c.micro, 6);
      case '%': return '%';
      default: throw new Error(`unsupported strftime directive %${k}`);
    }
  });
}

/** AutoDateFormatter: the first scaled format whose scale is >= the locator's unit in days (else '%Y-%m-%d'). */
export function autoDateFormat(locs                   , unit        )                    {
  const i = SCALED.findIndex(([scale]) => scale >= unit);
  const fmt = i >= 0 ? SCALED[i][1] : '%Y-%m-%d';
  return locs.map((x) => strftime(num2date(x), fmt));
}

/** AutoDateLocator.nonsingular; with no data the default limits are 1970-01-01 .. 1970-01-02. */
export function dateNonsingular(v0        , v1        )                            {
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return [0, 1];
  const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
  return lo === hi ? [lo - DAYS_PER_YEAR * 2, hi + DAYS_PER_YEAR * 2] : [lo, hi];
}

// ---------------------------------------------------------------- DateFormatter / ConciseDateFormatter

/** Fixed strftime DateFormatter (matplotlib.dates.DateFormatter). UTC / C locale only. */
export function dateFormat(locs                   , fmt        )                    {
  return locs.map((x) => strftime(num2date(x), fmt));
}

/** ConciseDateFormatter option bag (matplotlib.dates.ConciseDateFormatter). */
                                  
                                              
                                                  
                                                    
                               
                                                                                      
                             
  

const DEFAULT_FORMATS                    = ['%Y', '%b', '%d', '%H:%M', '%H:%M', '%S.%f'];
const DEFAULT_ZERO                    = ['', '%Y', '%b', '%b-%d', '%H:%M', '%H:%M'];
const DEFAULT_OFFSET                    = ['', '%Y', '%Y-%b', '%Y-%b-%d', '%Y-%b-%d', '%Y-%b-%d %H:%M'];

const six = (name        , v                           , fallback                   )                    => {
  if (v.kind === 'none') return fallback;
  if (v.value.length !== 6) throw new RangeError(`${name} argument must be a list of 6 format strings (or None)`);
  return v.value;
};

function nthNum(row                   , i        , what        )         {
  for (const [j, v] of row.entries()) if (j === i) return v;
  throw new Error(`conciseDateFormat: missing ${what} ${i}`);
}
function nthStr(arr                   , i        , what        )         {
  for (const [j, v] of arr.entries()) if (j === i) return v;
  throw new Error(`conciseDateFormat: missing ${what} ${i}`);
}
function nthDT(arr               , i        )     {
  for (const [j, v] of arr.entries()) if (j === i) return v;
  throw new Error(`conciseDateFormat: missing tick ${i}`);
}

/**
 * ConciseDateFormatter.format_ticks + get_offset (matplotlib 3.11.2). Returns tick labels and the
 * offset string shown at the axis end. Level selection and zero-formats match the Python exactly.
 */
export function conciseDateFormat(
  locs                   ,
  opts                    ,
)                                                                  {
  if (locs.length === 0) return { labels: [], offset: '' };
  const fmts = six('formats', opts.formats, DEFAULT_FORMATS);
  let zerofmts                   ;
  if (opts.zeroFormats.kind === 'some') zerofmts = six('zero_formats', opts.zeroFormats, DEFAULT_ZERO);
  else if (opts.formats.kind === 'some') zerofmts = ['', ...fmts.slice(0, 5)];
  else zerofmts = DEFAULT_ZERO;
  const offsetfmts = six('offset_formats', opts.offsetFormats, DEFAULT_OFFSET);
  let showOffset = opts.showOffset;

  const tickdatetime                = locs.map((x) => num2date(x));
  // timetuple()[:6] → (y, m, d, hh, mm, ss); level index 0..5
  const tickdate                                 = tickdatetime.map((t) => {
    const c = civil(t);
    return [c.y, c.m, c.d, c.hh, c.mm, c.ss];
  });

  let level = 5;
  for (let lv = 5; lv >= 0; lv--) {
    const seen = new Set        ();
    for (const row of tickdate) seen.add(nthNum(row, lv, 'tick field'));
    if (seen.size > 1) {
      if (lv < 2 && [...seen].some((u) => u === 1)) showOffset = false;
      level = lv;
      break;
    } else if (lv === 0) {
      level = 5;
    }
  }

  const zerovals                    = [0, 1, 1, 0, 0, 0];
  const labels           = [];
  for (let nn = 0; nn < tickdate.length; nn++) {
    const t = nthDT(tickdatetime, nn);
    let found                            = none;
    for (const [j, r] of tickdate.entries()) if (j === nn) { found = some(r); break; }
    if (found.kind === 'none') throw new Error('conciseDateFormat: internal length mismatch');
    const rowN = found.value;
    let fmt        ;
    if (level < 5) {
      fmt = nthNum(rowN, level, 'field') === nthNum(zerovals, level, 'zeroval')
        ? nthStr(zerofmts, level, 'zero_format')
        : nthStr(fmts, level, 'format');
    } else {
      const c = civil(t);
      fmt = (c.ss === 0 && c.micro === 0) ? nthStr(zerofmts, level, 'zero_format') : nthStr(fmts, level, 'format');
    }
    labels.push(strftime(t, fmt));
  }

  // strip trailing zeros on second-level labels that contain a decimal
  if (level >= 5) {
    let trailing                 = none;
    for (const s of labels) {
      if (!s.includes('.')) continue;
      const n = s.length - s.replace(/0+$/, '').length;
      trailing = trailing.kind === 'none' ? some(n) : some(Math.min(trailing.value, n));
    }
    if (trailing.kind === 'some' && trailing.value > 0) {
      const cut = trailing.value;
      for (let i = 0; i < labels.length; i++) {
        let cur                 = none;
        for (const [j, s] of labels.entries()) if (j === i) { cur = some(s); break; }
        if (cur.kind === 'some' && cur.value.includes('.')) {
          let s = cur.value.slice(0, cur.value.length - cut);
          if (s.endsWith('.')) s = s.slice(0, -1);
          labels[i] = s;
        }
      }
    }
  }

  let offset = '';
  if (showOffset) {
    const t = opts.inverted ? nthDT(tickdatetime, 0) : nthDT(tickdatetime, tickdatetime.length - 1);
    offset = strftime(t, nthStr(offsetfmts, level, 'offset_format'));
  }
  return { labels, offset };
}
