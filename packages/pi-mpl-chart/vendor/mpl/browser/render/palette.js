// Palette quantization for indexed PNG output (color type 3). Deterministic: the same canvas and color budget always
// give the same palette and indices, so output is reproducible and testable.
//
// A figure with at most `max` distinct RGBA colors gets them all: exact, lossless. Otherwise the palette is weighted
// k-means over the color histogram, with the frequent colors pinned (backgrounds, lines, text stay exact; only
// antialiased edge pixels move), seeded by weighted farthest-point. Measured on 39 fixtures against top-K, median cut
// and "figure colors plus their blends": k-means had the best PSNR at 256, 64 and 32 colors (median 71.6 / 59.9 / 53.4
// dB) and the smallest worst-case error; file sizes were within about 1% of each other.
                                              
import { BLOCK, BLOCK_SHIFT } from './agg/canvas.js';

/** Palette entries as RGBA bytes (4 per entry), and one palette index per pixel, row-major. */
                                                                                                          

/** A color that covers at least this fraction of the pixels keeps its exact value (when the budget allows). */
const PIN = 0.0005;
const ITERATIONS = 10;
/** k-means runs over at most this many of the most frequent colors; the rest are mapped afterwards. */
const SAMPLE = 8192;

// the canvas stores native-endian Uint32 pixels; these views turn one into its four bytes and back
const one = new Uint32Array(1), bytes = new Uint8Array(one.buffer);
const channels = (v        , out              , o        )       => { one[0] = v; out[o] = bytes[0]; out[o + 1] = bytes[1]; out[o + 2] = bytes[2]; out[o + 3] = bytes[3]; };

/** Distinct colors and their pixel counts, most frequent first (ties by value), using the canvas' uniform blocks. */
function histogram(c        )                                                                  {
  const m = new Map                ();
  const add = (v        , n        )       => { const p = m.get(v); m.set(v, typeof p === 'number' ? p + n : n); };
  for (let y = 0; y < c.h; y++) {
    for (let j = 0; j < c.nb; j++) {
      const bi = y * c.nb + j, x0 = j << BLOCK_SHIFT, x1 = Math.min(x0 + BLOCK, c.w);
      if (c.mix[bi] === 0) { add(c.blk[bi], x1 - x0); continue; }
      // a mixed block still repeats its left neighbour most of the time: count runs, not pixels
      let run = c.u32[y * c.w + x0], len = 0;
      for (let x = x0; x < x1; x++) { const v = c.u32[y * c.w + x]; if (v === run) len++; else { add(run, len); run = v; len = 1; } }
      add(run, len);
    }
  }
  const e = [...m].toSorted((a, b) => b[1] - a[1] || a[0] - b[0]);
  return { colors: Uint32Array.from(e, (x) => x[0]), counts: Float64Array.from(e, (x) => x[1]) };
}

/** Squared RGBA distance between color i of `a` (stride 4) and centroid j of `b`. */
const dist2 = (a              , i        , b              , j        )         => {
  const dr = a[i] - b[j], dg = a[i + 1] - b[j + 1], db = a[i + 2] - b[j + 2], da = a[i + 3] - b[j + 3];
  return dr * dr + dg * dg + db * db + da * da;
};
/** Index of the nearest of k centroids (the lowest index on a tie). */
function nearest(a              , i        , cent              , k        )         {
  let best = 0, bd = Infinity;
  for (let j = 0; j < k; j++) { const d = dist2(a, i, cent, 4 * j); if (d < bd) { bd = d; best = j; } }
  return best;
}

/** Weighted k-means palette of at most k colors over a histogram (colors as RGBA in `ch`, stride 4). */
function kmeans(ch              , counts              , n        , total        , k        )               {
  const cent = new Float64Array(4 * k);
  // pinned: the frequent colors, exactly
  let pinned = 0;
  while (pinned < k && pinned < n && counts[pinned] >= PIN * total) { cent.set(ch.subarray(4 * pinned, 4 * pinned + 4), 4 * pinned); pinned++; }
  // seeds: weighted farthest point from every centroid so far (ties keep the more frequent color)
  let m = pinned;
  const d = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) d[i] = Math.min(d[i], dist2(ch, 4 * i, cent, 4 * j));
  while (m < k) {
    let bi = -1, bs = 0;
    for (let i = 0; i < n; i++) { const s = d[i] * counts[i]; if (s > bs) { bs = s; bi = i; } }
    if (bi < 0) break;   // every color already sits on a centroid
    cent.set(ch.subarray(4 * bi, 4 * bi + 4), 4 * m);
    for (let i = 0; i < n; i++) d[i] = Math.min(d[i], dist2(ch, 4 * i, cent, 4 * m));
    m++;
  }
  // Lloyd iterations on the free centroids, each rounded to bytes so the palette is what pixels are compared with
  const acc = new Float64Array(5 * m);
  for (let it = 0; it < ITERATIONS; it++) {
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const j = nearest(ch, 4 * i, cent, m), w = counts[i];
      for (let q = 0; q < 4; q++) acc[5 * j + q] += w * ch[4 * i + q];
      acc[5 * j + 4] += w;
    }
    let moved = false;
    for (let j = pinned; j < m; j++) {
      const w = acc[5 * j + 4];
      if (w === 0) continue;
      for (let q = 0; q < 4; q++) { const v = Math.round(acc[5 * j + q] / w); if (v !== cent[4 * j + q]) { cent[4 * j + q] = v; moved = true; } }
    }
    if (!moved) break;
  }
  return cent.subarray(0, 4 * m);
}

/**
 * The canvas as palette indices with at most `max` (1..256) entries. Exact when the canvas has that few colors;
 * otherwise quantized as described above. Entries are ordered most frequent first.
 */
export function quantize(c        , max        )          {
  if (!Number.isInteger(max) || max < 1 || max > 256) throw new RangeError(`colors must be an integer in 1..256 (a PNG palette's limit), got ${max}`);
  const { colors, counts } = histogram(c);
  const n = colors.length, total = c.w * c.h;
  const ch = new Float64Array(4 * n);
  for (let i = 0; i < n; i++) channels(colors[i], ch, 4 * i);
  const ns = Math.min(n, SAMPLE);
  const cent = n <= max ? ch : kmeans(ch.subarray(0, 4 * ns), counts, ns, total, max);
  const k = cent.length / 4;
  // every distinct color to its nearest entry, then usage counts to order entries by frequency
  const assign = new Uint16Array(n), use = new Float64Array(k);
  for (let i = 0; i < n; i++) { const j = n <= max ? i : nearest(ch, 4 * i, cent, k); assign[i] = j; use[j] += counts[i]; }
  const order = Array.from({ length: k }, (_, j) => j).filter((j) => use[j] > 0)
    .toSorted((a, b) => use[b] - use[a] || a - b);
  const rank = new Uint16Array(k);
  order.forEach((j, r) => { rank[j] = r; });
  const palette = new Uint8Array(4 * order.length);
  order.forEach((j, r) => { for (let q = 0; q < 4; q++) palette[4 * r + q] = cent[4 * j + q]; });
  const lookup = new Map                ();
  for (let i = 0; i < n; i++) lookup.set(colors[i], rank[assign[i]]);
  const at = (v        )         => { const r = lookup.get(v); if (typeof r !== 'number') throw new Error('palette: pixel color missing from the histogram'); return r; };
  const index = new Uint8Array(total);
  for (let y = 0; y < c.h; y++) {
    for (let j = 0; j < c.nb; j++) {
      const bi = y * c.nb + j, x0 = j << BLOCK_SHIFT, x1 = Math.min(x0 + BLOCK, c.w), o = y * c.w;
      if (c.mix[bi] === 0) { index.fill(at(c.blk[bi]), o + x0, o + x1); continue; }
      let last = c.u32[o + x0], r = at(last);
      for (let x = x0; x < x1; x++) { const v = c.u32[o + x]; if (v !== last) { last = v; r = at(v); } index[o + x] = r; }
    }
  }
  return { palette, size: order.length, index };
}
