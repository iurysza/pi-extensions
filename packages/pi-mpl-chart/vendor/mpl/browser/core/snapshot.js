// Layout-cache keys without serializing the data. A figure's spec holds every series (often the caller's own
// Float64Array, zero-copy), so JSON.stringify(spec) cost ~6.5 ms on a 35k-point chart, on every first render.
// A snapshot copies typed arrays with a native slice and keeps the rest of the tree. Equality is at least as strict
// as comparing the JSON: a snapshot match implies equal JSON. Functions are ignored and objects that aren't plain
// compare by their JSON, as JSON.stringify treats them.
//
// `resnapshot(prev, live)` compares and snapshots in one walk and shares structure: every subtree of `live` that
// still equals its counterpart in `prev` keeps prev's node (no copy), so the result is `prev` itself exactly when
// nothing changed. A pan or zoom loop misses the cache on every frame; before this, each miss deep-copied the whole
// spec (data arrays included) to store a key, and that copy plus the compare was 13–28 % of a re-render.
import { isNullish, isPlainObject } from './std.js';

class JsonLeaf {          json        ; constructor(json        ) { this.json = json; } }
class BytesLeaf {
           proto         ;          bytes            ;
  constructor(proto         , bytes            ) { this.proto = proto; this.bytes = bytes; }
}
/** A plain object: its own keys in order and their snapshots. */
class ObjNode {
           keys                   ;          vals                    ;
  constructor(keys                   , vals                    ) { this.keys = keys; this.vals = vals; }
}
/** An array's element snapshots (a class, so a snapshot node is never confused with a live array). */
class ArrNode {          vals                    ; constructor(vals                    ) { this.vals = vals; } }
const FN = Symbol('function');
/** No previous snapshot: matches nothing. */
export const NO_SNAPSHOT                = Symbol('no snapshot');

const isObject = (v         )              => typeof v === 'object' && !isNullish(v);
const bytesOf = (v                 )             => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);

function sameBytes(a            , b            )          {
  const n = a.length;
  if (b.length !== n) return false;
  // a is the snapshot's own aligned copy; compare b in 4-byte words when its offset allows
  if ((n & 3) === 0 && (b.byteOffset & 3) === 0) {
    const wa = new Int32Array(a.buffer, a.byteOffset, n >> 2), wb = new Int32Array(b.buffer, b.byteOffset, n >> 2);
    for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
    return true;
  }
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

function resnapArray(prev         , live                    )          {
  const n = live.length;
  const pv = prev instanceof ArrNode ? prev.vals : [];
  let out            = [];
  let changed = pv.length !== n;
  for (let i = 0; i < n; i++) {
    const p = i < pv.length ? pv[i] : NO_SNAPSHOT;
    const c = resnapshot(p, live[i]);
    if (!changed && !Object.is(c, p)) { changed = true; out = pv.slice(0, n); }
    if (changed) out[i] = c;
  }
  return changed ? new ArrNode(out) : prev;
}

function resnapObject(prev         , live                                   )          {
  const keys = Object.keys(live), n = keys.length;
  let pk                    = [], pv                     = [];
  if (prev instanceof ObjNode && prev.keys.length === n) {
    pk = prev.keys; pv = prev.vals;
    for (let i = 0; i < n; i++) if (pk[i] !== keys[i]) { pv = []; break; }
  }
  const keyed = pv.length === n;   // prev has exactly these keys in this order
  let out            = [];
  let changed = !keyed;
  for (let i = 0; i < n; i++) {
    const p = keyed ? pv[i] : NO_SNAPSHOT;
    const c = resnapshot(p, live[keys[i]]);
    if (!changed && !Object.is(c, p)) { changed = true; out = pv.slice(); }
    if (changed) out[i] = c;
  }
  return changed ? new ObjNode(keyed ? pk : keys, out) : prev;
}

/**
 * A snapshot of `live` that later mutation of `live` (or of the arrays it holds) cannot change, sharing every subtree
 * of `prev` (a previous snapshot, or NO_SNAPSHOT) that still matches. Returns `prev` itself iff `live` still equals the
 * state `prev` was taken from.
 */
export function resnapshot(prev         , live         )          {
  if (!isObject(live)) {
    if (typeof live === 'function') return FN;
    // primitives are their own snapshot; NaN equals NaN as in JSON
    return prev === live || (typeof live === 'number' && typeof prev === 'number' && Number.isNaN(live) && Number.isNaN(prev)) ? prev : live;
  }
  if (Array.isArray(live)) return resnapArray(prev, live);
  if (ArrayBuffer.isView(live)) {
    if (live instanceof DataView) return jsonLeaf(prev, live);
    const proto          = Object.getPrototypeOf(live), b = bytesOf(live);
    return prev instanceof BytesLeaf && prev.proto === proto && sameBytes(prev.bytes, b) ? prev : new BytesLeaf(proto, b.slice());
  }
  if (isPlainObject(live)) return resnapObject(prev, live);
  return jsonLeaf(prev, live);
}

function jsonLeaf(prev         , live        )          {
  const json = JSON.stringify(live);
  return prev instanceof JsonLeaf && prev.json === json ? prev : new JsonLeaf(json);
}

/** A copy of `v` that later mutation of `v` (or of the arrays it holds) cannot change. */
export const snapshot = (v         )          => resnapshot(NO_SNAPSHOT, v);

/** Whether `live` still equals the state `snap` was taken from. */
export const sameSpec = (snap         , live         )          => Object.is(resnapshot(snap, live), snap);
