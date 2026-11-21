import type { Frame } from './frame.js';
import type { TextBox } from './text.js';
import type { TickSet } from './ticks.js';
import type { Option, TickLabelStyles, AxisGrid, Node, Rgb, Theme, TickTheme } from './types.js';
import type { Tracer } from '../trace.js';
/** Which spines carry ticks and which side gets labels (x: near=bottom, y: near=left). */
export type Sides = {
    readonly near: boolean;
    readonly far: boolean;
    readonly labels: 'near' | 'far' | 'none';
};
export type UpEdges = {
    readonly b: number;
    readonly t: number;
};
export type AxisDrawn = {
    readonly grid: readonly Node[];
    readonly marks: readonly Node[];
    readonly nearBoxes: readonly TextBox[];
    readonly farBoxes: readonly TextBox[];
    /** each near / far label's bottom and top edges in display y-up, in matplotlib's arithmetic */
    readonly nearUp: readonly UpEdges[];
    readonly farUp: readonly UpEdges[];
};
/** Text nodes for a placed label: one per run (mathtext has several). */
export declare function labelNodes(b: TextBox, k: number, color: Rgb): readonly Node[];
export declare function drawAxis(axis: 'x' | 'y', ticks: TickSet, tt: TickTheme, sides: Sides, grid: AxisGrid, labelStyles: TickLabelStyles, f: Frame, theme: Theme, dpi: number, tracer: Tracer, base: {
    readonly xLeft: number;
    readonly xRight: number;
    readonly yBottom: number;
    readonly yTop: number;
    readonly yBottomG: number;
    readonly yTopG: number;
    /** a bottom/top spine placed in display y-up ('axes'/'data'): its labels offset there, then flip (ScaledTranslation, then H − y) */
    readonly yBottomUp: Option<number>;
    readonly yTopUp: Option<number>;
}): AxisDrawn;
