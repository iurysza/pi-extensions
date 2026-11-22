import type { Frame } from './frame.js';
import type { Device } from './frame.js';
import type { Option, AxesMeta, FigureSpec, PxBox, TightBox, Scene } from './types.js';
import type { Tracer } from '../trace.js';
export declare const unionBox: (bs: readonly PxBox[]) => PxBox;
/**
 * What an annotated (interactive) SVG needs from layout, per Axes: how many top-level scene nodes it drew (an
 * Axes' nodes are contiguous in Scene.nodes), its exact data → px frame, and each legend entry's box (px, y down)
 * with the index of the artist it stands for.
 */
export type AxesAnnot = {
    readonly nodes: number;
    readonly frame: Frame;
    readonly legend: readonly {
        readonly artist: number;
        readonly box: PxBox;
    }[];
};
/** Window extents (px, y down) of the suptitle and the supx/supylabels, where present. */
export declare function supBoxes(fig: FigureSpec): {
    readonly title: Option<PxBox>;
    readonly x: Option<PxBox>;
    readonly y: Option<PxBox>;
};
/** Each Axes' tight bbox (px, y down), as layoutFigure's meta[i].tight, without drawing what does not enter it. */
export declare function tightBoxes(fig: FigureSpec, tracer: Tracer): readonly TightBox[];
/** The figure's scene for one device: 'agg' (PNG) or 'svg' (see Device). Text and ticks are the same on both. */
export declare function layoutFigure(fig: FigureSpec, tracer: Tracer, dev?: Device): {
    readonly scene: Scene;
    readonly meta: readonly AxesMeta[];
    readonly annot: readonly AxesAnnot[];
};
