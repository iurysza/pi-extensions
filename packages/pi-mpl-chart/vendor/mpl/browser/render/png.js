// PNG encoder for an RGBA8 canvas, no dependencies.
//   pngStream  — ReadableStream: signature + IHDR, then one IDAT per chunk that the
//                platform's CompressionStream('deflate') yields, then IEND. Rows are
//                filtered and fed in bands, so memory stays O(band) beyond the canvas.
//                (Platform zlib — not byte-identical to encodePNGSync.)
//   encodePNG  — the stream, collected.
//   encodePNGSync — synchronous custom deflate, **single IDAT** (byte-stable). Same zlib
//                   stream as pngStreamSync; one chunk so SVG-embedded PNGs and toPNGSync
//                   stay sha256-stable across the streaming encoder change. Peak is the
//                   full file (materialized); see pngPeakBytes for the streaming bound.
//   pngStreamSync — pull-based ReadableStream: multi-IDAT, ≤ one IDAT retained; advances
//                   only on pull (real backpressure). Workers use this. Concat of IDAT
//                   payloads == encodePNGSync's single IDAT payload (zlib-identical).

// Each takes a PngOptions: colors none writes 8-bit RGBA (color type 6); colors n writes a palette PNG (color type 3)
// of at most n entries, exact when the figure has that few colors (palette.ts), packed at the smallest bit depth.
                                              
import { BLOCK, BLOCK_SHIFT } from './agg/canvas.js';
                                            
import { quantize } from './palette.js';
                                               
import { none, some } from '../core/types.js';
import { tracer } from '../trace.js';

/** colors: the palette budget (1..256), or none for full RGBA. */
                                                             
/** encodePNGSync also takes the built-in deflate's level (1..9); none keeps the default chart-tuned encoder. */
                                                                             
export const RGBA                 = { colors: none, level: none };

/**
 * How hard the built-in deflate searches, as zlib's configuration_table: greedy (deflate_fast) or lazy (deflate_slow)
 * matching; `chain` hash candidates at most, a quarter of them once the previous match reaches `good`; no chain search
 * once the left or upper match reaches `nice`, and the chain search stops at a `stop` match; lazy matching does not
 * look past a match of `maxLazy`. Levels 1..9 take zlib's values (nice = stop; the greedy levels keep this tokenizer's
 * insertion policy rather than max_insert_length). The default (no level) searches 4
 * candidates only below 16 and keeps the longest, which the chart-tuned encoders were measured with.
 * Measured on 23 fixtures against the default (RGBA / 64 colours): level 6 is 7.5% / 5.1% smaller at 3x / 1.2x the
 * time, level 9 9.5% / 8.2% at 12x / 5x, within about 1% of zlib -9.
 */
                                                                                                                                                                       
const FAST         = { lazy: false, chain: 4, good: 258, nice: 16, stop: 258, maxLazy: 258 };
const zl = (lazy         , good        , maxLazy        , nice        , chain        )         => ({ lazy, chain, good, nice, stop: nice, maxLazy });
const LEVELS                    = [FAST, zl(false, 4, 4, 8, 4), zl(false, 4, 5, 16, 8), zl(false, 4, 6, 32, 32),
  zl(true, 4, 4, 16, 16), zl(true, 8, 16, 32, 32), zl(true, 8, 16, 128, 128), zl(true, 8, 32, 128, 256), zl(true, 32, 128, 258, 1024), zl(true, 32, 258, 258, 4096)];
/** zlib's 1..9 scale; anything else is an error. */
export function effortOf(level        )         {
  if (!Number.isInteger(level) || level < 1 || level > 9) throw new RangeError(`level must be an integer in 1..9, got ${level}`);
  return LEVELS[level];
}

// ------------------------------------------------------------------ CRC-32, Adler-32
// Slicing-by-4: CRC4[k·256 + v] is the CRC register after byte v followed by k zero bytes. Int32 entries keep
// the XORs in V8's int32 representation (the bits are the same as unsigned).
const CRC4 = new Int32Array(4 * 256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC4[n] = c;
}
for (let n = 0; n < 256; n++) for (let k = 1; k < 4; k++) CRC4[k * 256 + n] = CRC4[(CRC4[(k - 1) * 256 + n] & 0xff)] ^ (CRC4[(k - 1) * 256 + n] >>> 8);
/** CRC-32 register after the bytes of p, from c0 (−1 to start; crcDone finishes). */
function crc32(p            , c0 = -1)         {
  let c = c0;
  const n = p.length, n4 = n - (n & 3);
  let i = 0;
  for (; i < n4; i += 4) {
    c ^= p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24);
    c = CRC4[768 + (c & 0xff)] ^ CRC4[512 + ((c >>> 8) & 0xff)] ^ CRC4[256 + ((c >>> 16) & 0xff)] ^ CRC4[c >>> 24];
  }
  for (; i < n; i++) c = CRC4[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return c;
}
const crcDone = (c        )         => (c ^ -1) >>> 0;
/**
 * Chunks of 2048 keep b < 2^31 (b ≤ 65520 + 2048·(65520 + 255·2048) ≈ 1.2e9), so the sums stay
 * in V8's int32 representation (`| 0`). Measured on 11 MB: 16.9 ms → 12.8 ms, same checksum.
 */
function adler32(a0        , d            )         {
  let a = a0 & 0xffff, b = a0 >>> 16;
  for (let i = 0; i < d.length;) {
    const end = Math.min(i + 2048, d.length);
    for (; i < end; i++) { a = (a + d[i]) | 0; b = (b + a) | 0; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (v        )             => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const ascii = (s        )             => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function chunk(type        , data            )             {
  const t = ascii(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0); out.set(t, 4); out.set(data, 8);
  out.set(u32(crcDone(crc32(data, crc32(t)))), 8 + data.length);
  return out;
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** pHYs: pixels per metre, so viewers and print pipelines know the physical size (matplotlib writes it too). */
function phys(dpi        )             {
  if (!(dpi > 0)) return new Uint8Array(0);
  const ppm = Math.round(dpi / 0.0254), d = new Uint8Array(9);
  d.set(u32(ppm), 0); d.set(u32(ppm), 4); d[8] = 1;
  return chunk('pHYs', d);
}
function header(w        , h        , dpi        )             {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA, deflate, adaptive, no interlace
  return concat([SIGNATURE, chunk('IHDR', ihdr), phys(dpi)]);
}

// ------------------------------------------------------------------ palette (color type 3)
/** The smallest PNG bit depth that holds `size` indices. Measured on the fixtures (zlib 6): 4-bit is 13% smaller
 *  than 8-bit at 16 colors, 2-bit 28% at 4. */
const bitDepth = (size        )         => (size <= 2 ? 1 : size <= 4 ? 2 : size <= 16 ? 4 : 8);
/** IHDR (color type 3), PLTE, tRNS when an entry is translucent (alphas up to the last one below 255), pHYs. */
function headerIndexed(w        , h        , dpi        , ix         )             {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
  ihdr[8] = bitDepth(ix.size); ihdr[9] = 3;
  const plte = new Uint8Array(3 * ix.size), alpha = new Uint8Array(ix.size);
  let lastTranslucent = -1;
  for (let i = 0; i < ix.size; i++) {
    plte[3 * i] = ix.palette[4 * i]; plte[3 * i + 1] = ix.palette[4 * i + 1]; plte[3 * i + 2] = ix.palette[4 * i + 2];
    alpha[i] = ix.palette[4 * i + 3];
    if (alpha[i] !== 255) lastTranslucent = i;
  }
  const trns = lastTranslucent >= 0 ? chunk('tRNS', alpha.subarray(0, lastTranslucent + 1)) : new Uint8Array(0);
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte), trns, phys(dpi)]);
}
/** Rows [y0, y1) of packed indices (most significant bits first), each led by filter byte 0. None is also the best
 *  filter for indexed charts: Sub, Up, Paeth and adaptive were 3 to 22% larger on the fixtures. */
function indexedBand(ix         , w        , y0        , y1        )                          {
  const bits = bitDepth(ix.size), per = 8 / bits, stride = Math.ceil(w / per), S = stride + 1;
  const out = new Uint8Array((y1 - y0) * S);
  for (let y = y0; y < y1; y++) {
    const src = y * w, dst = (y - y0) * S + 1;
    if (bits === 8) { out.set(ix.index.subarray(src, src + w), dst); continue; }
    for (let x = 0; x < w; x++) out[dst + Math.floor(x / per)] |= ix.index[src + x] << (8 - bits * (1 + (x % per)));
  }
  return out;
}
const indexedStride = (ix         , w        )         => Math.ceil(w / (8 / bitDepth(ix.size))) + 1;
const IEND = chunk('IEND', new Uint8Array(0));

// ------------------------------------------------------------------ filtering
/**
 * Rows [y0, y1) with filter type 0 (None). Measured on the fixtures with zlib level 6:
 * None 181.8 KB < adaptive min-sum-abs 200.3 KB < Up 203.5 KB < Paeth 208.3 KB. Charts
 * are flat color with anti-aliased edges; prediction turns those edges into noise that
 * LZ77 can't match, and None also costs nothing to compute.
 */
export function filteredBand(c        , y0        , y1        )                          {
  const stride = c.w * 4;
  const out = new Uint8Array((y1 - y0) * (stride + 1));
  for (let y = y0; y < y1; y++) out.set(c.px.subarray(y * stride, (y + 1) * stride), (y - y0) * (stride + 1) + 1);
  return out;
}

// ------------------------------------------------------------------ streaming encoder
const BAND = 64;

/** PNG as a byte stream. Uses the platform's zlib (CompressionStream 'deflate' = RFC 1950). */
export function pngStream(c        , opts             = RGBA)                             {
  const ix                  = opts.colors.kind === 'some' ? { kind: 'some', value: quantize(c, opts.colors.value) } : none;
  const head = ix.kind === 'some' ? headerIndexed(c.w, c.h, c.dpi, ix.value) : header(c.w, c.h, c.dpi);
  const band = (y0        , y1        )                          => (ix.kind === 'some' ? indexedBand(ix.value, c.w, y0, y1) : filteredBand(c, y0, y1));
  const z = new CompressionStream('deflate');
  const writer = z.writable.getWriter();
  void (async () => {
    // sequential on purpose: backpressure, one band in flight
    for (let y = 0; y < c.h; y += BAND) {
      // oxlint-disable-next-line no-await-in-loop
      await writer.ready;
      // oxlint-disable-next-line no-await-in-loop
      await writer.write(band(y, Math.min(y + BAND, c.h)));
    }
    await writer.close();
  })();
  const reader = z.readable.getReader();
  let state                           = 'head';
  return new ReadableStream            ({
    async pull(ctl) {
      switch (state) {
        case 'head': ctl.enqueue(head); state = 'body'; return;
        case 'body': {
          const r = await reader.read();
          if (r.done) { ctl.enqueue(IEND); state = 'done'; ctl.close(); return; }
          if (r.value.length > 0) ctl.enqueue(chunk('IDAT', r.value));
          return;
        }
        case 'done': ctl.close(); return;
        default: throw new Error('unreachable');
      }
    },
  });
}

export async function encodePNG(c        , opts             = RGBA)                      {
  const parts               = [];
  const r = pngStream(c, opts).getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const x = await r.read();
    if (x.done) break;
    parts.push(x.value);
  }
  return concat(parts);
}

function concat(parts                       )             {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ synchronous zlib
// A deflate tuned for chart images. Two observations drive it:
//   1. most bytes repeat the pixel to the left (distance 4) or the row above (distance
//      stride + 1, counting the filter byte), so those two candidates are tried first;
//   2. what remains (anti-aliased edges, glyphs) is short-range, so a 4-deep hash chain
//      is enough.
// Tokens are then coded per block with dynamic Huffman tables (RFC 1951 §3.2.7).
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LSYM = new Uint8Array(259);
for (let s = 0; s < 29; s++) for (let l = LBASE[s]; l < (s < 28 ? LBASE[s + 1] : 259); l++) LSYM[l] = s;
const DSYM = new Uint8Array(32769);                   // distance → symbol, O(1)
for (let s = 0; s < 30; s++) DSYM.fill(s, DBASE[s], s < 29 ? DBASE[s + 1] : 32769);
const rev = (code        , len        )         => { let r = 0; for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; } return r; };

/**
 * Max zlib bytes retained for one Huffman block before it is wrapped as an IDAT.
 * writeBlock reserves (nTok·6+8) bytes; that is the hard ceiling for one Huffman block.
 */
export const PNG_IDAT_PAYLOAD_MAX         = (1 << 16) * 6 + 256;  // writeBlock reserve: TOK_BLOCK·6+8

/** Reused across encodes: fixed cap so the bit writer never holds more than one IDAT payload. */
const BITS_BUF = new Uint8Array(PNG_IDAT_PAYLOAD_MAX);
class Bits {
  buf = BITS_BUF; n = 0; acc = 0; cnt = 0;
  /** Instrumentation: high-water mark of complete bytes held (tests). */
  retainedHigh = 0;
  reset()       { this.buf = BITS_BUF; this.n = 0; this.acc = 0; this.cnt = 0; this.retainedHigh = 0; }
  put(v        , len        )       {
    this.acc |= v << this.cnt; this.cnt += len;
    while (this.cnt >= 8) {
      if (this.n >= this.buf.length) throw new RangeError(`PNG bit writer exceeded PNG_IDAT_PAYLOAD_MAX (${PNG_IDAT_PAYLOAD_MAX})`);
      this.buf[this.n++] = this.acc & 255; this.acc >>>= 8; this.cnt -= 8;
    }
    if (this.n > this.retainedHigh) this.retainedHigh = this.n;
  }
  reserve(bytes        )       {
    if (this.n + bytes > this.buf.length) throw new RangeError(`PNG bit writer reserve ${this.n + bytes} > PNG_IDAT_PAYLOAD_MAX`);
  }
  /** Copy out complete bytes and compact; bit accumulator unchanged. */
  takeBytes()             {
    const out = this.buf.slice(0, this.n);
    this.n = 0;
    return out;
  }
  /**
   * Build one IDAT chunk directly from the bit buffer (single allocation: no intermediate
   * payload copy). Compacts the writer afterward; bit accumulator unchanged.
   */
  takeIdatChunk()             {
    const n = this.n;
    const out = new Uint8Array(12 + n);
    out[0] = (n >>> 24) & 255; out[1] = (n >>> 16) & 255; out[2] = (n >>> 8) & 255; out[3] = n & 255;
    out[4] = 73; out[5] = 68; out[6] = 65; out[7] = 84; // IDAT
    out.set(this.buf.subarray(0, n), 8);
    const crc = crcDone(crc32(out.subarray(4, 8 + n)));
    out[8 + n] = (crc >>> 24) & 255; out[9 + n] = (crc >>> 16) & 255;
    out[10 + n] = (crc >>> 8) & 255; out[11 + n] = crc & 255;
    this.n = 0;
    return out;
  }
  flush()             {
    if (this.cnt > 0) this.put(0, 8 - this.cnt);
    return this.takeBytes();
  }
}
const BITS = new Bits();

/** Scratch for codeLengths: typed so unoptimized tiers do not box heap nodes. Sized for 286+285 internals. */
const CL_F = new Float64Array(286), CL_W = new Float64Array(600), CL_P = new Int32Array(600), CL_H = new Int32Array(600), CL_USED = new Int32Array(286);
const CL_OUT_A = new Uint8Array(286), CL_OUT_B = new Uint8Array(286), CL_OUT_CF = new Uint8Array(19);
let CL_FLIP = 0;
/** codeLengths' binary min-heap of node ids in CL_H[0, CL_HS), ordered by CL_W then id (module functions, not
 *  closures per call, so their feedback and optimized code carry over between blocks and encodes). */
let CL_HS = 0;
const clLess = (a        , b        )          => CL_W[a] < CL_W[b] || (CL_W[a] === CL_W[b] && a < b);
function clPush(x        )       {
  const heap = CL_H;
  let i = CL_HS++; heap[i] = x;
  while (i > 0) { const p = (i - 1) >> 1; if (!clLess(heap[i], heap[p])) break; const t = heap[i]; heap[i] = heap[p]; heap[p] = t; i = p; }
}
function clPop()         {
  const heap = CL_H, top = heap[0], hs = --CL_HS, last = heap[hs];
  if (hs > 0) {
    heap[0] = last; let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < hs && clLess(heap[l], heap[m])) m = l;
      if (r < hs && clLess(heap[r], heap[m])) m = r;
      if (m === i) break;
      const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m;
    }
  }
  return top;
}
/** Length-limited Huffman code lengths: plain Huffman, frequencies flattened until it fits.
 *  Alternates A/B so writeBlock can keep ll and dl; pass `into` for a third concurrent result (cf). */
function codeLengths(freq             , limit        , into                    )             {
  const n = freq.length;
  let out            ;
  if (into.kind === 'some') out = into.value.subarray(0, n);
  else if (n <= 286) { CL_FLIP ^= 1; out = (CL_FLIP !== 0 ? CL_OUT_A : CL_OUT_B).subarray(0, n); }
  else out = new Uint8Array(n);
  const f = n <= CL_F.length ? CL_F.subarray(0, n) : new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = freq[i];
  const weight = CL_W, parent = CL_P, used = CL_USED;
  for (;;) {
    let nu = 0;
    for (let i = 0; i < n; i++) if (f[i] > 0) used[nu++] = i;
    out.fill(0);
    if (nu === 0) return out;
    if (nu === 1) { out[used[0]] = 1; return out; }
    CL_HS = 0;
    for (let k = 0; k < nu; k++) { const i = used[k]; weight[i] = f[i]; parent[i] = -1; clPush(i); }
    let next = n;
    while (CL_HS > 1) { const a = clPop(), b = clPop(); weight[next] = weight[a] + weight[b]; parent[next] = -1; parent[a] = next; parent[b] = next; clPush(next); next++; }
    let max = 0;
    for (let k = 0; k < nu; k++) {
      const i = used[k]; let d = 0;
      for (let p = i; parent[p] !== -1; p = parent[p]) d++;
      out[i] = d; if (d > max) max = d;
    }
    if (max <= limit) return out;
    for (let k = 0; k < nu; k++) { const i = used[k]; f[i] = Math.floor(f[i] / 2) + 1; }
  }
}

/** Canonical codes (bit-reversed for an LSB-first writer) from lengths. */
function canonical(lens            )              {
  const count = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(lens.length);
  for (const l of lens) count[l]++;
  count[0] = 0;
  let code = 0;
  for (let b = 1; b < 16; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
  for (let i = 0; i < lens.length; i++) if (lens[i] > 0) codes[i] = rev(next[lens[i]]++, lens[i]);
  return codes;
}

/**
 * Tokens: literal v (< 256), or match: 256 + (len << 16 | dist), stored as one Int32. At each byte the longest match
 * over the previous pixel (`left` bytes back: 4 for RGBA, 1 for palette indices), the row above and up to
 * `effort.chain` hash candidates. Greedy (zlib's deflate_fast) takes it and searches the chain only for a short one;
 * lazy (deflate_slow) emits it only if the next byte does not start a longer match, else a literal.
 */
function tokenize(d            , rowDist        , left        , effort        )                                                   {
  const WIN = 32768, HBITS = 15, HMASK = (1 << HBITS) - 1;
  const head = new Int32Array(1 << HBITS).fill(-1), prev = new Int32Array(WIN);
  const tok = new Int32Array(d.length + 1);
  let n = 0;
  const len = d.length;
  const hash = (i        )         => ((d[i] * 506832829 + d[i + 1] * 1103515245 + d[i + 2] * 12345) >>> 17) & HMASK;
  const insert = (i        )       => { if (i + 2 < len) { const h = hash(i); prev[i & (WIN - 1)] = head[h]; head[h] = i; } };
  const matchLen = (i        , j        , max        )         => { let l = 0; while (l < max && d[i + l] === d[j + l]) l++; return l; };
  let best = 0, dist = 0;
  const find = (i        , prevLen        )       => {
    const max = Math.min(258, len - i);
    best = 0; dist = 0;
    if (max < 3) return;
    if (i >= left) { const l = matchLen(i, i - left, max); if (l > best) { best = l; dist = left; } }
    if (best < max && rowDist > left && i >= rowDist) { const l = matchLen(i, i - rowDist, max); if (l > best) { best = l; dist = rowDist; } }
    if (best >= Math.min(max, effort.nice)) return;
    let j = head[hash(i)], chain = prevLen >= effort.good ? effort.chain >> 2 : effort.chain;
    while (j >= 0 && i - j <= WIN && chain-- > 0) {
      if (d[j + best] === d[i + best]) { const l = matchLen(i, j, max); if (l > best) { best = l; dist = i - j; if (l >= Math.min(max, effort.stop)) break; } }
      const pj = prev[j & (WIN - 1)];
      if (pj >= j) break;
      j = pj;
    }
  };
  let i = 0;
  if (!effort.lazy) {
    while (i < len) {
      find(i, 0);
      if (best >= 3) {
        tok[n++] = 256 + ((best << 16) | dist);
        insert(i);
        if (best <= 16) for (let k = 1; k < best; k++) insert(i + k);
        else { insert(i + best - 2); insert(i + best - 1); }
        i += best;
      } else {
        tok[n++] = d[i];
        insert(i);
        i++;
      }
    }
    return { tok, n };
  }
  let prevLen = 0, prevDist = 0, pending = false;
  while (i < len) {
    // past a match of maxLazy there is no look for a longer one (deflate_slow's max_lazy_match)
    if (pending && prevLen >= effort.maxLazy) { best = 0; dist = 0; } else find(i, pending ? prevLen : 0);
    if (pending && prevLen >= 3 && prevLen >= best) {
      // the match that started one byte back is at least as long: take it
      tok[n++] = 256 + ((prevLen << 16) | prevDist);
      const end = i - 1 + prevLen;
      for (let k = i; k < end; k++) insert(k);
      i = end; pending = false;
      continue;
    }
    if (pending) tok[n++] = d[i - 1];   // the byte before stays a literal: the match here may be longer
    insert(i);
    prevLen = best; prevDist = dist; pending = true;
    i++;
  }
  if (pending) tok[n++] = prevLen >= 3 ? 256 + ((prevLen << 16) | prevDist) : d[len - 1];
  return { tok, n };
}

const WB_LF = new Uint32Array(286), WB_DF = new Uint32Array(30), WB_CF = new Uint32Array(19);
const WB_SEQ = new Uint8Array(316), WB_CL = new Uint8Array(316), WB_CE = new Uint8Array(316);
/** One dynamic-Huffman block over tokens [a, b). */
function writeBlock(bw      , tok            , a        , b        , last         )       {
  const lf = WB_LF, df = WB_DF;
  lf.fill(0); df.fill(0);
  countTokens(tok, a, b);
  lf[256] = 1;
  let anyD = false; for (let i = 0; i < 30; i++) if (df[i] !== 0) { anyD = true; break; }
  if (!anyD) df[0] = 1;
  const ll = codeLengths(lf, 15, none), dl = codeLengths(df, 15, none);
  let hlit = 286; while (hlit > 257 && ll[hlit - 1] === 0) hlit--;
  let hdist = 30; while (hdist > 1 && dl[hdist - 1] === 0) hdist--;
  const seq = WB_SEQ, seqN = hlit + hdist;
  seq.set(ll.subarray(0, hlit), 0); seq.set(dl.subarray(0, hdist), hlit);
  const cl = WB_CL, ce = WB_CE; let cn = 0;
  for (let i = 0; i < seqN;) {
    const v = seq[i];
    let r = 1; while (i + r < seqN && seq[i + r] === v) r++;
    if (v === 0 && r >= 3) { const k = Math.min(r, 138); if (k >= 11) { cl[cn] = 18; ce[cn++] = k - 11; } else { cl[cn] = 17; ce[cn++] = k - 3; } i += k; continue; }
    if (v !== 0 && r >= 4) { cl[cn] = v; ce[cn++] = 0; const k = Math.min(r - 1, 6); cl[cn] = 16; ce[cn++] = k - 3; i += k + 1; continue; }
    cl[cn] = v; ce[cn++] = 0; i++;
  }
  const cf = WB_CF; cf.fill(0);
  for (let i = 0; i < cn; i++) cf[cl[i]]++;
  const cll = codeLengths(cf, 7, some(CL_OUT_CF)), clc = canonical(cll);
  let hclen = 19; while (hclen > 4 && cll[CL_ORDER[hclen - 1]] === 0) hclen--;
  bw.put(last ? 1 : 0, 1); bw.put(2, 2);
  bw.put(hlit - 257, 5); bw.put(hdist - 1, 5); bw.put(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) bw.put(cll[CL_ORDER[k]], 3);
  for (let k = 0; k < cn; k++) {
    bw.put(clc[cl[k]], cll[cl[k]]);
    if (cl[k] === 16) bw.put(ce[k], 2); else if (cl[k] === 17) bw.put(ce[k], 3); else if (cl[k] === 18) bw.put(ce[k], 7);
  }
  const lc = canonical(ll), dc = canonical(dl);
  bw.reserve((b - a) * 6 + 8);
  emitTokens(bw, tok, a, b, ll, lc, dl, dc);
  bw.put(lc[256], ll[256]);
}

/** Literal/length and distance frequencies of tokens [a, b) into WB_LF and WB_DF. */
function countTokens(tok            , a        , b        )       {
  const lf = WB_LF, df = WB_DF;
  for (let k = a; k < b; k++) {
    const t = tok[k];
    if (t < 256) lf[t]++;
    else { const m = t - 256, l = m >>> 16, dd = m & 0xffff; lf[257 + LSYM[l]]++; df[DSYM[dd]]++; }
  }
}

/** Tokens [a, b) Huffman-coded into the bit writer (space reserved by the caller). */
function emitTokens(bw      , tok            , a        , b        , ll            , lc             , dl            , dc             )       {
  const buf = bw.buf;
  let acc = bw.acc, cnt = bw.cnt, o = bw.n;
  for (let k = a; k < b; k++) {
    const t = tok[k];
    if (t < 256) { acc |= lc[t] << cnt; cnt += ll[t]; }
    else {
      const m = t - 256, l = m >>> 16, dd = m & 0xffff, s = LSYM[l], ds = DSYM[dd];
      acc |= lc[257 + s] << cnt; cnt += ll[257 + s];
      if (LEXT[s] > 0) { acc |= (l - LBASE[s]) << cnt; cnt += LEXT[s]; }
      while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; }
      acc |= dc[ds] << cnt; cnt += dl[ds];
      if (DEXT[ds] > 0) { while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; } acc |= (dd - DBASE[ds]) << cnt; cnt += DEXT[ds]; }
    }
    while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; }
  }
  bw.acc = acc; bw.cnt = cnt; bw.n = o;
}

/** Token stream → zlib (RFC 1950): header, dynamic blocks of 2^16 tokens, Adler-32 trailer. */
function zlibFrom(tok            , n        , adler        )             {
  const bw = BITS; bw.reset();
  bw.put(0x78, 8); bw.put(0x9c, 8);
  const PER = 1 << 16;                                             // tokens per Huffman block
  if (n === 0) { bw.put(1, 1); bw.put(1, 2); bw.put(0, 7); }      // empty: one fixed block holding only end-of-block
  for (let a = 0; a < n; a += PER) writeBlock(bw, tok, a, Math.min(n, a + PER), a + PER >= n);
  const body = bw.flush();
  const out = new Uint8Array(body.length + 4);
  out.set(body, 0); out.set(u32(adler), body.length);
  return out;
}

/**
 * zlib stream (RFC 1950) of `d`. `rowDist` is the byte distance to the same byte one row up
 * (pass 0 for generic data).
 */
export function zlibSync(d            , rowDist = 0, left = 4, effort         = FAST)             {
  const { tok, n } = tokenize(d, rowDist, left, effort);
  return zlibFrom(tok, n, adler32(1, d));
}

// ------------------------------------------------------------------ PNG-aware LZ77
// The PNG byte stream is rows of [filter 0][w RGBA pixels]. The tokenizer reads the canvas
// directly (no filtered copy) and leans on its block state (see Canvas): per row it builds the
// intervals where a pixel equals its left neighbour and where it equals the pixel above, reading
// pixels only inside mixed blocks. A uniform block costs O(1). A match against the left pixel
// (stream distance 4) or the row above (4w + 1) is then a lookup in those intervals plus at most
// three bytes at either end, since the byte cursor may sit mid-pixel. Anything else (glyphs, marker
// stamps) goes to a 4-deep hash chain over pixels. Tokens are chosen per ≤ 258 bytes, as in zlib,
// so a tie between left (no extra distance bits) and above (12 extra bits) goes left. Matches stay
// within a row, so canvas and stream distances agree. Adler-32 is computed from the same
// intervals: a run of L identical pixels (bytes x0..x3, s = Σx, t = 4x0 + 3x1 + 2x2 + x3) adds
// L·s to a and 4aL + L·t + 2sL(L − 1) to b, so flat runs cost O(1) there too.

const PIX_RING = 1 << 14;   // ≥ 8192 px: the farthest pixel a 32 KiB byte window can reach
const ADLER = 65521;
/** v mod 65521 for an integer 0 ≤ v < 2^53, as v % ADLER. V8's `%` on a double (here past 2^31) is a call into
 *  fmod; the quotient's floor is exact here up to one off (the division rounds), and the fix-ups correct that.
 *  `| 0` (exact: the residue is < 65521) hands back a Smi, so unoptimized code does not box the result. */
const modA = (v        )         => {
  const r = v - Math.floor(v / ADLER) * ADLER;
  return (r < 0 ? r + ADLER : r >= ADLER ? r - ADLER : r) | 0;
};
/** Singles between Adler reductions. From a, b < 65521, with sum ≤ 1020 and t ≤ 2550 per pixel, after 512 singles
 *  a < 0.59e6 and b < 6.7e8: both stay Smis (< 2^30), so unoptimized tiers never box them as HeapNumbers. */
const ADLER_SINGLES = 512;

/**
 * Tokens per dynamic-Huffman block — same as zlibFrom's PER. Two buffers of this size are retained
 * (active + one held-back full block) so BFINAL lands on the same block as the historical whole-buffer path.
 * Peak token scratch: `2 · TOK_BLOCK · 4` bytes, independent of w·h.
 */
export const TOK_BLOCK         = 1 << 16;

/**
 * Module-pooled scratch retained across encodes (bytes). Independent of w·h.
 * Includes the bit writer cap (one IDAT zlib payload) and both token blocks.
 * Intervals L/U grow with width — counted in pngPeakBytes via pngIntervalsBytes(w).
 */
export const PNG_SYNC_FIXED_SCRATCH_BYTES         =
  2 * TOK_BLOCK * 4 +           // TOK_A + TOK_B
  (1 << 15) * 4 +               // TOK_HEAD
  PIX_RING * 4 +                // TOK_PREV
  (1 << 15) * 4 +               // TOK_AGE
  2048 * 4 * 2 +                // Intervals L/U initial capacity
  PNG_IDAT_PAYLOAD_MAX +        // BITS_BUF — one in-flight zlib payload
  4 * 256 * 4 +                 // CRC4
  259 + 32769 +                 // LSYM + DSYM
  286 * 8 + 600 * 8 + 600 * 4 + 600 * 4 + 286 * 4 +  // CL_F/W/P/H/USED
  286 + 286 + 19 +              // CL_OUT_*
  286 * 4 + 30 * 4 + 19 * 4 +   // WB_LF/DF/CF
  316 * 3;                      // WB_SEQ/CL/CE

/** One enqueued IDAT chunk: length(4)+type(4)+payload+crc(4). Stream retains at most one. */
export const PNG_IDAT_CHUNK_MAX         = 12 + PNG_IDAT_PAYLOAD_MAX;

/**
 * Node/V8 empty-isolate `process.memoryUsage().arrayBuffers` before our canvas exists.
 * Measured max baseGap across clean-isolate probes (dashboard@1×): 255_556 bytes.
 * Rounded up to 256 KiB so the formula remains a hard upper bound on measured peaks.
 */
export const PNG_ARRAYBUFFERS_BASELINE_BYTES         = 256 * 1024;

/**
 * Extra allowance on top of pngPeakBytes for V8 deferring reclaim of a just-dropped IDAT
 * ArrayBuffer across a `gc()` turn. Measured max (livePeak − pngPeakBytes) over repeated
 * clean-isolate runs: 1_127_800 bytes (demo@3×). Set to 1.25 MiB. CI asserts
 * measured ≤ pngPeakBytes + PNG_PEAK_V8_RECLAIM_SLACK_BYTES with no further tolerance.
 */
export const PNG_PEAK_V8_RECLAIM_SLACK_BYTES         = 1280 * 1024;

/** Interval arrays L/U after ensure(w): 2 · (w+4) · 4 bytes. */
export const pngIntervalsBytes = (w        )         => 2 * (w + 4) * 4;

/** Block-state bytes on a canvas of size w×h (Agg BLOCK=32). */
export const canvasBlockBytes = (w        , h        )         => {
  const nb = (w + 31) >> 5;
  return nb * h * 4 + nb * h;
};

/**
 * Exact peak `arrayBuffers` bound for the streaming RGBA encode path (bytes):
 *   4·w·h + canvasBlockBytes(w,h) + PNG_SYNC_FIXED_SCRATCH_BYTES
 *   + max(0, pngIntervalsBytes(w) − 2·2048·4) + PNG_IDAT_CHUNK_MAX
 *   + PNG_ARRAYBUFFERS_BASELINE_BYTES
 *
 * Live retained encoded output ≤ one IDAT chunk (pull-based). Unreclaimed V8 garbage from
 * prior chunks is not live; CI measures with GC between pulls (or a clean isolate).
 * Full-frame RGBA is the one O(w·h) term (bands rejected — band-verdict.md).
 */
export const pngPeakBytes = (w        , h        )         => {
  const intervalsExtra = Math.max(0, pngIntervalsBytes(w) - 2 * 2048 * 4);
  return 4 * w * h + canvasBlockBytes(w, h) + PNG_SYNC_FIXED_SCRATCH_BYTES
    + intervalsExtra + PNG_IDAT_CHUNK_MAX + PNG_ARRAYBUFFERS_BASELINE_BYTES;
};

/**
 * Workers isolate budget for PNG peak (bytes). 64 MB leaves headroom under the 128 MB
 * isolate for request handling, Workers Caching materialization, and other isolate state.
 * Enforced before canvas allocation; demo @3× (~54 MB) fits; a 4 MP square @2× does not.
 */
export const PNG_PEAK_BUDGET_BYTES         = 64 * 1024 * 1024;

/** Max 1× pixels (mpl-web LIMITS.pixels). */
export const MAX_FRAME_PIXELS         = 4 * 1024 * 1024;

/** Known-constant peak at the widest legal 1× frame (w=MAX_FRAME_PIXELS, h=1). */
export const PNG_PEAK_MAX_1X_WIDE_BYTES         = pngPeakBytes(MAX_FRAME_PIXELS, 1);

/** Known-constant peak at the square max-1× frame (2048×2048). */
export const PNG_PEAK_MAX_1X_SQUARE_BYTES         = pngPeakBytes(2048, 2048);

/** Whether an output frame of w×h fits the PNG peak budget (no allocation). */
export const pngPeakFitsBudget = (w        , h        )          =>
  pngPeakBytes(w, h) <= PNG_PEAK_BUDGET_BYTES;

/**
 * Largest integer scale ≥ 1 whose output (≈ widthIn·dpi·scale × heightIn·dpi·scale) fits
 * the peak budget; 0 if even scale 1 does not.
 */
export const maxPngScaleForFigure = (widthIn        , heightIn        , dpi        )         => {
  let best = 0;
  for (let s = 1; s <= 8; s++) {
    const w = Math.round(widthIn * dpi * s), h = Math.round(heightIn * dpi * s);
    if (w < 1 || h < 1) break;
    if (!pngPeakFitsBudget(w, h)) break;
    best = s;
  }
  return best;
};

/** [start, end) pairs of pixels where a predicate holds, in x order, with a forward cursor. */
class Intervals {
  e            ; n = 0; k = 0;
  constructor(cap        ) { this.e = new Int32Array(cap); }
  ensure(w        )       { if (this.e.length < w + 4) this.e = new Int32Array(w + 4); }
  /** Pixels from x on that satisfy the predicate (x never decreases between rows' resets). */
  from(x        )         {
    const e = this.e;
    let k = this.k;
    while (k < this.n && e[k + 1] <= x) k += 2;
    this.k = k;
    return k < this.n && e[k] <= x ? e[k + 1] - x : 0;
  }
}

const HBITS_TOK = 15, CHAIN = 4, RM = PIX_RING - 1;
/** Pooled across encodes so a cold isolate pays once. head slots are tagged with TOK_EPOCH so a
 *  fresh encode does not fill 128 KiB with −1; unread slots from a prior encode are ignored. */
const TOK_HEAD = new Int32Array(1 << HBITS_TOK), TOK_PREV = new Int32Array(PIX_RING);
const TOK_AGE = new Int32Array(1 << HBITS_TOK);
let TOK_EPOCH = 1;
const TOK_L = new Intervals(2048), TOK_U = new Intervals(2048);
/** Two fixed token blocks: `tok` is being filled; `held` is a full block waiting so BFINAL is correct. */
const TOK_A = new Int32Array(TOK_BLOCK), TOK_B = new Int32Array(TOK_BLOCK);

/** Common prefix of canvas bytes at a and b (same alignment mod 4), up to max. */
function runBytes(px            , u            , a        , b        , max        )         {
  let l = 0;
  while (l < max && ((a + l) & 3) !== 0) { if (px[a + l] !== px[b + l]) return l; l++; }
  while (l + 4 <= max && u[(a + l) >> 2] === u[(b + l) >> 2]) l += 4;
  while (l < max && px[a + l] === px[b + l]) l++;
  return l;
}
/** Match length at byte pb (row offset xb) against d bytes back, using intervals iv for whole pixels. */
function alongMatch(iv           , px            , W        , pb        , xb        , d        , max        )         {
  let l = 0;
  while (l < max && ((xb + l) & 3) !== 0) { if (px[pb + l] !== px[pb + l - d]) return l; l++; }
  if (l >= max) return l;
  const x = (xb + l) >> 2, np = iv.from(x);
  l += 4 * np;
  if (l >= max) return max;
  if (x + np >= W) return l;
  for (let t = 0; t < 3 && l < max && px[pb + l] === px[pb + l - d]; t++) l++;
  return l;
}

// No closures: one encode's state lives in a ZlibEnc and every step is a module-level function, so V8 keeps one
// feedback vector and one optimized code object per function across encodes. Closures made per encode each had
// their own feedback (zlibEncoder was not hot enough to share it), and optimized code that embedded the previous
// encode's closures deopted with "wrong call target": a cold isolate paid 2–4 slow encodes before it tiered up.
// The token loop keeps its cursor and token block in locals (cheapest in the baseline tier) and writes them back
// before it returns or calls out.
const PH_ROWS = 0, PH_FLUSH = 1, PH_ADLER = 2, PH_DONE = 3;
const FK_HOLD = 0, FK_TAIL = 1, FK_EMPTY = 2;

class ZlibEnc {
           W        ;          H        ;          px            ;          RB        ;          S        ;
           nb        ;          mix            ;          u            ;          blk            ;
           upOk         ;          epoch        ;
  /** The block being filled, and a full block held back so BFINAL lands on the right one. */
  tok             = TOK_A; nTok = 0; held             = TOK_B; hasHeld = false;
  y = 0; xb = 0; rowStarted = false;
  /** Adler-32 halves. */
  a = 1; b = 0;
  phase = PH_ROWS; flushKind = FK_HOLD; high = 0;
  constructor(c        , epoch        ) {
    this.W = c.w; this.H = c.h; this.px = c.px; this.RB = c.w * 4; this.S = this.RB + 1;
    this.nb = c.nb; this.mix = c.mix; this.u = c.i32; this.blk = c.blkI32;
    this.upOk = this.S <= 32768; this.epoch = epoch;
    // tok, held and hasHeld first change when a token block fills, part way into a cold isolate's first encode.
    // V8 treats a field as constant until then, and code optimized on that assumption is thrown away when it
    // changes; a second store here marks them variable before anything is optimized.
    this.tok = TOK_B; this.tok = TOK_A; this.held = TOK_A; this.held = TOK_B; this.hasHeld = true; this.hasHeld = false;
  }
  retainedHigh()         { return Math.max(this.high, BITS.retainedHigh); }
}

function zlibEncoder(c        )          {
  let epoch = TOK_EPOCH + 1;
  if (epoch > 0x7fffffff) { TOK_AGE.fill(0); epoch = 1; }
  TOK_EPOCH = epoch;
  TOK_L.ensure(c.w); TOK_U.ensure(c.w);
  const bw = BITS; bw.reset();
  bw.put(0x78, 8); bw.put(0x9c, 8);
  return new ZlibEnc(c, epoch);
}

/** Called when e.tok is full: Huffman-codes the held block if there is one (true: take an IDAT), holds this one. */
function rotateTok(e         )          {
  const full = e.tok;
  let coded = false;
  if (e.hasHeld) { writeBlock(BITS, e.held, 0, TOK_BLOCK, false); coded = true; }
  e.held = full; e.hasHeld = true;
  e.tok = full === TOK_A ? TOK_B : TOK_A; e.nTok = 0;
  return coded;
}

/**
 * Row y's left and up intervals, and its bytes added to the Adler-32 halves. Three small functions, each one loop
 * nest, so each tiers up on its own; inside mixed blocks the scans step through runs of equal (or unequal) pixels in
 * tight inner loops, which costs the baseline tier far fewer bytecodes per pixel than one test-everything loop.
 */
function startRow(e         , y        )       {
  leftIntervals(e, y);
  if (y > 0) upIntervals(e, y); else { TOK_U.n = 0; TOK_U.k = 0; }
  adlerRow(e, y);
}

/** [start, end) pixels of row y equal to their left neighbour, from the block state and mixed blocks' pixels. */
function leftIntervals(e         , y        )       {
  const W = e.W, nb = e.nb, mix = e.mix, blk = e.blk, u = e.u;
  const row = y * W, brow = y * nb, le = TOK_L.e;
  let ln = 0, lo = -1, last = u[row];
  for (let j = 0; j < nb; j++) {
    const bs = j << BLOCK_SHIFT, be = Math.min(bs + BLOCK, W), bi = brow + j;
    if (mix[bi] === 0) {
      const col = blk[bi];
      if (bs > 0 && col === last) { if (lo < 0) lo = bs; }
      else { if (lo >= 0) { le[ln++] = lo; le[ln++] = bs; } lo = be - bs > 1 ? bs + 1 : -1; }
      last = col;
      continue;
    }
    // pixel 0 has no left neighbour: it only sets `last` (already u[row])
    let p = row + (bs === 0 ? 1 : bs);
    const pe = row + be;
    while (p < pe) {
      if (u[p] === last) {
        if (lo < 0) lo = p - row;
        do p++; while (p < pe && u[p] === last);
      } else {
        if (lo >= 0) { le[ln++] = lo; le[ln++] = p - row; lo = -1; }
        do { last = u[p]; p++; } while (p < pe && u[p] !== last);
      }
    }
  }
  if (lo >= 0) { le[ln++] = lo; le[ln++] = W; }
  TOK_L.n = ln; TOK_L.k = 0;
}

/** [start, end) pixels of row y (> 0) equal to the pixel above. */
function upIntervals(e         , y        )       {
  const W = e.W, nb = e.nb, mix = e.mix, blk = e.blk, u = e.u;
  const row = y * W, brow = y * nb, ue = TOK_U.e;
  let un = 0, uo = -1;
  for (let j = 0; j < nb; j++) {
    const bs = j << BLOCK_SHIFT, bi = brow + j;
    if (mix[bi] === 0 && mix[bi - nb] === 0) {
      if (blk[bi] === blk[bi - nb]) { if (uo < 0) uo = bs; }
      else if (uo >= 0) { ue[un++] = uo; ue[un++] = bs; uo = -1; }
      continue;
    }
    let p = row + bs;
    const pe = row + Math.min(bs + BLOCK, W);
    while (p < pe) {
      if (u[p] === u[p - W]) {
        if (uo < 0) uo = p - row;
        do p++; while (p < pe && u[p] === u[p - W]);
      } else {
        if (uo >= 0) { ue[un++] = uo; ue[un++] = p - row; uo = -1; }
        do p++; while (p < pe && u[p] !== u[p - W]);
      }
    }
  }
  if (uo >= 0) { ue[un++] = uo; ue[un++] = W; }
  TOK_U.n = un; TOK_U.k = 0;
}

/** Row y's filter byte (0) and pixels into the Adler-32 halves: runs from the left intervals in O(1), singles per pixel. */
function adlerRow(e         , y        )       {
  const W = e.W, px = e.px, row = y * W, le = TOK_L.e, ln = TOK_L.n;
  let a = modA(e.a), b = modA(e.b + a), pending = 0;
  for (let k = 0, x = 0; x < W;) {
    const s0 = k < ln ? le[k] - 1 : W;
    const end = x < s0 ? s0 : le[k + 1];
    const len = x < s0 ? 1 : end - x;
    const q = (row + x) * 4, x0 = px[q], x1 = px[q + 1], x2 = px[q + 2], x3 = px[q + 3];
    const sum = x0 + x1 + x2 + x3, tsum = 4 * x0 + 3 * x1 + 2 * x2 + x3;
    if (len === 1) {
      b += 4 * a + tsum; a += sum;
      if (++pending === ADLER_SINGLES) { a = modA(a); b = modA(b); pending = 0; }
      x++;
    } else {
      b = modA(b + 4 * a * len + len * tsum + 2 * sum * len * (len - 1));
      a = modA(a + len * sum);
      pending = 0; x = end; k += 2;
    }
  }
  e.a = a; e.b = b;
}

/** LZ77 over the rows from (e.y, e.xb). true: a Huffman block was coded (take an IDAT); false: past the last row. */
function encodeRows(e         )          {
  while (e.y < e.H) {
    if (!e.rowStarted) { startRow(e, e.y); e.rowStarted = true; e.xb = 0; e.tok[e.nTok++] = 0; }
    else if (e.xb < e.RB) encodeRow(e);
    else { e.y++; e.rowStarted = false; continue; }
    // as soon as a token block fills, as zlib's deflate would
    if (e.nTok === TOK_BLOCK && rotateTok(e)) return true;
  }
  return false;
}

/**
 * The hash chain's candidates for the pixel-aligned byte pb (row y, offset xb), against the best match so far
 * packed as best | dist << 9 (best ≤ 258, dist ≤ 32768), returned in the same packing. Its own function keeps
 * encodeRow small enough for V8's optimizing compiler to build quickly.
 */
function chainMatch(e         , y        , xb        , pb        , max        , packed        )         {
  const W = e.W, px = e.px, u = e.u, RB = e.RB, S = e.S, epoch = e.epoch, head = TOK_HEAD, prev = TOK_PREV;
  let best = packed & 511, dist = packed >>> 9;
  const p = pb >> 2;
  const hh = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
  let j = TOK_AGE[hh] === epoch ? head[hh] : -1, chain = CHAIN;
  while (j >= 0 && chain-- > 0 && p - j <= RM) {
    const qy = (j / W) | 0, qxb = (j - qy * W) * 4, bd = (y - qy) * S + xb - qxb;
    if (bd > 32768) break;
    const mlen = Math.min(max, RB - qxb);
    if (best < mlen && px[j * 4 + best] === px[pb + best]) {
      const l = runBytes(px, u, pb, j * 4, mlen);
      if (l > best) { best = l; dist = bd; }
    }
    const pj = prev[j & RM];
    if (pj >= j) break;
    j = pj;
  }
  return best | (dist << 9);
}

/**
 * Tokens for row e.y from byte e.xb to the row's end, or until the token block is full. One row per call, so the
 * loop V8 compiles on stack replacement is the function's outermost: optimized code no longer deopts ("exit from
 * OSR'd inner loop") at every row end, and the per-row calls tier the whole function up normally. Leaving the
 * block rotation (rare, and a call) to the caller keeps this loop free of paths that have never run.
 */
function encodeRow(e         )       {
  const W = e.W, px = e.px, u = e.u, RB = e.RB, S = e.S, upOk = e.upOk, epoch = e.epoch, y = e.y;
  const head = TOK_HEAD, prev = TOK_PREV, age = TOK_AGE, L = TOK_L, U = TOK_U;
  let xb = e.xb, nTok = e.nTok;
  const tok = e.tok, rowB = y * RB;
  while (xb < RB && nTok < TOK_BLOCK) {
    const pb = rowB + xb, max = Math.min(258, RB - xb);
    let best = 0, dist = 0;
    if (max >= 3) {
      if (xb >= 4) { best = alongMatch(L, px, W, pb, xb, 4, max); dist = 4; }
      if (y > 0 && upOk && best < max) { const l = alongMatch(U, px, W, pb, xb, RB, max); if (l > best) { best = l; dist = S; } }
      if (best < 32 && (xb & 3) === 0) {
        const m = chainMatch(e, y, xb, pb, max, best | (dist << 9));
        best = m & 511; dist = m >>> 9;
      }
    }
    if (best >= 3) {
      // a 258-byte match inserts only its last two pixels, a short one every pixel it starts
      tok[nTok++] = 256 + ((best << 16) | dist);
      const p0 = (rowB + ((xb + 3) & ~3)) >> 2, p1 = (pb + best) >> 2;
      for (let p = best <= 32 ? p0 : Math.max(p0, p1 - 2); p < p1; p++) {
        const h = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
        prev[p & RM] = age[h] === epoch ? head[h] : -1; head[h] = p; age[h] = epoch;
      }
      xb += best;
    } else {
      tok[nTok++] = px[pb];
      if ((xb & 3) === 0) {
        const p = pb >> 2, h = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
        prev[p & RM] = age[h] === epoch ? head[h] : -1; head[h] = p; age[h] = epoch;
      }
      xb++;
    }
  }
  e.xb = xb; e.nTok = nTok;
}

/** The coded bytes as one IDAT chunk (single allocation, no intermediate payload copy). */
function takeIdat(e         )             {
  const out = BITS.takeIdatChunk();
  if (BITS.retainedHigh > e.high) e.high = BITS.retainedHigh;
  // retained encoded bytes ≤ zlib payload (= chunk length − 12)
  if (out.length - 12 > e.high) e.high = out.length - 12;
  return out;
}

/** The final IDAT: zlib tail ‖ Adler-32 (single allocation). */
function adlerIdat(e         )             {
  const a = modA(e.a), b = modA(e.b);
  const adler = ((b << 16) | a) >>> 0;
  const tail = BITS.flush(); // complete bytes; writer empty
  const n = tail.length + 4;
  const out = new Uint8Array(12 + n);
  out[0] = (n >>> 24) & 255; out[1] = (n >>> 16) & 255; out[2] = (n >>> 8) & 255; out[3] = n & 255;
  out[4] = 73; out[5] = 68; out[6] = 65; out[7] = 84;
  out.set(tail, 8);
  out[8 + tail.length] = (adler >>> 24) & 255;
  out[9 + tail.length] = (adler >>> 16) & 255;
  out[10 + tail.length] = (adler >>> 8) & 255;
  out[11 + tail.length] = adler & 255;
  const crc = crcDone(crc32(out.subarray(4, 8 + n)));
  out[8 + n] = (crc >>> 24) & 255; out[9 + n] = (crc >>> 16) & 255;
  out[10 + n] = (crc >>> 8) & 255; out[11 + n] = crc & 255;
  if (n > e.high) e.high = n;
  return out;
}

/**
 * Canvas-aware LZ77 → dynamic-Huffman zlib as pull-driven IDAT payloads.
 * Each pull after the header yields at most one IDAT whose zlib payload is ≤ PNG_IDAT_PAYLOAD_MAX
 * (framed IDAT chunk; none when finished). Token scratch stays 2·TOK_BLOCK; the bit writer is compacted after every IDAT.
 */
function pullIdat(e         )                     {
  for (;;) {
    switch (e.phase) {
      case PH_DONE: return none;
      case PH_ADLER: e.phase = PH_DONE; return some(adlerIdat(e));
      case PH_FLUSH:
        if (e.flushKind === FK_HOLD && e.hasHeld && e.nTok > 0) {
          writeBlock(BITS, e.held, 0, TOK_BLOCK, false); e.hasHeld = false;
          e.flushKind = FK_TAIL;
          return some(takeIdat(e));
        }
        if (e.flushKind === FK_HOLD && e.hasHeld) {
          writeBlock(BITS, e.held, 0, TOK_BLOCK, true); e.hasHeld = false;
          e.phase = PH_ADLER;
          return some(takeIdat(e));
        }
        if (e.flushKind === FK_TAIL || e.nTok > 0) {
          writeBlock(BITS, e.tok, 0, e.nTok, true); e.nTok = 0;
          e.phase = PH_ADLER;
          return some(takeIdat(e));
        }
        BITS.put(1, 1); BITS.put(1, 2); BITS.put(0, 7);
        e.phase = PH_ADLER;
        return some(takeIdat(e));
      case PH_ROWS:
        if (encodeRows(e)) return some(takeIdat(e));
        e.phase = PH_FLUSH;
        e.flushKind = e.hasHeld || e.nTok > 0 ? FK_HOLD : FK_EMPTY;
        break;
      default: throw new Error(`pullIdat: bad phase ${e.phase}`);
    }
  }
}


export function encodePNGSync(c        , opts                 = RGBA)             {
  const effort = opts.level.kind === 'some' ? effortOf(opts.level.value) : FAST;
  if (opts.colors.kind === 'some') {
    const ix = quantize(c, opts.colors.value);
    return concat([headerIndexed(c.w, c.h, c.dpi, ix), chunk('IDAT', zlibSync(indexedBand(ix, c.w, 0, c.h), indexedStride(ix, c.w), 1, effort)), IEND]);
  }
  if (opts.level.kind === 'some') return concat([header(c.w, c.h, c.dpi), chunk('IDAT', zlibSync(filteredBand(c, 0, c.h), c.w * 4 + 1, 4, effort)), IEND]);
  return tracer.span('png.sync', { w: c.w, h: c.h }, (sp) => {
    // Single IDAT: same zlib stream as pngStreamSync (payloads concat-identical), but one
    // chunk so SVG data-URIs / toPNGSync stay byte-identical to the pre-streaming encoder.
    // Workers that need O(1) retained output use pngStreamSync (multi-IDAT).
    const enc = zlibEncoder(c);
    const zParts               = [];
    let zBytes = 0, nPull = 0;
    for (;;) {
      const p = tracer.span('png.idat', { i: nPull }, (isp) => {
        const r = pullIdat(enc);
        if (r.kind === 'some') isp.setAttribute('zBytes', r.value.length - 12).setAttribute('retained', enc.retainedHigh());
        return r;
      });
      if (p.kind === 'none') break;
      // pullIdat yields a framed IDAT; strip to zlib payload for the single-chunk file.
      zParts.push(p.value.subarray(8, p.value.length - 4));
      zBytes += p.value.length - 12;
      nPull++;
    }
    const z = concat(zParts);
    const out = concat([header(c.w, c.h, c.dpi), chunk('IDAT', z), IEND]);
    sp.setAttribute('zBytes', zBytes).setAttribute('bytes', out.length)
      .setAttribute('retained', enc.retainedHigh()).setAttribute('nIdat', 1).setAttribute('nPull', nPull);
    return out;
  });
}

/**
 * Pull-based PNG: signature+IHDR, then one IDAT per pull (≤ PNG_IDAT_PAYLOAD_MAX zlib bytes), then IEND.
 * Backpressure: the encoder only advances on pull. Retained encoded output ≤ one IDAT payload.
 * Zlib payloads across IDATs concat to the same bytes as encodePNGSync's single IDAT (file framing differs).
 */
export function pngStreamSync(c        , opts                 = RGBA)                             {
  if (opts.colors.kind === 'some' || opts.level.kind === 'some') {
    const body = encodePNGSync(c, opts);
    return new ReadableStream({ start(ctl) { ctl.enqueue(body); ctl.close(); } });
  }
  let state                                   = 'head';
  let enc                  = none;
  let nIdat = 0;
  return new ReadableStream({
    pull(ctl) {
      switch (state) {
        case 'head':
          return tracer.span('png.stream.head', { w: c.w, h: c.h }, () => {
            ctl.enqueue(header(c.w, c.h, c.dpi));
            enc = some(zlibEncoder(c));
            state = 'body';
          });
        case 'body': {
          return tracer.span('png.stream.idat', { i: nIdat }, (sp) => {
            if (enc.kind !== 'some') throw new Error('pngStreamSync: encoder missing');
            const z = enc.value;
            const p = pullIdat(z);
            if (p.kind === 'some') {
              sp.setAttribute('zBytes', p.value.length - 12).setAttribute('retained', z.retainedHigh());
              nIdat++;
              ctl.enqueue(p.value); // already a full IDAT chunk
              return;
            }
            sp.setAttribute('nIdat', nIdat);
            ctl.enqueue(IEND);
            state = 'done';
            ctl.close();
          });
        }
        case 'end':
          ctl.enqueue(IEND);
          state = 'done';
          ctl.close();
          return;
        case 'done':
          ctl.close();
          return;
        default:
          throw new Error('unreachable');
      }
    },
  });
}
