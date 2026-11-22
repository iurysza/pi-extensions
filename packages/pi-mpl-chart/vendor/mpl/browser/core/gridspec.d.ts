import type { Option, Position } from './types.js';
/** Figure.subplotpars: margins as figure fractions, spacing as fractions of the mean cell size. */
export type SubplotParams = {
    readonly left: number;
    readonly bottom: number;
    readonly right: number;
    readonly top: number;
    readonly wspace: number;
    readonly hspace: number;
};
/** A GridSpec: geometry, ratios, and the subplot parameters it overrides (gridspec_kw).
 *  `parent` is set for GridSpecFromSubplotSpec (colorbar make_axes_gridspec): positions nest
 *  inside the parent's cell bbox instead of the figure margins. */
export type GridSpec = {
    readonly nrows: number;
    readonly ncols: number;
    readonly widthRatios: readonly number[];
    readonly heightRatios: readonly number[];
    readonly overrides: {
        readonly left: Option<number>;
        readonly bottom: Option<number>;
        readonly right: Option<number>;
        readonly top: Option<number>;
        readonly wspace: Option<number>;
        readonly hspace: Option<number>;
    };
    readonly parent: Option<SubplotSpec>;
};
/** A SubplotSpec: the half-open row and column spans of one cell group in a GridSpec. */
export type SubplotSpec = {
    readonly grid: GridSpec;
    readonly rows: readonly [number, number];
    readonly cols: readonly [number, number];
};
/** GridSpec.get_subplot_params: non-None GridSpec attributes win over the figure's.
 *  Nested specs (parent set) replace left/bottom/right/top with the parent's cell bbox. */
export declare function subplotParams(gs: GridSpec, fig: SubplotParams): SubplotParams;
export type GridPositions = {
    readonly bottoms: readonly number[];
    readonly tops: readonly number[];
    readonly lefts: readonly number[];
    readonly rights: readonly number[];
};
/** GridSpecBase.get_grid_positions. */
export declare function gridPositions(gs: GridSpec, fig: SubplotParams): GridPositions;
/** SubplotSpec.get_position: the cell group's [left, bottom, right, top] (Bbox.from_extents). */
export declare function cellPosition(ss: SubplotSpec, fig: SubplotParams): Position;
/** Bbox.from_extents keeps its corners; SubplotParams.update rejects inverted margins. */
export declare function validParams(p: SubplotParams): Option<string>;
/** Build a top-level GridSpec (no parent). */
export declare function gridSpec(nrows: number, ncols: number, widthRatios: readonly number[], heightRatios: readonly number[], overrides: GridSpec['overrides']): GridSpec;
/** SubplotSpec.subgridspec: a GridSpecFromSubplotSpec nested in this cell. */
export declare function subgridspec(parent: SubplotSpec, nrows: number, ncols: number, opts: {
    readonly widthRatios: readonly number[];
    readonly heightRatios: readonly number[];
    readonly wspace: number;
    readonly hspace: number;
}): GridSpec;
/** A SubplotSpec covering rows [r0,r1) × cols [c0,c1). */
export declare function subplotSpec(grid: GridSpec, r0: number, r1: number, c0: number, c1: number): SubplotSpec;
