import { type DateFormatterSpec, type DateLocatorSpec, type Option } from './types.js';
/** AutoDateLocator() — the default date locator (interval_multiples=True). minticks/maxticks/interval_multiples are not supported. */
export declare class AutoDateLocator {
    readonly kind: 'auto';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** MonthLocator(bymonth = every month, bymonthday = 1, interval = 1): rrule MONTHLY at 00:00. */
export declare class MonthLocator {
    readonly kind: 'rrule';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** DayLocator(bymonthday = every day, interval = 1): rrule DAILY at 00:00. */
export declare class DayLocator {
    readonly kind: 'rrule';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** HourLocator(byhour = every hour, interval = 1): rrule HOURLY at :00:00. */
export declare class HourLocator {
    readonly kind: 'rrule';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** MinuteLocator(byminute = every minute, interval = 1): rrule MINUTELY at :00. */
export declare class MinuteLocator {
    readonly kind: 'rrule';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** SecondLocator(bysecond = every second, interval = 1): rrule SECONDLY. */
export declare class SecondLocator {
    readonly kind: 'rrule';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** YearLocator(base = 1, month = 1, day = 1): every base-th year (multiples of base) on that month and day. */
export declare class YearLocator {
    readonly kind: 'year';
    readonly spec: DateLocatorSpec;
    constructor(...args: readonly unknown[]);
}
/** Any date locator: set_major_locator takes one, and ConciseDateFormatter(locator) accepts one. */
export type DateLocatorHandle = AutoDateLocator | MonthLocator | DayLocator | HourLocator | MinuteLocator | SecondLocator | YearLocator;
export declare const isDateLocator: (v: unknown) => v is DateLocatorHandle;
/** DateFormatter(fmt) — fixed strftime. */
export declare class DateFormatter {
    readonly kind: 'strftime';
    readonly fmt: string;
    constructor(fmt: string);
}
/** Six format strings — ConciseDateFormatter level 0..5 (years … seconds), as matplotlib. */
export type DateFormatList = readonly [string, string, string, string, string, string];
/**
 * ConciseDateFormatter kwargs, matplotlib-shaped: every field optional; omitted → matplotlib default.
 * Format lists are 6-tuples at the type level; a wrong length still throws RangeError for JS callers.
 * Written as Partial<{…}> (not `x?:`) so check_strict stays happy; absence is lifted via prop().
 */
export type ConciseDateFormatterInit = Partial<{
    readonly formats: DateFormatList;
    readonly zero_formats: DateFormatList;
    readonly offset_formats: DateFormatList;
    readonly show_offset: boolean;
}>;
/** ConciseDateFormatter(locator, { formats, zero_formats, offset_formats, show_offset }). */
export declare class ConciseDateFormatter {
    readonly kind: 'concise';
    readonly formats: Option<readonly string[]>;
    readonly zeroFormats: Option<readonly string[]>;
    readonly offsetFormats: Option<readonly string[]>;
    readonly showOffset: boolean;
    constructor(locator: DateLocatorHandle, opts?: ConciseDateFormatterInit);
}
export type MajorFormatter = DateFormatter | ConciseDateFormatter | {
    readonly kind: 'auto';
};
export declare function formatterSpecOf(f: MajorFormatter): DateFormatterSpec;
