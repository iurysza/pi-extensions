import { type MajorFormatter } from './core/date-formatters.js';
import type { SubplotParams, SubplotSpec } from './core/gridspec.js';
import type { Artist, AxesMeta, DateLocatorSpec, AxesRole, AxesSpec, AxisSpec, BarArtist, FillArtist, TextArtist, TextCoords, LabelSpec, LegendSpec, Limits, AxLineArtist, ErrorbarArtist, PolygonArtist, SegmentsArtist, WedgeArtist, LineArtist, Option, Position, Result, Scale, Scene, Theme, TickSpec, ScatterArtist, ImageArtist, SpanArtist, AnnotationArtist } from './core/types.js';
import type { Canvas } from './render/agg.js';
export type Kwargs = Readonly<Record<string, unknown>>;
type Series = {
    readonly kind: 'numeric';
    readonly values: Float64Array;
} | {
    readonly kind: 'strings';
    readonly values: readonly string[];
} | {
    readonly kind: 'datetime';
    readonly values: Float64Array;
};
type NumericTypedArray = Float32Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array;
/** A point (x, y), as matplotlib's xy tuples. */
export type XY = readonly [number, number];
/** What hist() returns per dataset: the BarContainer of a bar histogram, or the Polygon of a step one. */
export type HistPatches = {
    readonly kind: 'bars';
    readonly bars: BarArtist;
} | {
    readonly kind: 'polygons';
    readonly polygons: readonly PolygonArtist[];
};
/** hist(x) of one dataset: [n, bins, patches] */
export type HistResult = readonly [Float64Array, Float64Array, HistPatches];
/** hist([x0, x1, …]): one n row and one patches entry per dataset, sharing the bin edges */
export type HistResultMulti = readonly [readonly Float64Array[], Float64Array, readonly HistPatches[]];
export type HistType = 'bar' | 'barstacked' | 'step' | 'stepfilled';
/** Axes.boxplot return: artists per component, as matplotlib's dict. Boxes are LineArtist or PolygonArtist. */
export type BoxplotBox = LineArtist | PolygonArtist;
export type BoxplotResult = {
    readonly boxes: readonly BoxplotBox[];
    readonly medians: readonly LineArtist[];
    readonly whiskers: readonly LineArtist[];
    readonly caps: readonly LineArtist[];
    readonly fliers: readonly LineArtist[];
    readonly means: readonly LineArtist[];
};
/** Axes.pie's PieContainer: the wedges, the label texts (none when labeldistance is null), the autopct texts (none
 *  without autopct), the values as given and the fractions the wedges span. */
export type PieResult = {
    readonly wedges: readonly WedgeArtist[];
    readonly texts: readonly TextArtist[];
    readonly autotexts: readonly TextArtist[];
    readonly values: Float64Array;
    readonly fracs: Float64Array;
};
/** ErrorbarContainer: (data_line, caplines, barlinecols) plus the legend artist. data_line is none for fmt='none'. */
export type ErrorbarContainer = {
    readonly artist: ErrorbarArtist;
    readonly data_line: Option<LineArtist>;
    readonly caplines: readonly LineArtist[];
    readonly barlinecols: readonly SegmentsArtist[];
    readonly has_xerr: boolean;
    readonly has_yerr: boolean;
};
type Units = {
    readonly kind: 'numeric';
} | {
    readonly kind: 'category';
    readonly names: readonly string[];
} | {
    readonly kind: 'datetime';
};
export declare class Axis {
    units: Units;
    scale: Scale;
    /** matplotlib's viewLim (0, 1) with autoscale on and nothing pending, until data arrives */
    limits: Limits;
    ticks: TickSpec;
    labels: LabelSpec;
    /** Major tick formatter; only meaningful for datetime axes (AutoDateFormatter by default). */
    formatter: MajorFormatter;
    /** Major date locator (AutoDateLocator by default); only a date axis uses it. */
    locator: DateLocatorSpec;
    /** StrCategoryConverter: strings map to 0..n-1 in first-seen order; the axis becomes categorical. */
    convert(s: Series): Float64Array;
    /**
     * One Text/Annotation coordinate in data space: convert_xunits at draw time. Unlike plot, text and annotate never call
     * update_units, so a Date converts (date2num) without making this a date axis, and a string must be a category of an
     * axis that is already categorical (StrCategoryConverter, which appends a name it has not seen).
     */
    position(v: unknown, what: string): Result<number>;
    /**
     * Axis.set_major_formatter — DateFormatter / ConciseDateFormatter on a date axis.
     * Numeric/category axes only accept the default ScalarFormatter (pass { kind: 'auto' } or omit);
     * anything else throws. Unsupported formatter classes throw a typed TypeError.
     */
    set_major_formatter(fmt: unknown): this;
    /**
     * Axis.set_major_locator — a date locator: AutoDateLocator, YearLocator, MonthLocator, DayLocator, HourLocator,
     * MinuteLocator or SecondLocator. It replaces set_xticks' fixed ticks, and the default AutoDateFormatter picks its
     * format from this locator's unit (Formatter._set_locator). It applies once the axis holds dates. Other locators throw.
     */
    set_major_locator(loc: unknown): this;
    setScale(v: unknown): void;
    /** get_inverted: the view limits run high to low */
    inverted(): boolean;
    /** _request_autoscale_view: a no-op once set_*lim turned autoscaling off */
    request(): void;
    /** Axis.set_inverted on a settled view interval: _set_lim(*sorted((a, b), reverse=inverted), auto=None), so an
     *  autoscaled axis stays autoscaled (and inverted) and set limits stay set. */
    setInverted(inverted: boolean): void;
    setLimits(args: readonly unknown[], fn: string): void;
    spec(): AxisSpec;
}
/** An Axes' place in the figure (see Axes.placement). */
export type AxesPlacement = {
    readonly kind: 'cell';
    readonly cell: SubplotSpec;
} | {
    readonly kind: 'moved';
    readonly cell: SubplotSpec;
    readonly pos: Position;
} | {
    readonly kind: 'free';
    readonly pos: Position;
};
export declare class Axes {
    readonly fig: Figure;
    readonly role: AxesRole;
    readonly theme: Theme;
    /** Where this Axes sits: a SubplotSpec (following the figure's subplot parameters), a SubplotSpec Axes that
     *  make_axes moved (_set_position: fixed until subplots_adjust re-places it), or a free rect (fig.add_axes). */
    placement: AxesPlacement;
    readonly artists: Artist[];
    readonly xaxis: Axis;
    readonly yaxis: Axis;
    /** _label_outer_xaxis / _label_outer_yaxis: tick labels (major and minor) and offset text hidden */
    private hiddenLabels;
    /** set_title's three slots (left, center, right) and their shared pad */
    private titles;
    xlabel: string;
    ylabel: string;
    private grid_;
    legendSpec: LegendSpec;
    private spineOv;
    private tickXOv;
    private tickYOv;
    private lineCycle;
    private patchCycle;
    /** set_aspect: 'auto' | 'equal' | number (adjustable='box'). */
    private aspect;
    /** set_box_aspect: physical H/W of the Axes box; none when unset. */
    private boxAspect;
    /** Axes.set_anchor: (x, y) in [0,1] within the original position when box/data aspect shrinks it. */
    private anchorXY;
    /** set_frame_on: the axes patch and spines draw (pie with frame=False turns it off). */
    private frameOn;
    /** Colorbar axes: hide the short-axis ticks and use a custom outline later. */
    /** True when this Axes is a colorbar cax. */
    colorbarMode: boolean;
    /** Triangular colorbar extends (axes-fraction lengths); none when extend='neither'. */
    colorbarExtend: Option<{
        readonly lower: number;
        readonly upper: number;
    }>;
    constructor(fig: Figure, role: AxesRole, placement: AxesPlacement, xaxis: Axis, yaxis: Axis);
    /** A second Axes sharing this one's x axis, with its y axis on the right. */
    twinx(): Axes;
    /** The Axes box [left, bottom, right, top] in figure fractions: get_position(original=True). */
    get position(): Position;
    /** get_subplotspec(): none for a free Axes. */
    get subplotspec(): Option<SubplotSpec>;
    /**
     * Axes._label_outer_xaxis / _label_outer_yaxis for a shared grid (subplots(sharex='col'|'all', …)): an
     * Axes off the bottom row loses its x tick labels and offset text, one off the left column its y ones.
     * Tick labels stay on the outer edge only; ticks are kept.
     */
    labelOuter(axis: 'x' | 'y'): void;
    /** set_xscale('linear' | 'log') */
    set_xscale(s: unknown): this;
    /** set_yscale('linear' | 'log') */
    set_yscale(s: unknown): this;
    /**
     * set_aspect('auto' | 'equal' | number) — data aspect ratio with adjustable='box' (matplotlib default
     * for set_aspect). The Axes box is shrunk and centred to match; 'equal' is ratio 1.
     */
    set_aspect(aspect: unknown): this;
    /** set_box_aspect(aspect | null) — physical height/width of the Axes box (colorbar uses 20). */
    set_box_aspect(aspect: unknown): this;
    /** set_anchor(anchor) — 'C' or [x, y] in [0, 1]; where a shrunk box sits in the original position. */
    set_anchor(anchor: unknown): this;
    /** Replace this Axes' SubplotSpec and take its position (colorbar make_axes_gridspec). */
    set_subplotspec(ss: SubplotSpec): void;
    private next;
    private paint;
    /**
     * plot(y) | plot(x, y) | plot(x, y, fmt), with an optional trailing kwargs object ({ drawstyle | ds, … }).
     * `decimate` is mpl's own, not matplotlib's (default false): true, or N columns per device pixel, keeps the first
     * and last sample of each column, its lowest and highest with their neighbours, and both ends of every step over
     * 2 px, before path cleanup, for dense time series. Antialiased edges then differ slightly from matplotlib; markers
     * and legend placement still use every sample.
     */
    plot(...args: readonly unknown[]): LineArtist;
    /** step(x, y, [fmt], { where: 'pre' | 'post' | 'mid', … }) — plot() with drawstyle 'steps-<where>'. */
    step(...args: readonly unknown[]): LineArtist;
    private plotArgs;
    /**
     * The Line2D properties: the fmt string first, then kwargs, which win. `color` gives the colour when
     * neither names one (the line prop cycle for plot(), lines.color for axhline/axline).
     */
    private lineProps;
    /** get_ybound / get_xbound: unstale the view limits, as matplotlib does when asked for them. */
    private settle;
    /** axhline(y = 0, { xmin = 0, xmax = 1, …Line2D }) — xmin/xmax are axes fractions. Autoscales y only when y is outside the current bounds. */
    axhline(y?: unknown, kwargs?: Kwargs): LineArtist;
    /** axvline(x = 0, { ymin = 0, ymax = 1, …Line2D }) — ymin/ymax are axes fractions. Autoscales x only when x is outside the current bounds. */
    axvline(x?: unknown, kwargs?: Kwargs): LineArtist;
    private refLineKw;
    /** The span along the line (f0, f1, axes fractions) is read by the caller, so docs/api.md lists each method's own keys. */
    private refLine;
    /** axline(xy1, xy2) or axline(xy1, { slope }) — an infinite line through two points, or one point and a slope (linear scales only). */
    axline(xy1: XY, xy2OrKw?: XY | Kwargs, kwargs?: Kwargs): AxLineArtist;
    /** hlines(y, xmin, xmax, { colors, linestyles, label, linewidth|lw, alpha, zorder, clip_on }) — a LineCollection of horizontal segments. */
    hlines(y: unknown, xmin: unknown, xmax: unknown, kwargs?: Kwargs): SegmentsArtist;
    /** vlines(x, ymin, ymax, { colors, linestyles, label, linewidth|lw, alpha, zorder, clip_on }) — a LineCollection of vertical segments. */
    vlines(x: unknown, ymin: unknown, ymax: unknown, kwargs?: Kwargs): SegmentsArtist;
    private lines;
    /**
     * errorbar(x, y, { yerr, xerr, fmt, ecolor, elinewidth, elinestyle, capsize, capthick, barsabove, lolims, uplims,
     * xlolims, xuplims, errorevery, label, …Line2D }) — errors are a scalar, one value per point, or [lower, upper].
     */
    errorbar(xRaw: unknown, yRaw: unknown, kwargs?: Kwargs): ErrorbarContainer;
    /**
     * hist(x, { bins, range, density, weights, cumulative, bottom, histtype, align, orientation, rwidth, log, color,
     * label, stacked, facecolor|fc, edgecolor|ec, linewidth|lw, alpha, clip_on }) — one dataset or a list of them.
     * Returns [n, bins, patches] as matplotlib does: per-dataset arrays when x is a list of datasets.
     */
    hist(x: number | readonly number[] | Float64Array | NumericTypedArray | readonly Date[] | readonly string[]): HistResult;
    hist(x: number | readonly number[] | Float64Array | NumericTypedArray | readonly Date[] | readonly string[], kwargs: Kwargs): HistResult;
    hist(x: readonly (readonly number[] | Float64Array | NumericTypedArray)[]): HistResultMulti;
    hist(x: readonly (readonly number[] | Float64Array | NumericTypedArray)[], kwargs: Kwargs): HistResultMulti;
    hist(x: unknown): HistResult | HistResultMulti;
    hist(x: unknown, kwargs: Kwargs): HistResult | HistResultMulti;
    /**
     * boxplot(x, { notch, vert, orientation, whis, positions, widths, patch_artist, showmeans, meanline,
     * showcaps, showbox, showfliers, manage_ticks, autorange, tick_labels|labels, zorder,
     * boxprops, whiskerprops, capprops, flierprops, medianprops, meanprops, clip_on }) —
     * Tukey's box-and-whisker plot. Quartiles match numpy.percentile linear. bootstrap / usermedians /
     * conf_intervals / capwidths / sym are unsupported and throw. Returns { boxes, medians, whiskers,
     * caps, fliers, means } as matplotlib does.
     *
     * Default tick labels (when `tick_labels`/`labels` are omitted): if every `positions` value is
     * integral, labels are `'1'`,`'2'`,…; otherwise each is Python `str(float)` (wholes get `'.0'`,
     * e.g. positions `[0.5, 2, 4.5]` → `'0.5'`,`'2.0'`,`'4.5'`). JS cannot distinguish `[1.0, 2.0]`
     * from `[1, 2]`, so all-integral float positions render like Python ints.
     */
    boxplot(xRaw: unknown, kwargs?: Kwargs): BoxplotResult;
    /**
     * pie(x, { labels, colors, autopct, explode, startangle, counterclock, shadow, radius, labeldistance, pctdistance,
     * wedgeprops, textprops, center, rotatelabels, normalize, frame }) — Axes.pie: one Wedge per value, counterclockwise
     * from the x axis by default, fractions x / sum(x) (normalize=false keeps x and draws a partial pie, sum(x) ≤ 1).
     * labels sit at labeldistance·radius (null: no label texts, the wedges still carry them to legend()), autopct (a
     * printf format such as '%1.1f%%', or a function of the percentage) at pctdistance·radius. explode offsets wedge i by
     * explode[i] along its bisector (data units, unscaled by radius, as in matplotlib); shadow (true, or { ox, oy, shade }) adds a darkened Shadow patch under
     * every wedge; wedgeprops { width, edgecolor|ec, linewidth|lw, facecolor|fc, alpha } style the wedges (width makes a
     * donut); textprops { fontsize|size, color|c, fontweight|weight } every text. Sets the aspect to 'equal', hides the
     * frame and ticks and fixes both limits to center ± 1.25. frame=true and hatch are not supported (they throw).
     * Returns { wedges, texts, autotexts, values, fracs }; texts is empty when labeldistance is null, autotexts when
     * autopct is absent.
     */
    pie(xRaw: unknown, kwargs?: Kwargs): PieResult;
    private parseBins;
    /** bar(x, height, { width, bottom, align, color|facecolor|fc, edgecolor|ec, linewidth|lw, alpha, label, clip_on }) — vertical bars. */
    bar(x: unknown, height: unknown, kwargs?: Kwargs): BarArtist;
    /** barh(y, width, { height, left, align, color|facecolor|fc, edgecolor|ec, linewidth|lw, alpha, label, clip_on }) — horizontal bars; `left` offsets each bar (Gantt and waterfall charts). */
    barh(y: unknown, width: unknown, kwargs?: Kwargs): BarArtist;
    /** thickRaw/baseRaw are bar's width/bottom or barh's height/left, read by the caller so docs/api.md lists each method's own keys. */
    private bars;
    /** fill_between(x, y1, y2 = 0, { color, alpha, label }) — a FillBetweenPolyCollection with no edges. */
    fill_between(xRaw: unknown, y1Raw: unknown, ...rest: readonly unknown[]): FillArtist;
    /** The transform tokens text() understands, named as in matplotlib. */
    get transData(): TransformRef;
    /** Axes-fraction coordinates for text(): (0, 0) bottom left, (1, 1) top right. */
    get transAxes(): TransformRef;
    /** text(x, y, s, { transform, color, fontsize, ha, va }) — data coordinates unless transform: ax.transAxes. */
    text(xRaw: unknown, yRaw: unknown, s: unknown, kwargs?: Kwargs): TextArtist;
    /**
     * Annotation's arrowprops: without 'arrowstyle' the YAArrow keys (width, headwidth, headlength, shrink); with one a
     * FancyArrowPatch's (arrowstyle, connectionstyle, relpos, shrinkA, shrinkB, mutation_scale). Either way the Patch
     * colours: patch.facecolor (C0) and patch.edgecolor, which 'color' overrides and the fc / ec aliases override in
     * turn (Patch.__init__ then Artist.set), with alpha replacing both colours' alpha; linewidth / lw in pt.
     */
    private arrowOf;
    /** annotate(text, xy, { xytext, xycoords, textcoords, arrowprops, ha, va, color, fontsize, fontweight, clip_on }) — coords are 'data' or '<figure|axes> <fraction|points|pixels|fontsize>', and textcoords may also be 'offset <points|pixels|fontsize>' from xy; either may be an [x, y] pair of systems, one per axis. In 'data' coordinates a value may be a Date or a category name. arrowprops without 'arrowstyle' take width, headwidth, headlength, shrink; with one ('-', '->', '-|>', '<-', '<->', '<|-', '<|-|>', ']-', '-[', ']-[', '|-|', ']->', '<-[', 'simple', 'fancy', 'wedge', each optionally ',key=value,...') they take connectionstyle ('arc3[,rad=r]'), relpos, shrinkA, shrinkB, mutation_scale and alpha; both take color, facecolor/fc, edgecolor/ec, linewidth/lw. */
    annotate(text: unknown, xy: unknown, kwargs?: Kwargs): AnnotationArtist;
    /**
     * imshow(Z, { cmap, norm, vmin, vmax, origin, extent, interpolation, aspect, alpha })
     * — display a 2-D array as an image. Default interpolation is 'auto' (nearest when
     * zoomed in, hanning when downsampling). Sets aspect to 'equal' unless overridden.
     */
    imshow(Z: unknown, kwargs?: Kwargs): ImageArtist;
    /**
     * scatter(x, y, { s, c, marker, cmap, norm, vmin, vmax, alpha, edgecolors, linewidths, zorder, clip_on })
     * — PathCollection. A numeric `c` array with `cmap` (default viridis) maps through Normalize(vmin, vmax).
     */
    scatter(xRaw: unknown, yRaw: unknown, kwargs?: Kwargs): ScatterArtist;
    /** axvspan: vertical span in data x and axes-fraction y */
    axvspan(xmin: unknown, xmax: unknown, kwargs?: Kwargs): SpanArtist;
    /** axhspan: horizontal span in data y and axes-fraction x */
    axhspan(ymin: unknown, ymax: unknown, kwargs?: Kwargs): SpanArtist;
    /**
     * set_title(label, { loc, pad, y, fontdict, fontsize|size, fontweight|weight, color|c }) — Axes.set_title: each
     * loc ('left' | 'center' | 'right', default axes.titlelocation) is its own title, so a left and a right title can
     * sit beside the centred one. Every call resets that title's size and weight to axes.titlesize/titleweight (and its
     * colour to axes.titlecolor unless 'auto'), applies `fontdict`, then the keywords; `pad` (points, default
     * axes.titlepad) moves every title; `y` is the baseline in axes fractions (default 1, the top).
     */
    set_title(s: unknown, kwargs?: Kwargs): this;
    /** get_title(loc = 'center') — the text of one of the three titles ('' when unset). */
    get_title(loc?: unknown): string;
    /**
     * ax.spines[side]: set_visible, set_color, set_linewidth and set_position. set_position takes 'center', 'zero' or
     * [type, amount] with type 'outward' (points; negative moves inward), 'axes' (an axes fraction) or 'data' (a data
     * value), as matplotlib's Spine.set_position; the bottom (left) spine carries the x (y) ticks and their labels along.
     * Anything else throws.
     */
    get spines(): Record<'left' | 'right' | 'top' | 'bottom', {
        set_visible: (v: boolean) => void;
        set_color: (v: unknown) => void;
        set_linewidth: (w: number) => void;
        set_position: (pos: unknown) => void;
    }>;
    /** Tick parameters: axis {'x','y','both'}, which {'major','minor','both'}, length, width, colors, labelsize, bottom/top/left/right, labelbottom/labelleft, pad, direction. */
    tick_params(kwargs?: Kwargs): this;
    /** set_xlabel(s) — x axis label; '\n' starts a new line. */
    set_xlabel(s: unknown): this;
    /** set_ylabel(s) — y axis label, rotated 90°; '\n' starts a new line. */
    set_ylabel(s: unknown): this;
    /** set_xlim(lo, hi) or set_xlim([lo, hi]); lo > hi inverts the axis. */
    set_xlim(...args: readonly unknown[]): this;
    /** set_ylim(lo, hi) or set_ylim([lo, hi]); lo > hi inverts the axis (top-down Gantt rows). */
    set_ylim(...args: readonly unknown[]): this;
    /** invert_xaxis(): Axis.set_inverted(!get_inverted()). Swaps the view limits; an autoscaled axis stays autoscaled and inverted. */
    invert_xaxis(): this;
    /** invert_yaxis(): Axis.set_inverted(!get_inverted()), e.g. top-down rows. An autoscaled axis stays autoscaled and inverted. */
    invert_yaxis(): this;
    /** set_xinverted(inverted): the x view limits sorted high to low (true) or low to high (false). */
    set_xinverted(inverted: unknown): this;
    /** set_yinverted(inverted): the y view limits sorted high to low (true) or low to high (false). */
    set_yinverted(inverted: unknown): this;
    /** get_xinverted() / xaxis_inverted(): whether the x view limits run high to low. */
    get_xinverted(): boolean;
    /** get_yinverted() / yaxis_inverted(): whether the y view limits run high to low. */
    get_yinverted(): boolean;
    xaxis_inverted(): boolean;
    yaxis_inverted(): boolean;
    /** set_xticks(locs) — fixed major tick locations. */
    set_xticks(t: unknown): this;
    /** set_yticks(locs) — fixed major tick locations. */
    set_yticks(t: unknown): this;
    /** set_xticklabels(labels, { color|c, fontsize|size, fontweight|weight }): the kwargs style every label set here. */
    set_xticklabels(l: unknown, kwargs?: Kwargs): this;
    /** set_yticklabels(labels, { color|c, fontsize|size, fontweight|weight }): the kwargs style every label set here. */
    set_yticklabels(l: unknown, kwargs?: Kwargs): this;
    /** The major tick labels as Text handles: get_text(), set_fontweight(), set_color(), set_fontsize(). */
    get_xticklabels(): readonly TickLabelText[];
    /** The major y tick labels as Text handles (see get_xticklabels). */
    get_yticklabels(): readonly TickLabelText[];
    private labelStyles;
    private setTickLabels;
    private readTextStyle;
    /** Merge `style` into major tick label i (only the properties it sets). */
    private styleTickLabel;
    private tickLabelHandles;
    /** grid(visible?, { which, axis, color|c, linewidth|lw, linestyle|ls, alpha }) — Axes.grid.
     *  As in matplotlib: line kwargs imply visible=True, visible=null toggles, and the line properties
     *  stick to the chosen axes and tick families (major, minor) for later grid() calls. A kwargs object
     *  alone, grid({ ... }), is grid(null, { ... }). */
    grid(visible?: unknown, kwargs?: Kwargs): this;
    /** legend({ loc, ncols|ncol, frameon, fontsize, scatterpoints, scatteryoffsets, markerscale }) — entries come from artists with a label; a scatter's entry draws scatterpoints markers (rc legend.scatterpoints) sized from its sizes, and markerscale (rc legend.markerscale) scales every entry's markers. */
    legend(kwargs?: Kwargs): this;
    /** The Axes as plain data (what layout consumes); mostly for tooling and tests. */
    spec(): AxesSpec;
}
/** sharex / sharey after GridSpec.subplots maps a bool to 'all' or 'none'. */
type Share = 'none' | 'all' | 'row' | 'col';
/** Colorbar: solids as N coloured bars matching matplotlib's pcolormesh flat-shading strip.
 *  `extend` adds under/over triangles in axes-fraction coords (default extendfrac=0.05) and
 *  shrinks the axes box like `_ColorbarAxesLocator`. */
export declare class Colorbar {
    readonly ax: Axes;
    readonly orientation: 'vertical' | 'horizontal';
    constructor(cax: Axes, m: {
        readonly cmapName: string;
        readonly vmin: number;
        readonly vmax: number;
        readonly normKind: 'linear' | 'log';
    }, orientation: 'vertical' | 'horizontal', cblabel: string, extend?: 'neither' | 'min' | 'max' | 'both');
    set_label(s: unknown): this;
}
export declare class Figure {
    readonly theme: Theme;
    readonly widthIn: number;
    readonly heightIn: number;
    readonly dpi: number;
    readonly axes: Axes[];
    meta: readonly AxesMeta[];
    /** Figure.subplotpars: figure.subplot.* until subplots_adjust or tight_layout changes them */
    subplotpars: SubplotParams;
    private _figText;
    private _suptitle;
    private _supx;
    private _supy;
    /** new Figure({ style, rc, figsize, dpi }) */
    constructor(kwargs?: Kwargs);
    /** add_subplot() — one Axes filling a 1x1 GridSpec, placed by the subplot parameters. */
    add_subplot(): Axes;
    /** fig.add_axes(rect): an Axes at a fixed [left, bottom, right, top] with no SubplotSpec (make_axes cax). */
    addAxesAt(pos: Position, role?: AxesRole): Axes;
    /** Add an Axes for a free SubplotSpec (colorbar cax). */
    addAxesFromSpec(cell: SubplotSpec, role?: AxesRole): Axes;
    /**
     * fig.colorbar(mappable, { ax, label, orientation, location, shrink, pad, fraction, aspect, anchor, panchor, extend })
     * — steal space for the colorbar and draw a continuous colorbar, ticked and labelled on its `location` side.
     * `ax` is one Axes (make_axes_gridspec: a GridSpec nested in its SubplotSpec) or a list of Axes (nested lists
     * flatten, like an ndarray): Colorbar.make_axes takes the space from the list's union bbox and moves every
     * listed Axes (and its twins) into the rest, so a column of panels stays aligned; that cax has no SubplotSpec
     * and a later subplots_adjust or tight_layout puts the listed Axes back on their SubplotSpecs, as in matplotlib.
     */
    colorbar(mappable: unknown, kwargs?: Kwargs): Colorbar;
    private addCell;
    /**
     * Figure.subplots / GridSpec.subplots: an nrows x ncols grid of Axes, row-major. sharex/sharey join
     * Axes to [0][0] ('all' or true), their row's first ('row') or their column's first ('col'); a
     * shared grid ('col'/'all' for x, 'row'/'all' for y) keeps tick labels on the outer Axes only.
     * Returns every Axes as rows; subplots() applies squeeze.
     */
    subplots(nrows: number, ncols: number, kwargs?: Kwargs): readonly (readonly Axes[])[];
    private spec;
    private _layoutCache;
    private touch;
    /** Figure-level text in figure coordinates (0..1). */
    text(x: unknown, y: unknown, s: unknown, kwargs?: Kwargs): this;
    /** suptitle(s, { color|c, fontsize|size, fontweight|weight }) — centred figure title (figure.titlesize/titleweight). */
    suptitle(s: unknown, kwargs?: Kwargs): this;
    /** supxlabel(s, { color|c, fontsize|size, fontweight|weight }) — figure-level x label at the bottom. */
    supxlabel(s: unknown, kwargs?: Kwargs): this;
    /** supylabel(s, { color|c, fontsize|size, fontweight|weight }) — figure-level y label at the left, rotated. */
    supylabel(s: unknown, kwargs?: Kwargs): this;
    /**
     * subplots_adjust({ left, bottom, right, top, wspace, hspace }) — SubplotParams.update: unset values are
     * kept; every Axes moves to its SubplotSpec's new position (a gridspec_kw value still wins for its grid).
     */
    subplots_adjust(kwargs?: Kwargs): this;
    /**
     * Figure.autofmt_xdate(bottom=0.2, rotation=30, ha='right', which='major') — rotate and align x tick
     * labels; on a shared-x grid, only the bottom row keeps visible labels (others hide labels and clear
     * xlabel); when every Axes is a subplot, also subplots_adjust(bottom). Minor labels (which='minor'|'both')
     * are not yet supported and throw.
     */
    autofmt_xdate(kwargs?: Kwargs): this;
    /** tight_layout({ pad = 1.08, h_pad, w_pad, rect }) — _tight_layout.get_tight_layout_figure: lay out now,
     *  measure each subplot cell's tight bbox (an Axes and its twins), then subplots_adjust margins and
     *  wspace/hspace so the decorations fit with `pad` (h_pad/w_pad between cells) font sizes to spare.
     *  A colorbar made for one Axes joins that Axes' cell (their topmost SubplotSpec), so it works in a grid.
     *  Axes with no SubplotSpec (a colorbar for a list of Axes) or on a gridspec_kw-adjusted GridSpec are left
     *  where they are, with matplotlib's warning. As in matplotlib it runs once, at call time: call it after
     *  the plot is complete. */
    tight_layout(kwargs?: Kwargs): this;
    /** Each Axes' tight bbox at the current subplot params: the layout tight_layout measures (one trace). */
    private measureTight;
    /**
     * _tight_layout._auto_adjust_subplotpars over the figure's SubplotSpecs (twins join their host's cell):
     * each cell's tight bbox overhang is added into the gutter rows/columns it borders, the outer gutters
     * become margins (plus the suptitle and supx/supylabel), the inner ones wspace/hspace.
     */
    private autoAdjust;
    /** Run layout; one trace per run. */
    toScene(): Scene;
    /** The scene for a device ('agg' rasterizes, 'svg' writes SVG), cached per device by a FigureSpec snapshot. */
    private sceneFor;
    /** toSVG's keywords: the id prefix, path data precision, and the annotated-SVG parts of the current layout (none for plain SVG). */
    private svgOptions;
    /**
     * toSVG({ precision, interactive, idPrefix }) — the figure as an SVG document string, as matplotlib's SVG backend writes it.
     * precision (mpl's own, 0–4): path coordinates (line and path `d`, marker positions) rounded to that many decimals, a
     * repeated command letter written once, and line vertices that round onto the previous one dropped. Omitted, the
     * output is unchanged (4 decimals).
     * interactive: true (default false) also wraps each Axes in <g data-mpl-axes="k"> with a JSON sidecar in
     * <metadata class="mpl-axes"> (axes box, scales, limits, each artist's data and pixel points, legend boxes) for
     * the mpl/interactive client: hover readouts, tooltips, highlighting and legend toggles. Drawing is unchanged.
     * The writer is opt-in code: registerSidecar(sidecar) with `sidecar` from mpl/annotate first, or this throws.
     * idPrefix (default '') prefixes every element id, so several SVGs can be inlined in one HTML page.
     */
    toSVG(kwargs?: Kwargs): string;
    /** svgChunks({ precision, interactive, idPrefix }) — the SVG as a generator of string chunks (keywords as in toSVG). */
    svgChunks(kwargs?: Kwargs): Generator<string>;
    /** svgStream({ precision, interactive, idPrefix }) — the SVG as a byte stream (Workers, browsers, Node; keywords as in toSVG). */
    svgStream(kwargs?: Kwargs): ReadableStream<Uint8Array>;
    /**
     * Layout at a savefig dpi (matplotlib Figure.savefig(dpi=…)). Default is this.dpi
     * (rc savefig.dpi = 'figure'). Does not mutate the figure's dpi or layout cache.
     */
    private sceneAtDpi;
    /** Resolve savefig dpi from kwargs: dpi, or scale × figure.dpi (not both). Omitted → figure dpi. */
    private saveDpi;
    /**
     * toRGBA({ dpi | scale, out }) — RGBA8 pixels (straight alpha), rasterized like matplotlib's Agg backend.
     * out: a canvas from an earlier toRGBA that the caller no longer needs (e.g. the previous frame's, after
     * putImageData). When it has this render's size it is cleared and drawn into, and the result shares its buffers;
     * otherwise a new canvas is returned. Without out, every call returns a new canvas that nothing else touches.
     */
    toRGBA(kwargs?: Kwargs): Canvas;
    /**
     * toPNG({ colors, dpi, scale }) — PNG bytes via CompressionStream. dpi is matplotlib savefig dpi
     * (default: figure dpi); scale is a convenience for dpi = figure.dpi × scale. Writes pHYs like Agg.
     */
    toPNG(kwargs?: Kwargs): Promise<Uint8Array>;
    /**
     * toPNGSync({ colors, level, dpi, scale }) — PNG bytes synchronously. dpi/scale as in toPNG;
     * level (1..9) is the built-in deflate effort. Matches matplotlib fig.savefig(…, format='png', dpi=D)
     * pixel-for-pixel, including the pHYs chunk.
     */
    toPNGSync(kwargs?: Kwargs): Uint8Array;
    /** pngStream({ colors, dpi, scale }) — PNG as a byte stream; dpi/scale as in toPNG. */
    pngStream(kwargs?: Kwargs): ReadableStream<Uint8Array>;
}
/** A major tick label (Tick.label1): its text, and the Text setters mpl supports. */
export type TickLabelText = {
    readonly get_text: () => string;
    readonly set_fontweight: (w: unknown) => void;
    readonly set_color: (c: unknown) => void;
    readonly set_fontsize: (s: unknown) => void;
    readonly set_rotation: (r: unknown) => void;
    readonly set_ha: (h: unknown) => void;
    readonly set_visible: (v: unknown) => void;
    readonly set: (kwargs: Kwargs) => void;
};
export type TransformRef = {
    readonly kind: 'transform';
    readonly coords: TextCoords;
};
/** Keyword arguments of subplots(): the Figure's, the grid's, and squeeze (each may be left out). */
export type SubplotsKwargs = Kwargs & Partial<{
    readonly style: unknown;
    readonly rc: Readonly<Record<string, unknown>>;
    readonly figsize: readonly [number, number];
    readonly dpi: number;
    readonly sharex: boolean | Share;
    readonly sharey: boolean | Share;
    readonly squeeze: boolean;
    readonly gridspec_kw: Partial<{
        readonly left: number;
        readonly bottom: number;
        readonly right: number;
        readonly top: number;
        readonly wspace: number;
        readonly hspace: number;
        readonly width_ratios: readonly number[];
        readonly height_ratios: readonly number[];
    }>;
}>;
/** A row-major grid of Axes: grid[row][col]. */
export type AxesGrid2D = readonly (readonly Axes[])[];
/** What subplots() can return when the shape is only known at run time. */
export type SubplotsAxes = Axes | readonly Axes[] | AxesGrid2D;
/**
 * The axes value subplots(nrows, ncols, { squeeze }) returns, from the literal types of its arguments:
 * squeeze=false: always rows of Axes; 1x1: one Axes; one row or column: a flat array; otherwise rows.
 * With non-literal sizes the shape is decided at run time, so it is the union.
 */
export type SubplotsResult<R extends number, C extends number, S extends boolean> = [
    S
] extends [false] ? AxesGrid2D : number extends R ? SubplotsAxes : number extends C ? SubplotsAxes : [R] extends [1] ? ([C] extends [1] ? Axes : readonly Axes[]) : [C] extends [1] ? readonly Axes[] : AxesGrid2D;
/** subplots() / subplots({ style, rc, figsize, dpi }) -> [fig, ax] */
export declare function subplots(): readonly [Figure, Axes];
export declare function subplots(kwargs: SubplotsKwargs): readonly [Figure, Axes];
/** subplots(nrows) -> [fig, axes]: a column of nrows Axes (one Axes when nrows is 1) */
export declare function subplots<R extends number>(nrows: R): readonly [Figure, SubplotsResult<R, 1, true>];
/** subplots(nrows, ncols) -> [fig, axes], squeezed as matplotlib does (SubplotsResult) */
export declare function subplots<R extends number, C extends number>(nrows: R, ncols: C): readonly [Figure, SubplotsResult<R, C, true>];
/** subplots(nrows, ncols, { sharex, sharey, squeeze = true, gridspec_kw, style, rc, figsize, dpi }) -> [fig, axes] */
export declare function subplots<R extends number, C extends number, S extends boolean = true>(nrows: R, ncols: C, kwargs: SubplotsKwargs & Partial<{
    readonly squeeze: S;
}>): readonly [Figure, SubplotsResult<R, C, S>];
export {};
