// The only module that observes JavaScript's `undefined`. Standard-library
// lookups are lifted into Option here, and nowhere else (tools/check_strict.mjs
// enforces this for every other file under src/).
                                         
import { none, some } from './types.js';

export function lookup      (m                   , k   )            {
  if (!m.has(k)) return none;
  const v = m.get(k);
  return v === undefined ? none : some(v);
}

/** An own property of a plain object (kwargs, rc layers), as Option<unknown>. */
export function prop(o                                   , k        )                  {
  return Object.hasOwn(o, k) ? some(o[k]) : none;
}

export const isPlainObject = (v         )                                         =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !ArrayBuffer.isView(v) && Object.getPrototypeOf(v) === Object.prototype;

export const isNullish = (v         )          => v === undefined || v === null;
