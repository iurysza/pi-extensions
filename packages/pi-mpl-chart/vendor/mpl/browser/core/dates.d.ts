import { type DateLocatorSpec, type Option, type RRuleSpec } from './types.js';
/** A calendar instant: whole days since the epoch plus microseconds into the day [0, 86.4e9). */
export type DT = {
    readonly day: number;
    readonly us: number;
};
export declare function daysFromCivil(y0: number, m: number, d: number): number;
/** A JS Date (ms since the epoch) as a DT. */
export declare function fromEpochMs(ms: number): DT;
/** date2num via _dt64_to_ordinalf: (whole seconds + extra_ns / 1e9) / 86400. */
export declare function date2num(t: DT): number;
/** num2date via _from_ordinalf: round to whole µs; beyond 70 years from the epoch, round to 20 µs. */
export declare function num2date(x: number): DT;
/**
 * What AutoDateLocator.get_locator picks. Under interval_multiples every rrule frequency runs
 * at interval 1, fixes all finer units to zero, and filters exactly one field.
 */
export type DateLocator = {
    readonly kind: 'yearly';
    readonly base: number;
} | {
    readonly kind: 'monthly';
    readonly months: readonly number[];
} | {
    readonly kind: 'daily';
    readonly monthdays: readonly number[];
} | {
    readonly kind: 'hourly';
    readonly hours: readonly number[];
} | {
    readonly kind: 'minutely';
    readonly minutes: readonly number[];
} | {
    readonly kind: 'secondly';
    readonly seconds: readonly number[];
} | {
    readonly kind: 'microsecond';
    readonly interval: number;
    readonly unitDays: number;
};
export declare function chooseDateLocator(dmin: DT, dmax: DT): DateLocator;
/** RRuleLocator / YearLocator unit (get_unit_generic), which picks the AutoDateFormatter format. */
export declare function locatorUnitDays(l: DateLocator): number;
/** AutoDateLocator.__call__ on the view interval (date numbers). */
export declare function autoDateTicks(view: readonly [number, number]): {
    readonly locs: readonly number[];
    readonly locator: DateLocator;
};
/**
 * RRuleLocator.tick_values: _create_rrule sets dtstart = vmin − relativedelta(vmax, vmin) and until = vmax + it
 * (capped at the datetime range), then rule.between(vmin, vmax, inc=True); no occurrence gives [vmin, vmax].
 */
export declare function rruleTicks(r: RRuleSpec, view: readonly [number, number]): readonly number[];
/** YearLocator(base, month, day).tick_values: rrule YEARLY from the base multiple at or below vmin's year (month, day, 00:00). */
export declare function yearTicks(base: number, month: number, day: number, view: readonly [number, number]): readonly number[];
/** A date axis' major tick locations and its locator's unit (days), for any DateLocatorSpec. */
export declare function dateTicks(spec: DateLocatorSpec, view: readonly [number, number]): {
    readonly locs: readonly number[];
    readonly unitDays: number;
};
/** datetime.strftime in the C locale: %Y %y %m %B %b %d %j %a %A %H %I %p %M %S %f %%; any other directive throws. */
export declare function strftime(t: DT, fmt: string): string;
/** AutoDateFormatter: the first scaled format whose scale is >= the locator's unit in days (else '%Y-%m-%d'). */
export declare function autoDateFormat(locs: readonly number[], unit: number): readonly string[];
/** AutoDateLocator.nonsingular; with no data the default limits are 1970-01-01 .. 1970-01-02. */
export declare function dateNonsingular(v0: number, v1: number): readonly [number, number];
/** Fixed strftime DateFormatter (matplotlib.dates.DateFormatter). UTC / C locale only. */
export declare function dateFormat(locs: readonly number[], fmt: string): readonly string[];
/** ConciseDateFormatter option bag (matplotlib.dates.ConciseDateFormatter). */
export type ConciseDateOptions = {
    readonly formats: Option<readonly string[]>;
    readonly zeroFormats: Option<readonly string[]>;
    readonly offsetFormats: Option<readonly string[]>;
    readonly showOffset: boolean;
    /** When the axis is inverted, the offset comes from the first tick (matplotlib). */
    readonly inverted: boolean;
};
/**
 * ConciseDateFormatter.format_ticks + get_offset (matplotlib 3.11.2). Returns tick labels and the
 * offset string shown at the axis end. Level selection and zero-formats match the Python exactly.
 */
export declare function conciseDateFormat(locs: readonly number[], opts: ConciseDateOptions): {
    readonly labels: readonly string[];
    readonly offset: string;
};
