// AGG image filter resample — matplotlib 3.11.2 with MPL_FIX_AGG_IMAGE_FILTER_LUT_BUGS
// and MPL_FIX_AGG_INTERPOLATION_ENDPOINT_BUG. Ports span_image_resample_*_affine
// for affines on float64 gray and float32 RGBA (premultiplied) data.
                                                                                              

/** Matplotlib Affine2D matrix: x′=sx·x + shx·y + tx; y′=shy·x + sy·y + ty (input→output). */
                   
                                                                  
                                                                
  

export const affScale = (sx        , sy        )      =>
  ({ sx, shy: 0, shx: 0, sy, tx: 0, ty: 0 });

export class UnsupportedInterpolationError extends Error {
           interpolation        ;
  constructor(interpolation        , detail        ) {
    super(`UnsupportedInterpolationError: interpolation=${JSON.stringify(interpolation)}: ${detail}`);
    this.name = 'UnsupportedInterpolationError';
    this.interpolation = interpolation;
  }
}

const FILTER_SHIFT = 14;
const FILTER_SCALE = 1 << FILTER_SHIFT;
const SUBPIXEL_SHIFT = 8;
const SUBPIXEL_SCALE = 1 << SUBPIXEL_SHIFT;
const SUBPIXEL_MASK = SUBPIXEL_SCALE - 1;

const iround = (v        )         => (v < 0.0 ? Math.ceil(v - 0.5) : Math.floor(v + 0.5));
const uround = (v        )         => Math.floor(v + 0.5);
const uceil = (v        )         => Math.ceil(v);

/** Resolve auto/antialiased → nearest | hanning (matplotlib.image._resample). */
export function resolveInterp(
  interp            , dataW        , dataH        , dispW        , dispH        ,
)                                     {
  if (interp === 'nearest' || interp === 'none') return 'nearest';
  if (interp === 'hanning') return 'hanning';
  if (interp === 'bilinear') return 'bilinear';
  const dispx = Math.abs(dispW), dispy = Math.abs(dispH);
  if (((dispx > 3 * dataW || dispx === dataW || dispx === 2 * dataW)
    && (dispy > 3 * dataH || dispy === dataH || dispy === 2 * dataH))) {
    return 'nearest';
  }
  return 'hanning';
}

/** matplotlib interpolation_stage: zoom = display_px / data_px. */
export function interpolationStage(
  dataW        , dataH        , dispW        , dispH        ,
)                  {
  const dispx = Math.abs(dispW) / dataW, dispy = Math.abs(dispH) / dataH;
  return (dispx < 3 || dispy < 3) ? 'rgba' : 'data';
}

                                         

function calcWeight(kind            , x        )         {
  if (kind === 'hanning') return 0.5 + 0.5 * Math.cos(Math.PI * x);
  return 1 - x;
}

function buildLut(kind            )             {
  const radius = 1.0;
  const diameter = uceil(radius) * 2;
  const size = diameter << SUBPIXEL_SHIFT;
  const weight = new Int16Array(size);
  const pivot = (diameter << (SUBPIXEL_SHIFT - 1)) - 1;
  for (let i = 0; i <= pivot; i++) {
    const x = i / SUBPIXEL_SCALE;
    const y = x <= radius ? calcWeight(kind, x) : 0;
    const w = iround(y * FILTER_SCALE);
    weight[pivot + i] = w;
    weight[pivot - i] = w;
  }
  const end = (diameter << SUBPIXEL_SHIFT) - 1;
  weight[end] = iround(calcWeight(kind, diameter / 2) * FILTER_SCALE);
  for (let i = 0; i < SUBPIXEL_SCALE; i++) {
    for (;;) {
      let sum = 0;
      for (let j = 0; j < diameter; j++) sum += weight[j * SUBPIXEL_SCALE + i];
      if (sum === FILTER_SCALE) break;
      const k = FILTER_SCALE / sum;
      sum = 0;
      for (let j = 0; j < diameter; j++) {
        const idx = j * SUBPIXEL_SCALE + i;
        const v = iround(weight[idx] * k);
        weight[idx] = v;
        sum += v;
      }
      sum -= FILTER_SCALE;
      const inc = sum > 0 ? -1 : 1;
      let flip = 1;
      for (let j = 0; j < diameter && sum !== 0; j++) {
        flip ^= 1;
        const idxRow = flip ? Math.floor(diameter / 2) + Math.floor(j / 2)
          : Math.floor(diameter / 2) - Math.floor(j / 2);
        const idx = idxRow * SUBPIXEL_SCALE + i;
        const v = weight[idx];
        if (v < FILTER_SCALE) { weight[idx] = v + inc; sum += inc; }
      }
    }
  }
  return weight;
}

const LUT_HANNING = buildLut('hanning');
const LUT_BILINEAR = buildLut('bilinear');
const lutOf = (k            )             => (k === 'hanning' ? LUT_HANNING : LUT_BILINEAR);

function reflect(v        , size        )         {
  if (size <= 0) return 0;
  const size2 = size * 2;
  const add = size2 * Math.floor(0x3fffffff / size2);
  let value = (v + add) % size2;
  if (value < 0) value += size2;
  if (value >= size) return size2 - value - 1;
  return value;
}

class Dda2 {
          cnt        ;
          lft        ;
          rem        ;
          mod        ;
          yy        ;
  constructor(y1        , y2        , count        ) {
    this.cnt = count <= 0 ? 1 : count;
    this.lft = Math.trunc((y2 - y1) / this.cnt);
    this.rem = (y2 - y1) % this.cnt;
    this.mod = this.rem;
    this.yy = y1;
    if (this.mod <= 0) {
      this.mod += count;
      this.rem += count;
      this.lft--;
    }
    this.mod -= count;
  }
  next()       {
    this.mod += this.rem;
    this.yy += this.lft;
    if (this.mod > 0) { this.mod -= this.cnt; this.yy++; }
  }
  y()         { return this.yy; }
}

/** Invert matplotlib Aff (no shear required for imshow). */
function invertAxisAligned(a     )      {
  // Only handle shx=shy=0 (imshow axis-aligned)
  if (a.shx !== 0 || a.shy !== 0) {
    throw new UnsupportedInterpolationError('hanning', 'sheared affine not supported');
  }
  const invSx = 1 / a.sx, invSy = 1 / a.sy;
  return { sx: invSx, shy: 0, shx: 0, sy: invSy, tx: -a.tx * invSx, ty: -a.ty * invSy };
}

function scalingAbs(a     )                             {
  return { sx: Math.abs(a.sx), sy: Math.abs(a.sy) };
}

function transform(a     , x        , y        )                            {
  return [a.sx * x + a.shx * y + a.tx, a.shy * x + a.sy * y + a.ty];
}

             
                                                                                    
                                                                                           
                                                     
                    
  

function prepare(aff     , kind            )       {
  const lut = lutOf(kind);
  const diameter = 2;
  const filterScale = diameter << SUBPIXEL_SHIFT;
  const inv = invertAxisAligned(aff);
  let { sx: scaleX, sy: scaleY } = scalingAbs(inv);
  if (scaleX < 1) scaleX = 1;
  if (scaleY < 1) scaleY = 1;
  const rx = uround(scaleX * SUBPIXEL_SCALE);
  const ry = uround(scaleY * SUBPIXEL_SCALE);
  const rxInv = uround((1 / scaleX) * SUBPIXEL_SCALE);
  const ryInv = uround((1 / scaleY) * SUBPIXEL_SCALE);
  return {
    lut, diameter, filterScale, rx, ry, rxInv, ryInv,
    radiusX: (diameter * rx) >> 1, radiusY: (diameter * ry) >> 1, inv,
  };
}

/**
 * Axis-aligned AGG span_image_resample_gray_affine for float64.
 * `aff` is the matplotlib affine (input→output), matching `_image.resample`.
 */
export function resampleAffineFloat(
  src              , srcW        , srcH        ,
  out              , outW        , outH        ,
  aff     , kind            ,
)       {
  const p = prepare(aff, kind);
  const filterDxInt = SUBPIXEL_SCALE >> 1, filterDyInt = SUBPIXEL_SCALE >> 1;
  const filterDxDbl = 0.5, filterDyDbl = 0.5;
  for (let oy = 0; oy < outH; oy++) {
    const len = outW, beginLen = len - 1;
    const [tx0, ty0] = transform(p.inv, 0 + filterDxDbl, oy + filterDyDbl);
    const [tx1, ty1] = transform(p.inv, 0 + filterDxDbl + beginLen, oy + filterDyDbl);
    const liX = new Dda2(iround(tx0 * SUBPIXEL_SCALE), iround(tx1 * SUBPIXEL_SCALE), beginLen);
    const liY = new Dda2(iround(ty0 * SUBPIXEL_SCALE), iround(ty1 * SUBPIXEL_SCALE), beginLen);
    for (let ox = 0; ox < outW; ox++) {
      const x = liX.y() + filterDxInt - p.radiusX;
      const y = liY.y() + filterDyInt - p.radiusY;
      let yLr = y >> SUBPIXEL_SHIFT;
      let yHr = ((SUBPIXEL_MASK - (y & SUBPIXEL_MASK)) * p.ryInv) >> SUBPIXEL_SHIFT;
      const xLr0 = x >> SUBPIXEL_SHIFT;
      const xHr2 = ((SUBPIXEL_MASK - (x & SUBPIXEL_MASK)) * p.rxInv) >> SUBPIXEL_SHIFT;
      let total = 0, sum = 0;
      for (;;) {
        const weightY = p.lut[yHr];
        let xHr = xHr2, xLr = xLr0;
        for (;;) {
          const weight = (weightY * p.lut[xHr] + (FILTER_SCALE >> 1)) >> FILTER_SHIFT;
          sum += src[reflect(yLr, srcH) * srcW + reflect(xLr, srcW)] * weight;
          total += weight;
          xHr += p.rxInv;
          if (xHr >= p.filterScale) break;
          xLr++;
        }
        yHr += p.ryInv;
        if (yHr >= p.filterScale) break;
        yLr++;
      }
      out[oy * outW + ox] = total !== 0 ? sum / total : 0;
      if (ox + 1 < outW) { liX.next(); liY.next(); }
    }
  }
}

/**
 * Axis-aligned AGG span_image_resample_rgba_affine for float32 RGBA (premultiplied).
 * src/out are tightly packed RGBA float32 in [0,1] (or premultiplied).
 */
export function resampleAffineRgba(
  src              , srcW        , srcH        ,
  out              , outW        , outH        ,
  aff     , kind            ,
)       {
  const p = prepare(aff, kind);
  const filterDxInt = SUBPIXEL_SCALE >> 1, filterDyInt = SUBPIXEL_SCALE >> 1;
  const filterDxDbl = 0.5, filterDyDbl = 0.5;
  for (let oy = 0; oy < outH; oy++) {
    const len = outW, beginLen = len - 1;
    const [tx0, ty0] = transform(p.inv, 0 + filterDxDbl, oy + filterDyDbl);
    const [tx1, ty1] = transform(p.inv, 0 + filterDxDbl + beginLen, oy + filterDyDbl);
    const liX = new Dda2(iround(tx0 * SUBPIXEL_SCALE), iround(tx1 * SUBPIXEL_SCALE), beginLen);
    const liY = new Dda2(iround(ty0 * SUBPIXEL_SCALE), iround(ty1 * SUBPIXEL_SCALE), beginLen);
    for (let ox = 0; ox < outW; ox++) {
      const x = liX.y() + filterDxInt - p.radiusX;
      const y = liY.y() + filterDyInt - p.radiusY;
      let yLr = y >> SUBPIXEL_SHIFT;
      let yHr = ((SUBPIXEL_MASK - (y & SUBPIXEL_MASK)) * p.ryInv) >> SUBPIXEL_SHIFT;
      const xLr0 = x >> SUBPIXEL_SHIFT;
      const xHr2 = ((SUBPIXEL_MASK - (x & SUBPIXEL_MASK)) * p.rxInv) >> SUBPIXEL_SHIFT;
      let total = 0, r = 0, g = 0, b = 0, a = 0;
      for (;;) {
        const weightY = p.lut[yHr];
        let xHr = xHr2, xLr = xLr0;
        for (;;) {
          const weight = (weightY * p.lut[xHr] + (FILTER_SCALE >> 1)) >> FILTER_SHIFT;
          const s = (reflect(yLr, srcH) * srcW + reflect(xLr, srcW)) * 4;
          r += src[s] * weight; g += src[s + 1] * weight;
          b += src[s + 2] * weight; a += src[s + 3] * weight;
          total += weight;
          xHr += p.rxInv;
          if (xHr >= p.filterScale) break;
          xLr++;
        }
        yHr += p.ryInv;
        if (yHr >= p.filterScale) break;
        yLr++;
      }
      const o = (oy * outW + ox) * 4;
      if (total !== 0) {
        r /= total; g /= total; b /= total; a /= total;
      }
      if (r < 0) r = 0; if (g < 0) g = 0; if (b < 0) b = 0; if (a < 0) a = 0;
      if (a > 1) a = 1;
      if (r > a) r = a; if (g > a) g = a; if (b > a) b = a;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      if (ox + 1 < outW) { liX.next(); liY.next(); }
    }
  }
}

export function resampleHanningFloat(
  src              , srcW        , srcH        ,
  out              , outW        , outH        ,
  affineSx        , affineSy        ,
)       {
  resampleAffineFloat(src, srcW, srcH, out, outW, outH, affScale(affineSx, affineSy), 'hanning');
}

export function resampleBilinearFloat(
  src              , srcW        , srcH        ,
  out              , outW        , outH        ,
  affineSx        , affineSy        ,
)       {
  resampleAffineFloat(src, srcW, srcH, out, outW, outH, affScale(affineSx, affineSy), 'bilinear');
}

export function resampleHanningRgba(
  src              , srcW        , srcH        ,
  out              , outW        , outH        ,
  aff     ,
)       {
  resampleAffineRgba(src, srcW, srcH, out, outW, outH, aff, 'hanning');
}
