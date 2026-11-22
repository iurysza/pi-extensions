export type RcValue = string | number | boolean | readonly number[] | readonly string[];
export type RcLayer = ReadonlyMap<string, RcValue>;
export declare const TAB10: readonly string[];
/** matplotlib 3.11.2 defaults for every key the theme reads. */
export declare const DEFAULTS: RcLayer;
/** Later layers win. */
export declare function mergeLayers(layers: readonly RcLayer[]): RcLayer;
