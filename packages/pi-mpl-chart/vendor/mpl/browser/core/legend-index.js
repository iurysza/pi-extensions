// Spatial index for Legend loc='best': plan once (linear in vertices), then answer
// each candidate box in O(cells touched) instead of O(vertices).
//   badness(box) = #vertices strictly inside + #collection offsets strictly inside + #bboxes overlapping
//                + #lines intersecting the box (vertex inside-or-on, or a segment crossing an edge)
// `paths` are lines whose own vertices are not counted (a curved Patch's flattened outline: its raw vertices come as offsets).
// Offsets (Legend._auto_legend_data's `offsets`) are counted like vertices but belong to no line.
// Interior cells come from a prefix table; only boundary cells are tested exactly.
                                    

                                                                                                         
                                                                                                                                         

export const overlaps = (a     , b     )          => a.x1 > b.x0 && a.x0 < b.x1 && a.y1 > b.y0 && a.y0 < b.y1;

function segmentsIntersect(x1        , y1        , x2        , y2        , x3        , y3        , x4        , y4        )          {
  const den = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (den === 0) return false;
  const u1 = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / den;
  const u2 = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / den;
  return u1 >= 0 && u1 <= 1 && u2 >= 0 && u2 <= 1;
}
const segCrossesBox = (x1        , y1        , x2        , y2        , r     )          =>
  segmentsIntersect(x1, y1, x2, y2, r.x0, r.y0, r.x1, r.y0) || segmentsIntersect(x1, y1, x2, y2, r.x1, r.y0, r.x1, r.y1)
  || segmentsIntersect(x1, y1, x2, y2, r.x1, r.y1, r.x0, r.y1) || segmentsIntersect(x1, y1, x2, y2, r.x0, r.y1, r.x0, r.y0);

const ok = (L    , i        )          => Number.isFinite(L.xs[i]) && Number.isFinite(L.ys[i]);

/** Grid cell of coordinate v, clamped to [0, n). */
const cellOf = (v        , cell        , n        )         => Math.min(n - 1, Math.max(0, Math.floor(v / cell)));

/** Pass 1 over one line: vertices per cell into vCount, segment-cell incidences (each segment's cell bbox) into sCount. */
function countLine(L    , cols        , rows        , cell        , vCount            , sCount            , cCount            , counted         )       {
  const xs = L.xs, ys = L.ys;
  for (let i = 0; i < xs.length; i++) {
    if (!ok(L, i)) continue;
    const c = cellOf(ys[i], cell, rows) * cols + cellOf(xs[i], cell, cols);
    vCount[c]++;
    if (counted) cCount[c]++;
    if (i > 0 && ok(L, i - 1)) {
      const ax0 = cellOf(Math.min(xs[i], xs[i - 1]), cell, cols), ax1 = cellOf(Math.max(xs[i], xs[i - 1]), cell, cols);
      const ay0 = cellOf(Math.min(ys[i], ys[i - 1]), cell, rows), ay1 = cellOf(Math.max(ys[i], ys[i - 1]), cell, rows);
      for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) sCount[y * cols + x]++;
    }
  }
}

/** Pass 2 over line li, in pass 1's order: vertices and segment indices into their cells' CSR slots. */
function fillLine(L    , li        , cols        , rows        , cell        , vFill            , vX              , vY              ,
                  vLine            , sFill            , sLine            , sIdx            )       {
  const xs = L.xs, ys = L.ys;
  for (let i = 0; i < xs.length; i++) {
    if (!ok(L, i)) continue;
    const k = vFill[cellOf(ys[i], cell, rows) * cols + cellOf(xs[i], cell, cols)]++;
    vX[k] = xs[i]; vY[k] = ys[i]; vLine[k] = li;
    if (i > 0 && ok(L, i - 1)) {
      const ax0 = cellOf(Math.min(xs[i], xs[i - 1]), cell, cols), ax1 = cellOf(Math.max(xs[i], xs[i - 1]), cell, cols);
      const ay0 = cellOf(Math.min(ys[i], ys[i - 1]), cell, rows), ay1 = cellOf(Math.max(ys[i], ys[i - 1]), cell, rows);
      for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) { const kk = sFill[y * cols + x]++; sLine[kk] = li; sIdx[kk] = i; }
    }
  }
}

// The build passes are module functions, not closures made per call, so V8 keeps their feedback and optimized
// code from one legend to the next (a cold render builds one index per legend, twice with tight_layout).
export function buildObstacleIndex(counted               , points               , bboxes                , W        , H        , cell        ,
                                   paths                = [])                {
  const cols = Math.max(1, Math.ceil(W / cell)), rows = Math.max(1, Math.ceil(H / cell));
  const nCells = cols * rows;
  const lines = paths.length === 0 ? counted : [...counted, ...paths], nCounted = counted.length;

  // pass 1: counts (vCount: every vertex, for the layout; cCount: the ones badness counts)
  const vCount = new Int32Array(nCells), sCount = new Int32Array(nCells), cCount = new Int32Array(nCells);
  for (let li = 0; li < lines.length; li++) countLine(lines[li], cols, rows, cell, vCount, sCount, cCount, li < nCounted);
  for (const P of points) for (let i = 0; i < P.xs.length; i++) if (ok(P, i)) { const c = cellOf(P.ys[i], cell, rows) * cols + cellOf(P.xs[i], cell, cols); vCount[c]++; cCount[c]++; }
  // CSR layout
  const vStart = new Int32Array(nCells + 1), sStart = new Int32Array(nCells + 1);
  for (let c = 0; c < nCells; c++) { vStart[c + 1] = vStart[c] + vCount[c]; sStart[c + 1] = sStart[c] + sCount[c]; }
  const totalV = vStart[nCells], totalS = sStart[nCells];
  const vX = new Float64Array(totalV), vY = new Float64Array(totalV), vLine = new Int32Array(totalV);
  const sLine = new Int32Array(totalS), sIdx = new Int32Array(totalS);
  const vFill = vStart.slice(0, nCells), sFill = sStart.slice(0, nCells);
  for (let li = 0; li < lines.length; li++) fillLine(lines[li], li, cols, rows, cell, vFill, vX, vY, vLine, sFill, sLine, sIdx);
  for (const P of points) {
    for (let i = 0; i < P.xs.length; i++) {
      if (!ok(P, i)) continue;
      const k = vFill[cellOf(P.ys[i], cell, rows) * cols + cellOf(P.xs[i], cell, cols)]++;
      vX[k] = P.xs[i]; vY[k] = P.ys[i]; vLine[k] = -1;   // an offset: counted, never a line hit
    }
  }
  // 2D prefix sums of vertex counts
  const W1 = cols + 1;
  const pre = new Int32Array(W1 * (rows + 1));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    pre[(y + 1) * W1 + x + 1] = cCount[y * cols + x] + pre[y * W1 + x + 1] + pre[(y + 1) * W1 + x] - pre[y * W1 + x];
  }
  const rectSum = (x0        , y0        , x1        , y1        )         =>
    pre[(y1 + 1) * W1 + x1 + 1] - pre[y0 * W1 + x1 + 1] - pre[(y1 + 1) * W1 + x0] + pre[y0 * W1 + x0];
  const hit = new Uint8Array(lines.length);

  function badness(box     , limit        )         {
    let b = 0;
    for (const r of bboxes) if (overlaps(box, r)) b++;
    if (b >= limit) return b;
    const cx0 = Math.max(0, Math.floor(box.x0 / cell)), cx1 = Math.min(cols - 1, Math.floor(box.x1 / cell));
    const cy0 = Math.max(0, Math.floor(box.y0 / cell)), cy1 = Math.min(rows - 1, Math.floor(box.y1 / cell));
    if (cx1 < cx0 || cy1 < cy0) return b;
    // interior cells lie strictly inside the box
    const ix0 = Math.floor(box.x0 / cell) + 1, ix1 = Math.ceil(box.x1 / cell) - 2;
    const iy0 = Math.floor(box.y0 / cell) + 1, iy1 = Math.ceil(box.y1 / cell) - 2;
    const interior = ix1 >= ix0 && iy1 >= iy0 && ix0 >= 0 && iy0 >= 0 && ix1 < cols && iy1 < rows;
    const inInterior = (x        , y        )          => interior && x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1;
    hit.fill(0);
    if (interior) {
      b += rectSum(ix0, iy0, ix1, iy1);
      if (b >= limit) return b;
      for (let y = iy0; y <= iy1; y++) for (let x = ix0; x <= ix1; x++) {
        const c = y * cols + x;
        for (let k = vStart[c]; k < vStart[c + 1]; k++) if (vLine[k] >= 0) hit[vLine[k]] = 1;
      }
    }
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      if (inInterior(x, y)) continue;
      const c = y * cols + x;
      for (let k = vStart[c]; k < vStart[c + 1]; k++) {
        const px = vX[k], py = vY[k];
        const li = vLine[k];
        if (box.x0 < px && px < box.x1 && box.y0 < py && py < box.y1) { if (li < nCounted) b++; if (li >= 0) hit[li] = 1; if (b >= limit) return b; }
        else if (li >= 0 && box.x0 <= px && px <= box.x1 && box.y0 <= py && py <= box.y1) hit[li] = 1;
      }
    }
    for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) {
      if (inInterior(x, y)) continue;
      const c = y * cols + x;
      for (let k = sStart[c]; k < sStart[c + 1]; k++) {
        const li = sLine[k];
        if (hit[li] === 1) continue;
        const L = lines[li], i = sIdx[k];
        if (segCrossesBox(L.xs[i - 1], L.ys[i - 1], L.xs[i], L.ys[i], box)) hit[li] = 1;
      }
    }
    for (let li = 0; li < lines.length; li++) b += hit[li];
    return b;
  }
  return { badness, cells: nCells, segCells: totalS };
}
