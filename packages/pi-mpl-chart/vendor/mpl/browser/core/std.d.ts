import type { Option } from './types.js';
export declare function lookup<K, V>(m: ReadonlyMap<K, V>, k: K): Option<V>;
/** An own property of a plain object (kwargs, rc layers), as Option<unknown>. */
export declare function prop(o: Readonly<Record<string, unknown>>, k: string): Option<unknown>;
export declare const isPlainObject: (v: unknown) => v is Readonly<Record<string, unknown>>;
export declare const isNullish: (v: unknown) => boolean;
