export type Option<T> = {
    readonly kind: 'none';
} | {
    readonly kind: 'some';
    readonly value: T;
};
export type Result<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: string;
};
export declare const none: {
    readonly kind: 'none';
};
export declare const some: <T>(value: T) => Option<T>;
export declare const ok: <T>(value: T) => Result<T>;
export declare const err: <T>(error: string) => Result<T>;
/** The imperative shell's boundary: a Result becomes a value or an exception. */
export declare const unwrap: <T>(r: Result<T>) => T;
/** Exhaustiveness: unreachable when a switch handles every variant. */
export declare function assertNever(x: never): never;
/** A parsed color. alpha ∈ [0, 1]. */
export type Rgb = {
    readonly hex: string;
    readonly alpha: number;
};
/** A color slot that may be empty ('none' in matplotlib). */
export type Paint = {
    readonly kind: 'none';
} | {
    readonly kind: 'solid';
    readonly color: Rgb;
};
export type Cap = 'butt' | 'round' | 'square';
export type Join = 'miter' | 'round' | 'bevel';
/** Dash pattern in device px. */
export type Dash = {
    readonly kind: 'solid';
} | {
    readonly kind: 'dashed';
    readonly pattern: readonly number[];
    readonly offset: number;
};
/** A visible stroke: width > 0 px. */
export type Stroke = {
    readonly color: Rgb;
    readonly width: number;
    readonly cap: Cap;
    readonly join: Join;
    readonly dash: Dash;
};
/** What a closed shape draws. The fourth state (neither) is not a node at all. */
export type Ink = {
    readonly kind: 'fill';
    readonly fill: Rgb;
} | {
    readonly kind: 'stroke';
    readonly stroke: Stroke;
} | {
    readonly kind: 'fillStroke';
    readonly fill: Rgb;
    readonly stroke: Stroke;
};
export type Seg = readonly ['M', number, number] | readonly ['L', number, number] | readonly ['Q', number, number, number, number] | readonly ['C', number, number, number, number, number, number] | readonly ['Z'];
/** Text glyph rotation: axis-aligned, or arbitrary degrees CCW (matplotlib Text.rotation). */
export type Rotation = 'horizontal' | 'vertical' | {
    readonly kind: 'angled';
    readonly deg: number;
};
/** A positioned glyph: a font glyph key (character or ligature) and its offset along the baseline in px. */
export type Glyph = {
    readonly gid: number;
    readonly dx: number;
};
export type Clip = {
    readonly kind: 'none';
} | {
    readonly kind: 'rect';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
};
export type PathNode = {
    readonly kind: 'path';
    readonly segs: readonly Seg[];
    readonly ink: Ink;
    readonly antialiased: boolean;
};
/** Renderer-independent output of layout, in device px, top-left origin, laid out for one device (frame.ts Device: Agg snapping applied for PNG, none for SVG). */
export type Node = {
    readonly kind: 'rect';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly ink: Ink;
} | PathNode
/** MOVETO at the indices in `moves` (ascending), LINETO elsewhere (a NaN or clip break starts a new subpath). */
 | {
    readonly kind: 'polyline';
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly moves: Uint32Array;
    readonly stroke: Stroke;
} | {
    readonly kind: 'markers';
    readonly shape: readonly Seg[];
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly ink: Ink;
} | {
    readonly kind: 'text';
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly dy: number;
    readonly sizePx: number;
    readonly sizePt: number;
    readonly glyphs: readonly Glyph[];
    readonly face: string;
    readonly color: Rgb;
    readonly rotation: Rotation;
}
/** RGBA8 blit (imshow): top-left origin, straight alpha, size w×h. */
 | {
    readonly kind: 'image';
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly rgba: Uint8Array;
}
/**
 * A PathCollection of one marker path (scatter). `nodes` are its members drawn one by one
 * (_draw_path_collection_generic: one path per drawn point, snapped on the Agg device). The rest is the collection as matplotlib's SVG
 * backend writes it (draw_path_collection): `paths` holds one raw path per size, relative to its offset, and member
 * i is paths[refs[i]] at (xs[i], ys[i]) with nodes[i].ink. usesPerPath is _iter_collection_uses_per_path.
 */
 | {
    readonly kind: 'collection';
    readonly nodes: readonly PathNode[];
    readonly paths: readonly (readonly Seg[])[];
    readonly refs: Uint32Array;
    readonly xs: Float64Array;
    readonly ys: Float64Array;
    readonly usesPerPath: number;
}
/** tag: provenance ('artist/<index>/<kind>' for an Axes artist's marks, '' otherwise) for interactive renderers */
 | {
    readonly kind: 'group';
    readonly clip: Clip;
    readonly nodes: readonly Node[];
    readonly tag: string;
};
/** dpi is carried for renderers that size fonts like FreeType (points × dpi, in 26.6). */
export type Scene = {
    readonly width: number;
    readonly height: number;
    readonly dpi: number;
    readonly background: Paint;
    readonly nodes: readonly Node[];
};
/**
 * What a tick label says. 'power' is matplotlib's mathtext `$\mathdefault{[c\times]b^{e}}$`
 * (LogFormatterSciNotation); it is laid out by the mathtext model in text.ts.
 */
export type TickLabel = {
    readonly kind: 'plain';
    readonly text: string;
} | {
    readonly kind: 'power';
    readonly coeff: Option<string>;
    readonly base: string;
    readonly exponent: number;
};
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'bottom' | 'center' | 'baseline' | 'center_baseline';
/** Text placement: horizontal, 90° ylabel, or arbitrary-angle (rotation_mode='default'). */
export type Placement = {
    readonly kind: 'horizontal';
    readonly ha: HAlign;
    readonly va: VAlign;
} | {
    readonly kind: 'ylabel';
} | {
    readonly kind: 'ylabelRight';
}
/** rotation 90, rotation_mode='default': ha/va align the rotated box on (x, y) */
 | {
    readonly kind: 'vertical';
    readonly ha: HAlign;
    readonly va: VAlign;
}
/** Arbitrary degrees CCW; rotation_mode='default' (align the rotated AABB). */
 | {
    readonly kind: 'angled';
    readonly deg: number;
    readonly ha: HAlign;
    readonly va: VAlign;
};
export type MarkerName = 'o' | 's' | '^' | 'v' | '<' | '>' | 'D' | 'd' | 'x' | '+' | '*' | '.' | 'p' | 'h' | 'X' | 'P' | '|' | '_'
/** matplotlib.lines.CARET{LEFT,RIGHT,UP,DOWN}BASE (marker codes 8..11): errorbar's limit arrows */
 | 'caretleftbase' | 'caretrightbase' | 'caretupbase' | 'caretdownbase';
export type LineStyleName = 'solid' | 'dashed' | 'dashdot' | 'dotted';
/**
 * A linestyle: a named one, or an (offset, on-off sequence) dash tuple in pt before lines.scale_dashes. `onoff`
 * none is a None or empty sequence: drawn solid, though Line2D still counts it dashed (dash cap and join).
 */
export type LineStyle = LineStyleName | {
    readonly kind: 'dashes';
    readonly offset: number;
    readonly onoff: Option<readonly number[]>;
};
export type Label = {
    readonly kind: 'none';
} | {
    readonly kind: 'text';
    readonly text: string;
};
export type LineStroke = {
    readonly kind: 'none';
} | {
    readonly kind: 'on';
    readonly color: Rgb;
    readonly widthPt: number;
    readonly style: LineStyle;
};
export type LineMarkers = {
    readonly kind: 'none';
} | {
    readonly kind: 'on';
    readonly shape: MarkerName;
    readonly sizePt: number;
    readonly edgeWidthPt: number;
    readonly face: Paint;
    readonly edge: Paint;
};
export type BarEdge = {
    readonly kind: 'none';
} | {
    readonly kind: 'on';
    readonly color: Rgb;
    readonly widthPt: number;
};
export type Orientation = 'vertical' | 'horizontal';
/** Line2D.set_drawstyle: how consecutive points connect (cbook.pts_to_{pre,mid,post}step). */
export type DrawStyle = 'default' | 'steps-pre' | 'steps-mid' | 'steps-post';
/** Which coordinate system each of a line's coordinates is in: axhline is (axes, data), axvline (data, axes).
 *  Only data coordinates update the data limits. */
export type LineCoords = {
    readonly x: 'data' | 'axes';
    readonly y: 'data' | 'axes';
};
/**
 * plot(…, { decimate }), not a matplotlib option: before path cleanup, keep only the first and last sample of every
 * device-pixel column (perPx columns per pixel), its lowest and highest with their neighbours, and both ends of every
 * step over DECIMATE_STEP_PX, in their original order (decimateMinMax in path.ts). Off by default, so output
 * stays matplotlib's. Applies to a stroke whose x is non-decreasing; markers and legend placement see every sample.
 */
export type Decimate = {
    readonly kind: 'off';
} | {
    readonly kind: 'minmax';
    readonly perPx: number;
};
export type LineArtist = {
    readonly kind: 'line';
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly stroke: LineStroke;
    readonly markers: LineMarkers;
    readonly label: Label;
    readonly clip: boolean;
    readonly drawstyle: DrawStyle;
    readonly coords: LineCoords;
    readonly decimate: Decimate;
    /** Artist zorder: 2 for Line2D; errorbar's data line is 2.1 (1.9 with barsabove) */
    readonly zorder: number;
    /** Override lines.solid_capstyle / dash_capstyle; none = theme default (boxplot medians use butt). */
    readonly cap: Option<Cap>;
};
/** axline: an infinite straight line through p1 and p2, or through p1 with a slope (linear scales only),
 *  clipped to the view limits at draw time (lines.AxLine.get_transform). */
export type AxLineThrough = {
    readonly kind: 'point';
    readonly x2: number;
    readonly y2: number;
} | {
    readonly kind: 'slope';
    readonly slope: number;
};
export type AxLineArtist = {
    readonly kind: 'axline';
    readonly x1: number;
    readonly y1: number;
    readonly through: AxLineThrough;
    readonly stroke: LineStroke;
    readonly label: Label;
    readonly clip: boolean;
};
/** A LineCollection of straight segments (hlines, vlines, errorbar bars). Colours and line styles cycle
 *  over the segments; `zorder` is 2 (LineCollection's default). */
export type SegmentsArtist = {
    readonly kind: 'segments';
    readonly x0: Float64Array;
    readonly y0: Float64Array;
    readonly x1: Float64Array;
    readonly y1: Float64Array;
    readonly colors: readonly Rgb[];
    readonly widthPt: number;
    readonly styles: readonly LineStyle[];
    readonly label: Label;
    readonly clip: boolean;
    readonly zorder: number;
};
/** A Polygon patch (hist's step and stepfilled outlines): closed or open, filled or not.
 *  `stickyBase` is appended to sticky_edges on that axis (hist uses y=0 / x=0); none = no sticky. */
export type PolygonArtist = {
    readonly kind: 'polygon';
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly closed: boolean;
    readonly face: Paint;
    readonly edge: BarEdge;
    readonly label: Label;
    readonly clip: boolean;
    readonly zorder: number;
    readonly stickyBase: Option<{
        readonly axis: 'x' | 'y';
        readonly value: number;
    }>;
    /** matplotlib Patch.antialiased; false → Agg mono binary coverage (colorbar extend triangles). */
    readonly antialiased: boolean;
};
/** The look of an errorbar's legend entry (HandlerErrorbar): the data line (absent for fmt='none'), the bar
 *  lines, and the first cap line's marker style (absent without caps or limit markers). */
export type ErrorbarHandle = {
    readonly line: Option<{
        readonly stroke: LineStroke;
        readonly markers: LineMarkers;
    }>;
    readonly bar: {
        readonly color: Rgb;
        readonly widthPt: number;
        readonly style: LineStyle;
    };
    readonly caps: Option<{
        readonly sizePt: number;
        readonly edgeWidthPt: number;
        readonly edge: Paint;
        readonly face: Paint;
    }>;
    readonly hasX: boolean;
    readonly hasY: boolean;
};
/** ErrorbarContainer: draws nothing itself (its lines are separate artists); it carries the legend entry. */
export type ErrorbarArtist = {
    readonly kind: 'errorbar';
    readonly label: Label;
    readonly handle: ErrorbarHandle;
    readonly clip: boolean;
};
/** Rects in data coords; (x, y) is the corner at the base. The base axis is y for vertical bars (sticky edges). */
export type BarArtist = {
    readonly kind: 'bar';
    readonly orientation: Orientation;
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly w: Float64Array;
    readonly h: Float64Array;
    /** face is the legend handle's (matplotlib uses the first patch); faces[i] paints bar i */
    readonly face: Paint;
    readonly faces: readonly Paint[];
    readonly edge: BarEdge;
    readonly label: Label;
    readonly clip: boolean;
    /** whether the bases are sticky edges (hist clears them on every dataset after the first) */
    readonly sticky: boolean;
    /** hist's bars: each labelled bar is a legend child (Rectangle), not a BarContainer entry */
    readonly legend: 'container' | 'child';
};
/** fill_between: the polygon start → (x, y1)… → end → (x, y2) reversed. `color=` paints the edge too (Collection.set_color). */
export type FillArtist = {
    readonly kind: 'fill';
    readonly x: Float64Array;
    readonly y1: Float64Array;
    readonly y2: Float64Array;
    readonly face: Paint;
    readonly edge: BarEdge;
    readonly label: Label;
    readonly clip: boolean;
};
/** Where a text artist's (x, y) lives: data coordinates or axes fractions (transAxes). */
export type TextCoords = 'data' | 'axes';
export type TextArtist = {
    readonly kind: 'text';
    readonly x: number;
    readonly y: number;
    readonly coords: TextCoords;
    readonly text: string;
    readonly sizePt: number;
    readonly weight: number;
    readonly color: Rgb;
    readonly ha: HAlign;
    readonly va: VAlign;
    readonly clip: boolean;
    /** Text.rotation in degrees CCW, normalized to [0, 360) (rotation_mode='default'); 0 is horizontal. */
    readonly rotation: number;
};
/** Scatter: a PathCollection of identical markers at (x, y), size in pt^2 (matplotlib semantics). */
export type ScatterArtist = {
    readonly kind: 'scatter';
    readonly x: Float64Array;
    readonly y: Float64Array;
    readonly shape: MarkerName;
    readonly edgeWidthPt: number;
    readonly label: Label;
    readonly clip: boolean;
    readonly collection: ScatterCollection;
    /** Collection.zorder: default 1; honoured when given. */
    readonly zorder: number;
    /** ScalarMappable state when c is a numeric array; none for solid/list colours. */
    readonly mappable: Option<{
        readonly cmapName: string;
        readonly vmin: number;
        readonly vmax: number;
        readonly normKind: 'linear' | 'log';
    }>;
};
/** Axes aspect: 'auto' (default) or a fixed data aspect ratio ('equal' → 1), with adjustable='box'. */
export type Aspect = {
    readonly kind: 'auto';
} | {
    readonly kind: 'equal';
} | {
    readonly kind: 'ratio';
    readonly value: number;
};
/** A PathCollection's sizes (pt^2) and colours as given (get_sizes, get_facecolor, get_edgecolor): one each, or one
 *  per point, cycled over the points. Not broadcast, because the draw path and the legend handler depend on the
 *  lengths, and an empty scatter (a legend proxy) still has them. */
export type ScatterCollection = {
    readonly sizesPt2: Float64Array;
    readonly faces: readonly Paint[];
    readonly edges: readonly Paint[];
};
/**
 * An annotation coordinate system (_AnnotationBase._get_xy_transform): 'data', or "<ref> <unit>"
 * where ref is figure | axes | offset (offset: from the annotated point; textcoords only) and
 * unit is points | pixels | fontsize | fraction (fraction: figure and axes only).
 */
export type AnnotationRef = 'figure' | 'axes' | 'offset';
export type AnnotationUnit = 'points' | 'pixels' | 'fontsize' | 'fraction';
export type AnnotationCoords = {
    readonly kind: 'data';
} | {
    readonly kind: 'relative';
    readonly ref: AnnotationRef;
    readonly unit: AnnotationUnit;
};
/** xycoords / textcoords per axis: a string sets both (pair false); a (x, y) tuple sets each, as
 *  blended_transform_factory. Only the string 'data' hides an annotation whose xy leaves the axes (_check_xy). */
export type AnnotationCoordPair = {
    readonly x: AnnotationCoords;
    readonly y: AnnotationCoords;
    readonly pair: boolean;
};
/** One end of an ArrowStyle._Curve: nothing, an open head ('<', '>'), a filled head ('<|', '|>'), or a bracket (']', '[', '|'). */
export type CurveEnd = 'none' | 'open' | 'filled' | 'bracket';
/** The ArrowStyle classes annotate draws, with their parameters (fractions of the mutation scale). */
export type ArrowStyle = {
    readonly kind: 'curve';
    readonly name: string;
    readonly begin: CurveEnd;
    readonly end: CurveEnd;
    readonly headLength: number;
    readonly headWidth: number;
    readonly widthA: number;
    readonly widthB: number;
    readonly lengthA: number;
    readonly lengthB: number;
    /** scaleA / scaleB in px; none is the mutation size */
    readonly scaleA: Option<number>;
    readonly scaleB: Option<number>;
} | {
    readonly kind: 'simple';
    readonly headLength: number;
    readonly headWidth: number;
    readonly tailWidth: number;
} | {
    readonly kind: 'fancy';
    readonly headLength: number;
    readonly headWidth: number;
    readonly tailWidth: number;
} | {
    readonly kind: 'wedge';
    readonly tailWidth: number;
    readonly shrinkFactor: number;
};
/**
 * annotate's arrowprops. Without an 'arrowstyle' matplotlib simulates the YAArrow (ArrowStyle.Simple sized by
 * width / headwidth / headlength in pt, shrink a fraction); with one it is a FancyArrowPatch of that style along
 * ConnectionStyle.Arc3(rad), starting at relpos of the text box, shrunk by shrinkA / shrinkB pt.
 */
export type AnnotationArrow = {
    readonly kind: 'yaarrow';
    readonly face: Paint;
    readonly edge: Paint;
    readonly linewidthPt: number;
    readonly widthPt: number;
    readonly headLengthPt: number;
    readonly headWidthPt: number;
    readonly shrink: number;
} | {
    readonly kind: 'styled';
    readonly face: Paint;
    readonly edge: Paint;
    readonly linewidthPt: number;
    readonly style: ArrowStyle;
    readonly rad: number;
    readonly relpos: readonly [number, number];
    readonly shrinkAPt: number;
    readonly shrinkBPt: number;
    /** mutation_scale in pt; none is the annotation's font size */
    readonly mutationPt: Option<number>;
};
export type AnnotationArtist = {
    readonly kind: 'annotation';
    readonly x: number;
    readonly y: number;
    readonly xycoords: AnnotationCoordPair;
    readonly tx: number;
    readonly ty: number;
    readonly textcoords: AnnotationCoordPair;
    readonly text: string;
    readonly sizePt: number;
    readonly weight: number;
    readonly color: Rgb;
    readonly ha: HAlign;
    readonly va: VAlign;
    /** the FancyArrowPatch arrowprops build; none when arrowprops is absent */
    readonly arrow: Option<AnnotationArrow>;
    readonly clip: boolean;
};
/** axvspan/axhspan bands: oriented spans that may use axes-fraction extents on the non-data axis. */
export type SpanArtist = {
    readonly kind: 'span';
    readonly orientation: Orientation;
    /** data coordinates on the data axis (x for vertical, y for horizontal) */
    readonly a0: number;
    readonly a1: number;
    /** [0,1] fractions on the other axis, in axes coordinates */
    readonly f0: number;
    readonly f1: number;
    readonly face: Paint;
    readonly edge: BarEdge;
    readonly label: Label;
    readonly clip: boolean;
};
/** imshow: ScalarMappable raster over an extent in data coordinates. */
export type ImageArtist = {
    readonly kind: 'image';
    /** Scalar grid, or RGB(A) packed as Float64Array length rows*cols*channels with values in 0..1. */
    readonly values: Float64Array;
    readonly rows: number;
    readonly cols: number;
    readonly channels: 1 | 3 | 4;
    readonly cmapName: string;
    readonly vmin: number;
    readonly vmax: number;
    readonly normKind: 'linear' | 'log';
    readonly extent: readonly [number, number, number, number];
    readonly origin: 'upper' | 'lower';
    readonly interpolation: 'nearest' | 'none' | 'antialiased' | 'auto' | 'hanning' | 'bilinear';
    readonly alpha: number;
    readonly label: Label;
    readonly clip: boolean;
    readonly zorder: number;
};
/** Invisible extent + sticky edges (boxplot manage_ticks pads positions by ±0.5). Draws nothing. */
export type StickyArtist = {
    readonly kind: 'sticky';
    readonly xs: readonly number[];
    readonly ys: readonly number[];
    readonly label: Label;
    readonly clip: boolean;
};
/**
 * A Wedge patch (Axes.pie): Path.arc(theta1, theta2) (degrees) scaled by r about (cx, cy), closed through the centre,
 * or the ring between r − width and r. `shift` makes it a patches.Shadow of that wedge: its path moves by
 * (ox, oy)·dpi/72 in data units (Shadow._update_transform's translation, composed before transData).
 */
export type WedgeArtist = {
    readonly kind: 'wedge';
    readonly cx: number;
    readonly cy: number;
    readonly r: number;
    readonly theta1: number;
    readonly theta2: number;
    readonly width: Option<number>;
    readonly face: Paint;
    readonly edge: BarEdge;
    readonly label: Label;
    readonly clip: boolean;
    readonly zorder: number;
    readonly shift: Option<{
        readonly oxPt: number;
        readonly oyPt: number;
    }>;
};
export type Artist = LineArtist | BarArtist | FillArtist | TextArtist | ScatterArtist | AnnotationArtist | SpanArtist | AxLineArtist | SegmentsArtist | PolygonArtist | ErrorbarArtist | ImageArtist | StickyArtist | WedgeArtist;
/** What a legend entry draws. */
export type Handle = {
    readonly kind: 'line';
    readonly stroke: LineStroke;
    readonly markers: LineMarkers;
} | {
    readonly kind: 'patch';
    readonly face: Paint;
    readonly edge: BarEdge;
} | {
    readonly kind: 'errorbar';
    readonly errorbar: ErrorbarHandle;
}
/** HandlerLineCollection: a 2-point Line2D given the collection's dash tuple, so it counts as dashed
 *  (dash cap and join) even when solid */
 | {
    readonly kind: 'collection';
    readonly color: Rgb;
    readonly widthPt: number;
    readonly style: LineStyle;
}
/** HandlerPathCollection: a scatter's marker path, sizes and colours, drawn as a small collection of its own */
 | {
    readonly kind: 'scatter';
    readonly shape: MarkerName;
    readonly collection: ScatterCollection;
    readonly edgeWidthPt: number;
};
export type LegendEntry = {
    readonly label: string;
    readonly handle: Handle;
};
export type Scale = {
    readonly kind: 'linear';
} | {
    readonly kind: 'log';
    readonly base: number;
};
/**
 * auto: autoscale at draw (a request is pending); fixed: set_xlim, autoscaling off; view: autoscaling on but
 * no request since the view was last computed (matplotlib's viewLim when not stale), e.g. (0, 1) on an Axes
 * nothing has asked to autoscale, or the limits axhline read before adding a line inside them.
 */
/** auto: autoscaled from the data; `inverted` keeps an inverted axis inverted (set_bound sorts high to low). */
export type Limits = {
    readonly kind: 'auto';
    readonly inverted: boolean;
} | {
    readonly kind: 'fixed';
    readonly lo: number;
    readonly hi: number;
} | {
    readonly kind: 'view';
    readonly lo: number;
    readonly hi: number;
};
export type TickSpec = {
    readonly kind: 'auto';
} | {
    readonly kind: 'fixed';
    readonly locs: readonly number[];
};
export type LabelSpec = {
    readonly kind: 'auto';
} | {
    readonly kind: 'fixed';
    readonly labels: readonly string[];
};
/** 'auto' ticks/labels mean "what matplotlib's converter picks for this kind of axis". */
/** Date-axis major formatter: AutoDateFormatter (default) or ConciseDateFormatter / DateFormatter. */
export type DateFormatterSpec = {
    readonly kind: 'auto';
} | {
    readonly kind: 'strftime';
    readonly fmt: string;
} | {
    readonly kind: 'concise';
    readonly formats: Option<readonly string[]>;
    readonly zeroFormats: Option<readonly string[]>;
    readonly offsetFormats: Option<readonly string[]>;
    readonly showOffset: boolean;
};
/** A dateutil rrule as matplotlib's RRuleLocator subclasses build it: every by-list explicit (a full range means any). */
export type RRuleSpec = {
    readonly freq: 'monthly' | 'daily' | 'hourly' | 'minutely' | 'secondly';
    readonly interval: number;
    readonly bymonth: readonly number[];
    readonly bymonthday: readonly number[];
    readonly byhour: readonly number[];
    readonly byminute: readonly number[];
    readonly bysecond: readonly number[];
};
/** Date-axis major locator: AutoDateLocator (default), an RRuleLocator (Month/Day/Hour/Minute/SecondLocator) or YearLocator. */
export type DateLocatorSpec = {
    readonly kind: 'auto';
} | {
    readonly kind: 'rrule';
    readonly rule: RRuleSpec;
} | {
    readonly kind: 'year';
    readonly base: number;
    readonly month: number;
    readonly day: number;
};
/** Spine.set_position: 'outward' pts from the axes edge (negative is inward), at an axes fraction, or at a data
 *  value ('center' is ('axes', 0.5), 'zero' is ('data', 0)). */
export type SpinePosition = {
    readonly kind: 'outward';
    readonly pts: number;
} | {
    readonly kind: 'axes';
    readonly at: number;
} | {
    readonly kind: 'data';
    readonly at: number;
};
export type AxisSpec = {
    readonly kind: 'numeric';
    readonly scale: Scale;
    readonly limits: Limits;
    readonly ticks: TickSpec;
    readonly labels: LabelSpec;
} | {
    readonly kind: 'category';
    readonly names: readonly string[];
    readonly limits: Limits;
    readonly ticks: TickSpec;
    readonly labels: LabelSpec;
}
/** values are matplotlib date numbers: days since 1970-01-01T00:00:00 UTC */
 | {
    readonly kind: 'datetime';
    readonly limits: Limits;
    readonly ticks: TickSpec;
    readonly labels: LabelSpec;
    readonly formatter: DateFormatterSpec;
    readonly locator: DateLocatorSpec;
};
export type GridWhich = 'x' | 'y' | 'both';
/** Text properties set on one major tick label (set_xticklabels kwargs, get_xticklabels()[i].set_*). */
/** Per-tick Text styling. rotation is degrees CCW (matplotlib); unsupported keys throw at set time. */
export type TickLabelStyle = {
    readonly color: Option<Rgb>;
    readonly sizePt: Option<number>;
    readonly weight: Option<number>;
    readonly rotation: Option<number>;
    readonly ha: Option<HAlign>;
    readonly visible: Option<boolean>;
};
/** [major tick index, style] pairs (a list, so the spec stays JSON for the layout cache); an index
 *  with no entry uses the tick theme. */
export type TickLabelStyles = readonly (readonly [number, TickLabelStyle])[];
export type GridSpec = {
    readonly kind: 'off';
} | {
    readonly kind: 'on';
    readonly which: GridWhich;
};
/** One family of gridlines (Line2D properties). `style` none is linestyle 'none': nothing drawn.
 *  `alpha` replaces the colour's alpha, as Line2D.set_alpha does (grid.alpha is passed as alpha). */
export type GridLines = {
    readonly color: Rgb;
    readonly widthPt: number;
    readonly style: Option<LineStyle>;
    readonly alpha: number;
};
/** Axis.grid state for one tick family: shown or not, and the line properties it keeps either way. */
export type TickGrid = {
    readonly on: boolean;
    readonly lines: GridLines;
};
export type AxisGrid = {
    readonly major: TickGrid;
    readonly minor: TickGrid;
};
export type AxesGrid = {
    readonly x: AxisGrid;
    readonly y: AxisGrid;
};
export type AnchorCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type LegendLoc = {
    readonly kind: 'best';
} | {
    readonly kind: 'anchored';
    readonly code: AnchorCode;
};
export type LegendSpec = {
    readonly kind: 'off';
} | {
    readonly kind: 'on';
    readonly loc: LegendLoc;
    readonly ncols: number;
    readonly frame: boolean;
    readonly fontSizePt: number;
    readonly markers: LegendMarkers;
};
/** Legend marker settings: scatterpoints and scatteryoffsets (HandlerPathCollection), markerscale (every handler's markers). */
export type LegendMarkers = {
    readonly scatterPoints: number;
    readonly scatterYOffsets: readonly number[];
    readonly markerScale: number;
};
/** A twinx Axes shares its host's x axis; its y axis, label and offset text live on the right. */
export type AxesRole = {
    readonly kind: 'primary';
} | {
    readonly kind: 'twinx';
    readonly host: number;
} | {
    readonly kind: 'colorbar';
    readonly orientation: 'vertical' | 'horizontal';
    readonly ticklocation: 'left' | 'right' | 'top' | 'bottom';
};
/** One of an Axes' three titles (matplotlib's _left_title, title, _right_title); '' draws nothing. y is the
 *  baseline's height in axes fractions (1: the top), before the shared pad. */
export type AxesTitle = {
    readonly text: string;
    readonly sizePt: number;
    readonly weight: number;
    readonly color: Rgb;
    readonly y: number;
};
/** set_title's three slots, each its own Text, and the pad (points) every one of them is offset by. */
export type AxesTitles = {
    readonly left: AxesTitle;
    readonly center: AxesTitle;
    readonly right: AxesTitle;
    readonly padPt: number;
};
/** axes.titlecolor: 'auto' leaves a title's colour as it was (text.color at first); a colour resets it on every set_title. */
export type TitleColor = {
    readonly kind: 'auto' | 'set';
    readonly color: Rgb;
};
/** Fractions of the figure: left, bottom, right, top. */
export type Position = readonly [number, number, number, number];
export type AxesSpec = {
    readonly role: AxesRole;
    readonly position: Position;
    readonly artists: readonly Artist[];
    readonly titles: AxesTitles;
    readonly xlabel: string;
    readonly ylabel: string;
    readonly x: AxisSpec;
    readonly y: AxisSpec;
    readonly grid: AxesGrid;
    readonly legend: LegendSpec;
    /** set_aspect: applied at draw (adjustable='box'). */
    readonly aspect: Aspect;
    /** set_box_aspect: physical height/width of the Axes box; none when unset. */
    readonly boxAspect: Option<number>;
    /** set_anchor: where the shrunk box sits in the original position (matplotlib default 'C' = [0.5,0.5]). */
    readonly anchor: readonly [number, number];
    /** Colorbar triangular extends: fractions of the *inner* axes (default extendfrac=0.05).
     *  Layout shrinks the axes box like matplotlib._ColorbarAxesLocator before box_aspect. */
    readonly colorbarExtend: Option<{
        readonly lower: number;
        readonly upper: number;
    }>;
    readonly spines: {
        readonly left: {
            readonly visible: boolean;
            readonly color: Option<Rgb>;
            readonly widthPt: Option<number>;
            readonly position: Option<SpinePosition>;
        };
        readonly right: {
            readonly visible: boolean;
            readonly color: Option<Rgb>;
            readonly widthPt: Option<number>;
            readonly position: Option<SpinePosition>;
        };
        readonly top: {
            readonly visible: boolean;
            readonly color: Option<Rgb>;
            readonly widthPt: Option<number>;
            readonly position: Option<SpinePosition>;
        };
        readonly bottom: {
            readonly visible: boolean;
            readonly color: Option<Rgb>;
            readonly widthPt: Option<number>;
            readonly position: Option<SpinePosition>;
        };
    };
    readonly tick: {
        readonly x: TickTheme;
        readonly y: TickTheme;
    };
    readonly tickLabels: {
        readonly x: TickLabelStyles;
        readonly y: TickLabelStyles;
    };
    /** index of the first Axes sharing this x (y) axis: one group gets one set of limits and ticks */
    readonly xShare: number;
    readonly yShare: number;
    /** label_outer: this Axes draws no tick labels (major or minor) and no offset text on that axis */
    readonly hiddenLabels: {
        readonly x: boolean;
        readonly y: boolean;
    };
    /** Axes.set_frame_on: false draws neither the axes patch nor the spines (pie with frame=False). */
    readonly frameOn: boolean;
};
export type FigureSpec = {
    readonly widthIn: number;
    readonly heightIn: number;
    readonly dpi: number;
    readonly theme: Theme;
    readonly axes: readonly AxesSpec[];
    readonly figText: readonly {
        readonly text: string;
        readonly x: number;
        readonly y: number;
        readonly ha: HAlign;
        readonly va: VAlign;
        readonly sizePt: number;
        readonly weight: number;
        readonly color: Rgb;
    }[];
    readonly suptitle: Option<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
        readonly ha: HAlign;
        readonly va: VAlign;
        readonly sizePt: number;
        readonly weight: number;
        readonly color: Rgb;
    }>;
    readonly supx: Option<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
        readonly ha: HAlign;
        readonly va: VAlign;
        readonly sizePt: number;
        readonly weight: number;
        readonly color: Rgb;
    }>;
    readonly supy: Option<{
        readonly text: string;
        readonly x: number;
        readonly y: number;
        readonly ha: HAlign;
        readonly va: VAlign;
        readonly sizePt: number;
        readonly weight: number;
        readonly color: Rgb;
    }>;
};
export type TickDirection = 'in' | 'out' | 'inout';
export type AxisBelow = 'below' | 'line' | 'above';
export type TickTheme = {
    readonly sizePt: number;
    readonly widthPt: number;
    readonly padPt: number;
    readonly labelSizePt: number;
    readonly minorSizePt: number;
    readonly minorWidthPt: number;
    readonly minorPadPt: number;
    readonly color: Rgb;
    readonly labelColor: Rgb;
    readonly direction: TickDirection;
    /** x: bottom/top, y: left/right */
    readonly near: boolean;
    readonly far: boolean;
    readonly labelNear: boolean;
};
export type Simplify = {
    readonly kind: 'off';
} | {
    readonly kind: 'on';
    readonly thresholdPx: number;
};
export type Theme = {
    readonly figure: {
        readonly widthIn: number;
        readonly heightIn: number;
        readonly dpi: number;
        readonly background: Paint;
        readonly subplot: Position;
        /** figure.subplot.wspace / hspace */
        readonly spacing: {
            readonly wspace: number;
            readonly hspace: number;
        };
        readonly titleSizePt: number;
        readonly titleWeight: number;
        readonly labelSizePt: number;
        readonly labelWeight: number;
    };
    /** font.family resolved to faces by weight: body text, axes titles, axes labels */
    /** families: one entry per rc font.family name, each its candidate font names ('sans-serif' expands to font.sans-serif) */
    readonly font: {
        readonly families: readonly (readonly string[])[];
        readonly sizePt: number;
        readonly weight: number;
        readonly titleWeight: number;
        readonly labelWeight: number;
    };
    readonly text: {
        readonly color: Rgb;
    };
    /** How SVG text is written: 'text' nodes or glyph 'path's (rc svg.fonttype: 'none' -> 'text', 'path' -> 'glyphs') */
    readonly svgText: 'text' | 'glyphs';
    readonly axes: {
        readonly face: Paint;
        readonly edge: Rgb;
        readonly linewidthPt: number;
        readonly spines: {
            readonly left: boolean;
            readonly bottom: boolean;
            readonly top: boolean;
            readonly right: boolean;
        };
        readonly grid: GridSpec;
        readonly axisBelow: AxisBelow;
        readonly labelSizePt: number;
        readonly labelColor: Rgb;
        readonly labelPadPt: number;
        readonly titleSizePt: number;
        readonly titleColor: TitleColor;
        readonly titlePadPt: number;
        readonly titleLoc: HAlign;
        readonly xmargin: number;
        readonly ymargin: number;
        readonly formatter: {
            readonly limits: readonly [number, number];
            readonly offsetThreshold: number;
            readonly useOffset: boolean;
        };
        readonly unicodeMinus: boolean;
        readonly cycle: readonly Rgb[];
    };
    readonly lines: {
        readonly widthPt: number;
        readonly style: Option<LineStyle>;
        readonly marker: Option<MarkerName>;
        readonly markerSizePt: number;
        readonly markerEdgeWidthPt: number;
        /** lines.markeredgecolor / markerfacecolor; none = 'auto' (follow the line colour) */
        readonly markerEdge: Option<Paint>;
        readonly markerFace: Option<Paint>;
        readonly solidCap: Cap;
        readonly solidJoin: Join;
        readonly dashCap: Cap;
        readonly dashJoin: Join;
        readonly patterns: {
            readonly dashed: readonly number[];
            readonly dashdot: readonly number[];
            readonly dotted: readonly number[];
        };
        readonly scaleDashes: boolean;
        /** lines.color: Line2D's own default (axhline, axline, LineCollections), not the prop cycle */
        readonly color: Rgb;
    };
    readonly simplify: Simplify;
    readonly patch: {
        readonly linewidthPt: number;
        readonly edge: Rgb;
        readonly forceEdge: boolean;
    };
    readonly grid: {
        readonly color: Rgb;
        readonly style: LineStyle;
        readonly widthPt: number;
        readonly alpha: number;
    };
    readonly xtick: TickTheme;
    readonly ytick: TickTheme;
    readonly legend: {
        readonly loc: LegendLoc;
        readonly frame: boolean;
        readonly frameAlpha: number;
        readonly face: Rgb;
        readonly edge: Rgb;
        readonly fancy: boolean;
        readonly fontSizePt: number;
        readonly labelColor: Rgb;
        readonly borderPad: number;
        readonly labelSpacing: number;
        readonly handleLength: number;
        readonly handleHeight: number;
        readonly handleTextPad: number;
        readonly borderAxesPad: number;
        readonly columnSpacing: number;
        readonly scatterPoints: number;
        readonly markerScale: number;
    };
    readonly offsetTextPadPt: number;
    /** errorbar.capsize (pt), errorbar.capthick and errorbar.elinewidth (pt; none = follow the lines) */
    readonly errorbar: {
        readonly capsizePt: number;
        readonly capthickPt: Option<number>;
        readonly elinewidthPt: Option<number>;
    };
    /** hist.bins: a bin count or an estimator name */
    /** scatter.edgecolors: 'face' (each marker's edge is its face colour) or one colour */
    readonly scatterEdge: {
        readonly kind: 'face';
    } | {
        readonly kind: 'paint';
        readonly paint: Paint;
    };
    readonly histBins: {
        readonly kind: 'count';
        readonly n: number;
    } | {
        readonly kind: 'estimator';
        readonly name: string;
    };
    /** boxplot.* rc: whiskers, flags, and per-part Line2D/Patch defaults */
    readonly boxplot: {
        readonly whiskers: WhisRc;
        readonly notch: boolean;
        readonly patchArtist: boolean;
        readonly showMeans: boolean;
        readonly showCaps: boolean;
        readonly showBox: boolean;
        readonly showFliers: boolean;
        readonly meanline: boolean;
        readonly box: BoxplotLineRc;
        readonly whisker: BoxplotLineRc;
        readonly cap: BoxplotLineRc;
        readonly median: BoxplotLineRc;
        readonly mean: BoxplotMeanRc;
        readonly flier: BoxplotFlierRc;
    };
};
/** boxplot.whiskers: a float (IQR multiple) or a percentile pair. */
export type WhisRc = {
    readonly kind: 'iqr';
    readonly coef: number;
} | {
    readonly kind: 'percentiles';
    readonly lo: number;
    readonly hi: number;
};
export type BoxplotLineRc = {
    readonly color: Rgb;
    readonly linewidthPt: number;
    readonly style: LineStyle;
};
export type BoxplotMeanRc = BoxplotLineRc & {
    readonly marker: MarkerName;
    readonly markerFace: Rgb;
    readonly markerEdge: Rgb;
    readonly markerSizePt: number;
};
export type BoxplotFlierRc = {
    readonly color: Rgb;
    readonly linewidthPt: number;
    readonly style: Option<LineStyle>;
    readonly marker: MarkerName;
    readonly markerFace: Paint;
    readonly markerEdge: Rgb;
    readonly markerEdgeWidthPt: number;
    readonly markerSizePt: number;
};
export type AxisMeta = {
    readonly lim: readonly [number, number];
    readonly ticks: readonly number[];
    readonly labels: readonly string[];
    readonly offset: string;
    readonly minor: readonly number[];
    readonly minorLabels: readonly string[];
};
export type LegendMeta = {
    readonly loc: number;
    readonly x0: number;
    readonly x1: number;
    readonly top: number;
    readonly bottom: number;
};
/** The data → device mapping layout used for this axes (see core/frame.ts): what an interactive layer inverts. */
export type FrameMeta = {
    readonly box: {
        readonly x0: number;
        readonly x1: number;
        readonly yTop: number;
        readonly yBot: number;
    };
    readonly xlim: readonly [number, number];
    readonly ylim: readonly [number, number];
    readonly xscale: Scale;
    readonly yscale: Scale;
    readonly H: number;
};
/** A device-space box, px, y down. */
export type PxBox = {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
};
/** Axes.get_tightbbox(for_layout_only=True), px y down: what tight_layout fits into the figure. */
/** A tight bbox in px y down, plus its bottom and top edges in display (y-up) coordinates as matplotlib computes
 *  them (H − y1 can be an ulp off, which moves tight_layout's subplot params). */
export type TightBox = PxBox & {
    readonly b: number;
    readonly t: number;
};
export type AxesMeta = {
    readonly x: AxisMeta;
    readonly y: AxisMeta;
    readonly legend: Option<LegendMeta>;
    readonly frame: FrameMeta;
    readonly tight: TightBox;
};
