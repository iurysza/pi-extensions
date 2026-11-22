import type { LineStyle, LineStyleName, MarkerName, Option, Result } from './types.js';
/** What a fmt string says about shape. 'default' = neither given (rc decides); naming one implies the other is off. */
export type FmtShape = {
    readonly kind: 'default';
} | {
    readonly kind: 'line';
    readonly line: LineStyleName;
} | {
    readonly kind: 'marker';
    readonly marker: MarkerName;
} | {
    readonly kind: 'both';
    readonly line: LineStyleName;
    readonly marker: MarkerName;
};
export type Fmt = {
    readonly color: Option<string>;
    readonly shape: FmtShape;
};
export declare function parseFmt(fmt: string): Result<Fmt>;
/**
 * A linestyle: a name ('-', '--', '-.', ':' or their long forms; 'None', 'none', '' and ' ' draw nothing) or an
 * [offset, [on, off, ...]] dash tuple in pt, as lines._get_dash_pattern and GraphicsContextBase.set_dashes accept
 * it: the offset wraps into one cycle, a null or empty sequence is solid, values are non-negative and one positive.
 */
export declare function parseLinestyle(v: unknown): Result<Option<LineStyle>>;
export declare function parseMarker(v: unknown): Result<Option<MarkerName>>;
