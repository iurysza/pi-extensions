import type { RcLayer } from './rc.js';
import type { AnchorCode, LegendLoc, Result, Theme } from './types.js';
/** 1..10 -> AnchorCode; anything else is a programming error. */
export declare function anchorCode(n: number): AnchorCode;
export declare function parseLegendLoc(v: unknown): Result<LegendLoc>;
/** legend.scatterpoints / legend(scatterpoints=): how many markers a scatter's legend entry draws. */
export declare function scatterPointsOf(v: unknown): Result<number>;
export declare function parseFontSize(v: unknown, basePt: number): Result<number>;
export declare function parseTheme(rc: RcLayer): Result<Theme>;
