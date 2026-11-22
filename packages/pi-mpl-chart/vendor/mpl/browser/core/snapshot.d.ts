/** No previous snapshot: matches nothing. */
export declare const NO_SNAPSHOT: unique symbol;
/**
 * A snapshot of `live` that later mutation of `live` (or of the arrays it holds) cannot change, sharing every subtree
 * of `prev` (a previous snapshot, or NO_SNAPSHOT) that still matches. Returns `prev` itself iff `live` still equals the
 * state `prev` was taken from.
 */
export declare function resnapshot(prev: unknown, live: unknown): unknown;
/** A copy of `v` that later mutation of `v` (or of the arrays it holds) cannot change. */
export declare const snapshot: (v: unknown) => unknown;
/** Whether `live` still equals the state `snap` was taken from. */
export declare const sameSpec: (snap: unknown, live: unknown) => boolean;
