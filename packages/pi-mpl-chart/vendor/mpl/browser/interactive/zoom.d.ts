import type { Figure } from '../api.js';
/** 'auto' renders SVG frames, or canvas frames during a gesture for a chart above `threshold` SVG elements or whose SVG
 *  frames run over `budgetMs`; 'canvas' always uses canvas during gestures; 'svg' never does. The settled frame is SVG. */
export type Renderer = 'auto' | 'svg' | 'canvas';
/** One rendered frame: what drew it, at what raster scale, how long the render and the DOM update took, and the SVG text
 *  (empty for canvas frames). `settle` marks the SVG frame that follows canvas frames. */
export type FrameInfo = {
    readonly kind: 'svg' | 'canvas';
    readonly scale: number;
    readonly renderMs: number;
    readonly domMs: number;
    readonly svg: string;
    readonly settle: boolean;
    readonly view: View;
};
/** Each Axes' view limits in data units (date numbers on date axes), in data-mpl-axes order; lo > hi when inverted.
 *  `set` says which limits zoom has set on the figure (set_xlim / set_ylim); the others are the figure's own (autoscaled
 *  or set by the page), so the same Figure with these set_*lim calls renders the same frame anywhere, Node included. */
export type View = readonly {
    readonly x: readonly [number, number];
    readonly y: readonly [number, number];
    readonly set: {
        readonly x: boolean;
        readonly y: boolean;
    };
}[];
export type ZoomOptions = {
    /** Builds the Figure the server rendered (same code, same data); called once, on the first gesture. */
    readonly load: () => Figure | Promise<Figure>;
    /** The idPrefix the server passed to toSVG, so ids stay unique among several inlined SVGs. Default ''. */
    readonly idPrefix: string;
    readonly renderer: Renderer;
    /** 'auto': SVG elements above which gestures render to canvas. Default 1200 (see README, "Zoom and pan"). */
    readonly threshold: number;
    /** 'auto': when the median of the last 5 SVG frames (render + DOM) is slower than this, later gesture frames go to
     *  canvas. Default 12 ms. */
    readonly budgetMs: number;
    /** 'always' (default): the wheel zooms; 'modifier': only with Ctrl/⌘ (and trackpad pinch), so the page scrolls; 'off'. */
    readonly wheel: 'always' | 'modifier' | 'off';
    /** CSS touch-action on the <svg>. Default 'pan-y': one finger scrolls the page vertically and pans the chart
     *  horizontally; two fingers pinch. 'none' gives the chart every touch gesture. */
    readonly touchAction: string;
    /** Quiet time after the last input before the settled SVG frame replaces canvas frames. Default 150 ms. */
    readonly settleMs: number;
    /** 'gesture' (default) loads the figure on the first gesture; 'hover' already when the pointer or focus arrives. */
    readonly preload: 'gesture' | 'hover';
    /** Rewrites each SVG frame's text before it goes into the page, for a page that post-processed its server SVG the
     *  same way (theming colours as CSS variables, say). Default: unchanged. FrameInfo.svg is the render before it. */
    readonly svgText: (svg: string) => string;
    /** Called after every frame (telemetry, tests). */
    readonly onFrame: (f: FrameInfo) => void;
    /** Zoom x together across Axes showing the same x: true (default) within the figure, a name across figures, false not at all. */
    readonly sync: boolean | string;
};
export type ZoomController = {
    /** The view the chart is showing or about to show. */
    readonly view: () => View;
    /** Set one Axes' limits (data units); its share groups follow. Renders on the next frame. */
    readonly setView: (k: number, x: readonly [number, number], y: readonly [number, number]) => void;
    /** Back to the server's first paint (its DOM, restored as it was) and the figure's original limits. */
    readonly reset: () => void;
    /** Resolves once nothing is pending: the figure loaded (if a gesture asked for it), the last frame drawn and, after
     *  canvas frames, the settled SVG frame drawn too. */
    readonly idle: () => Promise<void>;
    /** The last frame drawn; kind 'svg' with empty text before the first one. */
    readonly last: () => FrameInfo;
    /** Remove every listener and the overlay; the SVG keeps its current content. */
    readonly destroy: () => void;
};
/** Make `svg` (an annotated SVG in the page) zoomable; see the module comment. */
export declare function zoom(svg: SVGSVGElement, options: Partial<ZoomOptions> & Pick<ZoomOptions, 'load'>): ZoomController;
