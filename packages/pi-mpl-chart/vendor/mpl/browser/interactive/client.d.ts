/** One axis of an Axes as the sidecar describes it. `lim` is the view interval (inverted when lim[0] > lim[1]); `g` the
 *  index of the Axes that leads its share group (sharex/sharey/twinx), -1 when the sidecar predates it; `t` the axis
 *  label; `fixed` whether the axis has fixed tick labels (set_xticklabels) and `tk` those labels as [loc, text] pairs; `step` the resolution of the value being formatted (days on a date axis; 0 when unknown: the client fills it in). */
export type AxisInfo = {
    readonly s: string;
    readonly lim: readonly [number, number];
    readonly b: number;
    readonly names: readonly string[];
    readonly px: number;
    readonly g: number;
    readonly t: string;
    readonly step: number;
    readonly fixed: boolean;
    readonly tk: readonly (readonly [number, string])[];
};
/** One artist: its kind, label, colour and points (data `d` and pixel `p`, flat x/y pairs), as the sidecar has them. */
export type ArtistInfo = {
    readonly i: number;
    readonly k: string;
    readonly l: string;
    readonly c: string;
    readonly s: string;
    readonly ds: string;
    readonly d: readonly number[];
    readonly p: readonly number[];
    readonly b: readonly number[];
    readonly r: number;
};
export type AxesInfo = {
    readonly box: readonly [number, number, number, number];
    readonly x: AxisInfo;
    readonly y: AxisInfo;
    readonly cb: boolean;
    readonly a: readonly ArtistInfo[];
    readonly lg: readonly (readonly number[])[];
    readonly ti: string;
};
/** Formats a value on an axis for display (`exact`: a data point, not the cursor); the default is formatValue. A custom
 *  formatter's text is used as is: the axis unit is only appended to the default formatter's. */
export type Format = (v: number, axis: AxisInfo, which: 'x' | 'y', exact: boolean, svg: SVGSVGElement) => string;
/** The sidecar JSON of one Axes, parsed. Throws on text that is not JSON. */
export declare function parseSidecar(text: string): AxesInfo;
/** A pixel (SVG user units, y down) to data on one axis of an Axes. */
export declare function pixelToData(ax: AxesInfo, which: 'x' | 'y', p: number): number;
/** Data to a pixel (SVG user units, y down) on one axis of an Axes. */
export declare function dataToPixel(ax: AxesInfo, which: 'x' | 'y', v: number): number;
/**
 * Dates in UTC at the resolution they have (the series' `step` for a point, one pixel for the cursor), categories by
 * name, log values to 3 significant digits, linear values to the axis' per-pixel resolution with at least 3 significant
 * digits (a data point keeps no trailing zeros).
 */
export declare function formatValue(v: number, a: AxisInfo, _which: 'x' | 'y', exact: boolean): string;
/** An axis label read for units. `plain`: appended to values as is ("ms", from "ms", "latency (ms)" or "Latency [ms]");
 *  `muted`: a rate that reads as a phrase ("requests / s"), shown quietly; `name`: the label without its unit ("latency"). */
export declare function unitOf(label: string): {
    readonly plain: string;
    readonly muted: string;
    readonly name: string;
};
export type Hit = {
    readonly art: ArtistInfo;
    readonly j: number;
    readonly dist: number;
};
/** The nearest visible point to (px, py): ordered series (s 'x' | 'y') snap along their axis (steps to the step
 *  that holds the value there), scatter and unordered lines by 2D distance; across artists, the closest point wins. */
export declare function nearest(arts: readonly ArtistInfo[], px: number, py: number, off?: ReadonlySet<number>): readonly Hit[];
type Entry = {
    readonly svg: SVGSVGElement;
    readonly k: number;
    readonly info: AxesInfo;
    readonly gid: number;
    readonly lead: boolean;
};
type Painter = {
    readonly paint: (gid: number, v: number, skip: readonly number[], svg: SVGSVGElement, hit: readonly ArtistInfo[]) => void;
    readonly clear: () => void;
};
/** The Axes that sync with each other: one per figure by default, one per name across figures. */
export type Hub = {
    readonly entries: Entry[];
    readonly painters: Set<Painter>;
    readonly zooms: Set<HubZoom>;
    last: readonly number[];
};
/** A zoom controller as its hub sees it: another figure's x-limits arriving, and a reset. */
export type HubZoom = {
    readonly svg: SVGSVGElement;
    readonly setX: (key: string, u: readonly [number, number]) => void;
    readonly reset: () => void;
};
/** The hub of `svg` for a `sync` option: true its own figure, a name shared across figures, false none (an empty list). */
export declare function hubFor(sync: boolean | string, svg: SVGSVGElement): readonly Hub[];
/** The sync group of Axes `k` of `svg`, fixed by its first-paint limits (a zoomed view must not change who it syncs with).
 *  Axes sharing an x axis (sharex, twinx) are one group; otherwise an Axes joins the first group whose leader it matches. */
export declare function groupOf(h: Hub, svg: SVGSVGElement, k: number, info: AxesInfo): number;
/** Options of attach(); every field is optional. */
export type AttachOptions = {
    /** How values print (default formatValue). */
    readonly format: Format;
    /** Below this visible chart width (CSS px) the tooltip is compact: smaller type and padding. Default 480; 0 never, Infinity always. */
    readonly compact: number;
    /** Distance from a mouse or focus position to the tooltip, CSS px. Default 14. */
    readonly gap: number;
    /** Distance from a finger to the tooltip, CSS px. Default 32. */
    readonly touchGap: number;
    /** Space kept between the tooltip and the chart's edges, CSS px. Default 4. */
    readonly margin: number;
    /** 'auto' (default): beside a mouse, above a finger. 'above': above and centred for every pointer. */
    readonly placement: 'auto' | 'above';
    /** Also list the cursor's own data coordinates under the point. Default false. */
    readonly cursor: boolean;
    /** The crosshair follows along in Axes that show the same x. true (default): within each figure; a name: also across
     *  every figure attached with that name; false: off. See sameX for the rule. mpl/zoom has the same option. */
    readonly sync: boolean | string;
};
/**
 * Make every annotated SVG under `root` interactive (fig.toSVG({ interactive: true }), inlined in the page).
 * Returns a function that undoes it. The second argument is either a value formatter (see formatValue) or AttachOptions.
 */
export declare function attach(root?: ParentNode, options?: Format | Partial<AttachOptions>): () => void;
export {};
