// Isolated pure geostatistics engine: typed arrays / plain objects in,
// plain objects out. No UI, no rendering, no global state.
// Prepared for a future Rust/WASM port. Behaviour-identical to the
// previously-inline copies (baseline: _meta/tests/fixtures/task7-baseline.json).
(function () {
function variogramModelEval(h, model) {
 // Backward-compatible: works for legacy single-structure model AND nested {struct1, struct2}.
 // For nested, h is treated as distance along the MAJOR axis (rangeMaj).
 const { nugget } = model;
 if (h <= 0) return 0;
 if (model.struct1) {
 let g = nugget;
 const s1 = model.struct1;
 g += s1.psill * gammaUnitOfStruct(h / Math.max(0.001, s1.rangeMaj), s1.type);
 if (model.struct2) {
 const s2 = model.struct2;
 g += s2.psill * gammaUnitOfStruct(h / Math.max(0.001, s2.rangeMaj), s2.type);
 }
 return g;
 }
 // legacy single-structure
 const { type, sill, range } = model;
 const partialSill = sill - nugget;
 switch (type) {
 case 'spherical':
 if (h >= range) return sill;
 return nugget + partialSill * (1.5 * (h / range) - 0.5 * Math.pow(h / range, 3));
 case 'exponential':
 return nugget + partialSill * (1 - Math.exp(-3 * h / range));
 case 'gaussian':
 return nugget + partialSill * (1 - Math.exp(-3 * Math.pow(h / range, 2)));
 default:
 return nugget;
 }
}

function gammaAniso(dx, dy, dz, model, anis) {
 // Nested model with explicit per-structure anisotropic ranges (Rossi & Deutsch 2014).
 // Uses model.azDeg if present, else falls back to anis.azDeg (search ellipsoid heading).
 if (model.struct1) {
 const azDeg = (model.azDeg!== undefined? model.azDeg : anis.azDeg) || 0;
 const r = rotateAniso(dx, dy, dz, azDeg, anis.dipDeg || 0);
 const s1 = model.struct1;
 const h1 = Math.sqrt(
 (r.maj / Math.max(0.001, s1.rangeMaj)) ** 2 +
 (r.semi / Math.max(0.001, s1.rangeMin)) ** 2 +
 (r.min / Math.max(0.001, s1.rangeVert)) ** 2
);
 let g = model.nugget + s1.psill * gammaUnit(h1, s1.type);
 if (model.struct2) {
 const s2 = model.struct2;
 const h2 = Math.sqrt(
 (r.maj / Math.max(0.001, s2.rangeMaj)) ** 2 +
 (r.semi / Math.max(0.001, s2.rangeMin)) ** 2 +
 (r.min / Math.max(0.001, s2.rangeVert)) ** 2
);
 g += s2.psill * gammaUnit(h2, s2.type);
 }
 return g;
 }
 // legacy single-structure: anisotropy borrowed from search ellipsoid
 const r = rotateAniso(dx, dy, dz, anis.azDeg, anis.dipDeg);
 const h = Math.sqrt((r.maj / anis.rMaj) ** 2 + (r.semi / anis.rSemi) ** 2 + (r.min / anis.rMin) ** 2);
 return model.nugget + (model.sill - model.nugget) * gammaUnit(h, model.type);
}

function ellipsoidDist(dx, dy, dz, anis) {
 const r = rotateAniso(dx, dy, dz, anis.azDeg, anis.dipDeg);
 return Math.sqrt((r.maj / anis.rMaj) ** 2 + (r.semi / anis.rSemi) ** 2 + (r.min / anis.rMin) ** 2);
}

function neighborsAround(idx, x, y, z, samples, search) {
  // bbox = max search radii in each axis (worst case = rMaj along any direction)
  const maxR = Math.max(search.rMaj, search.rSemi, search.rMin);
  const cs = idx.cellSize;
  const ncx = Math.floor(x / cs), ncy = Math.floor(y / cs), ncz = Math.floor(z / cs);
  const span = Math.ceil(maxR / cs);
  const maxN = search.maxNeighbors;

  // Sprint C: Octant search — divide search ellipsoid into 8 octants
  // (4 horizontal quadrants × 2 vertical halves) and limit per-octant
  // contributions to ensure spatially balanced neighbor selection.
  // This prevents grade bias from clustered sampling in one direction.
  const useOctant = search.useOctant === true;
  const perOctantMax = useOctant ? Math.max(2, Math.ceil(maxN / 2)) : maxN;

  // Insertion-sorted top-k buffer of length maxN+1 (drop tail when full).
  const topIdx = new Int32Array(maxN + 1);
  const topNd = new Float64Array(maxN + 1);
  const topEu = new Float64Array(maxN + 1);
  let cnt = 0;

  // Octant buffers: 8 octants, each holding up to perOctantMax candidates
  // Octant index = (dx>=0 ? 1:0) | (dy>=0 ? 2:0) | (dz>=0 ? 4:0)
  let octIdx, octNd, octEu, octCnt;
  if (useOctant) {
    octIdx = Array.from({length: 8}, () => new Int32Array(perOctantMax));
    octNd  = Array.from({length: 8}, () => new Float64Array(perOctantMax));
    octEu  = Array.from({length: 8}, () => new Float64Array(perOctantMax));
    octCnt = new Int32Array(8);
  }

  const grid = idx.grid;
  for (let dx = -span; dx <= span; dx++) {
    for (let dy = -span; dy <= span; dy++) {
      for (let dz = -span; dz <= span; dz++) {
        const k = _cellHash(ncx + dx, ncy + dy, ncz + dz);
        const list = grid.get(k);
        if (!list) continue;
        for (let li = 0; li < list.length; li++) {
          const si = list[li];
          const s = samples[si];
          const ddx = s.x - x, ddy = s.y - y, ddz = s.z - z;
          const ndist = ellipsoidDist(ddx, ddy, ddz, search);
          if (ndist > 1.0) continue;
          const eu = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);

          if (useOctant) {
            // Determine octant from the un-rotated spatial relationship
            const oct = (ddx >= 0 ? 1 : 0) | (ddy >= 0 ? 2 : 0) | (ddz >= 0 ? 4 : 0);
            const oc = octCnt[oct];
            if (oc < perOctantMax) {
              // Insert into octant buffer (insertion sort by ndist)
              let pos = oc;
              while (pos > 0 && octNd[oct][pos - 1] > ndist) {
                octNd[oct][pos] = octNd[oct][pos - 1];
                octIdx[oct][pos] = octIdx[oct][pos - 1];
                octEu[oct][pos] = octEu[oct][pos - 1];
                pos--;
              }
              octNd[oct][pos] = ndist;
              octIdx[oct][pos] = si;
              octEu[oct][pos] = eu;
              octCnt[oct]++;
            } else if (ndist < octNd[oct][perOctantMax - 1]) {
              // Better than worst in this octant — insert and drop tail
              let pos = perOctantMax - 1;
              while (pos > 0 && octNd[oct][pos - 1] > ndist) {
                octNd[oct][pos] = octNd[oct][pos - 1];
                octIdx[oct][pos] = octIdx[oct][pos - 1];
                octEu[oct][pos] = octEu[oct][pos - 1];
                pos--;
              }
              octNd[oct][pos] = ndist;
              octIdx[oct][pos] = si;
              octEu[oct][pos] = eu;
            }
          } else {
            // Standard non-octant: global top-k
            if (cnt === maxN && ndist >= topNd[maxN - 1]) continue;
            let pos = cnt < maxN ? cnt : maxN - 1;
            while (pos > 0 && topNd[pos - 1] > ndist) {
              topNd[pos] = topNd[pos - 1];
              topIdx[pos] = topIdx[pos - 1];
              topEu[pos] = topEu[pos - 1];
              pos--;
            }
            topNd[pos] = ndist;
            topIdx[pos] = si;
            topEu[pos] = eu;
            if (cnt < maxN) cnt++;
          }
        }
      }
    }
  }

  if (useOctant) {
    // Merge octant buffers into global top-k by ndist
    for (let o = 0; o < 8; o++) {
      for (let j = 0; j < octCnt[o]; j++) {
        const nd = octNd[o][j];
        if (cnt === maxN && nd >= topNd[maxN - 1]) continue;
        let pos = cnt < maxN ? cnt : maxN - 1;
        while (pos > 0 && topNd[pos - 1] > nd) {
          topNd[pos] = topNd[pos - 1];
          topIdx[pos] = topIdx[pos - 1];
          topEu[pos] = topEu[pos - 1];
          pos--;
        }
        topNd[pos] = nd;
        topIdx[pos] = octIdx[o][j];
        topEu[pos] = octEu[o][j];
        if (cnt < maxN) cnt++;
      }
    }
  }

  const out = new Array(cnt);
  for (let i = 0; i < cnt; i++) out[i] = { idx: topIdx[i], ndist: topNd[i], eu: topEu[i] };
  return out;
}

function ordinaryKriging(neighbors, x, y, z, samples, model, anis, buffers) {
 const n = neighbors.length;
 if (n === 0) return null;
 const dim = n + 1;
 // Either reuse caller-provided buffers or allocate ad-hoc.
 let Abuf, xBuf, bRhs;
 if (buffers) {
 Abuf = buffers.A; xBuf = buffers.x; bRhs = buffers.b;
 } else {
 Abuf = new Float64Array(dim * (dim + 1));
 xBuf = new Float64Array(dim);
 bRhs = new Float64Array(dim);
 }
 const stride = dim + 1;
 // Fill A row-major: A[i][j], plus augmented column [i][dim]=b[i].
 for (let i = 0; i < n; i++) {
 const si = samples[neighbors[i].idx];
 Abuf[i * stride + i] = 1e-9; // ε on diagonal for numeric stability (pivot guard)
 Abuf[i * stride + n] = 1; // last column (Lagrange)
 for (let j = i + 1; j < n; j++) {
 const sj = samples[neighbors[j].idx];
 const g = gammaAniso(si.x - sj.x, si.y - sj.y, si.z - sj.z, model, anis);
 Abuf[i * stride + j] = g;
 Abuf[j * stride + i] = g;
 }
 const bg = gammaAniso(si.x - x, si.y - y, si.z - z, model, anis);
 bRhs[i] = bg;
 Abuf[i * stride + dim] = bg; // augmented RHS
 }
 // last row: ones, last cell = 0, rhs = 1
 for (let j = 0; j < n; j++) Abuf[n * stride + j] = 1;
 Abuf[n * stride + n] = 0;
 bRhs[n] = 1;
 Abuf[n * stride + dim] = 1;
 if (!solveLinearFlat(Abuf, dim, xBuf)) return null;
 // Estimate + variance
 let est = 0;
 for (let i = 0; i < n; i++) est += xBuf[i] * samples[neighbors[i].idx].v;
 let variance = xBuf[n]; // Lagrange multiplier
 for (let i = 0; i < n; i++) variance += xBuf[i] * bRhs[i];
 // Caller can read weights from xBuf[0..n-1] if reused; we copy small slice to avoid surprises.
 const weights = new Array(n);
 for (let i = 0; i < n; i++) weights[i] = xBuf[i];
 // Kriging weights can be negative (Sinclair & Blackwell 2002 §8.4), which on
 // grade data occasionally produces a negative estimate even though every
 // input sample is non-negative -- typically an under-fit variogram model or
 // a search radius reaching well past the variogram range. Grades cannot be
 // negative -- negative grade codes are resolved on import for the same
 // reason (shared/io/grades.js) -- so clamp here, at the single choke point all three callers
 // (main estimation, sensitivity analysis, cross-validation) already share.
 const clamped = est < 0;
 return { value: clamped ? 0 : est, variance: Math.max(0, variance), weights, clamped };
}

function nearestNeighbor(neighbors, samples) {
 if (neighbors.length === 0) return null;
 return samples[neighbors[0].idx].v;
}

  window.OrebitGeostat = { variogramModelEval: variogramModelEval, gammaAniso: gammaAniso, ellipsoidDist: ellipsoidDist, neighborsAround: neighborsAround, ordinaryKriging: ordinaryKriging, nearestNeighbor: nearestNeighbor };
})();
// Top-level aliases keep every existing call site working unchanged.
var variogramModelEval = window.OrebitGeostat.variogramModelEval;
var gammaAniso = window.OrebitGeostat.gammaAniso;
var ellipsoidDist = window.OrebitGeostat.ellipsoidDist;
var neighborsAround = window.OrebitGeostat.neighborsAround;
var ordinaryKriging = window.OrebitGeostat.ordinaryKriging;
var nearestNeighbor = window.OrebitGeostat.nearestNeighbor;
function gammaUnitOfStruct(h, type) {
 if (h <= 0) return 0;
 if (type === 'spherical') return h >= 1? 1 : (1.5 * h - 0.5 * h * h * h);
 if (type === 'exponential') return 1 - Math.exp(-3 * h);
 if (type === 'gaussian') return 1 - Math.exp(-3 * h * h);
 return 1;
}

function gammaUnit(h, type) {
 // h normalized to range=1
 if (h <= 0) return 0;
 if (type === 'spherical') return h >= 1? 1 : (1.5 * h - 0.5 * h * h * h);
 if (type === 'exponential') return 1 - Math.exp(-3 * h);
 if (type === 'gaussian') return 1 - Math.exp(-3 * h * h);
 return 1;
}
function rotateAniso(dx, dy, dz, azDeg, dipDeg) {
 // Mining convention: azimuth measured clockwise from N (Y-axis).
 const az = azDeg * Math.PI / 180;
 const dip = dipDeg * Math.PI / 180;
 // Rotate around Z so that "major" axis aligns with given azimuth
 const cosA = Math.cos(az), sinA = Math.sin(az);
 const xMaj = sinA * dx + cosA * dy; // along azimuth
 const ySemi = cosA * dx - sinA * dy; // perpendicular horizontal
 // Apply dip around semi-axis
 const cosD = Math.cos(dip), sinD = Math.sin(dip);
 const xMaj2 = cosD * xMaj + sinD * dz;
 const zMin = -sinD * xMaj + cosD * dz;
 return { maj: xMaj2, semi: ySemi, min: zMin };
}
function _cellHash(cx, cy, cz) {
 // 32-bit integer hash; collisions OK because we always verify with ellipsoid distance.
 return (((cx | 0) * 73856093) ^ ((cy | 0) * 19349663) ^ ((cz | 0) * 83492791)) | 0;
}
function solveLinearFlat(Abuf, dim, xOut) {
 const stride = dim + 1;
 for (let i = 0; i < dim; i++) {
 // Partial pivot
 let mx = Math.abs(Abuf[i * stride + i]); let pivot = i;
 for (let k = i + 1; k < dim; k++) {
 const v = Math.abs(Abuf[k * stride + i]);
 if (v > mx) { mx = v; pivot = k; }
 }
 if (pivot!== i) {
 // swap rows
 for (let j = 0; j < stride; j++) {
 const tmp = Abuf[i * stride + j];
 Abuf[i * stride + j] = Abuf[pivot * stride + j];
 Abuf[pivot * stride + j] = tmp;
 }
 }
 const piv = Abuf[i * stride + i];
 if (Math.abs(piv) < 1e-12) return false;
 for (let k = i + 1; k < dim; k++) {
 const f = Abuf[k * stride + i] / piv;
 if (f === 0) continue;
 for (let j = i; j < stride; j++) Abuf[k * stride + j] -= f * Abuf[i * stride + j];
 }
 }
 // Back substitution
 for (let i = dim - 1; i >= 0; i--) {
 let s = Abuf[i * stride + dim];
 for (let j = i + 1; j < dim; j++) s -= Abuf[i * stride + j] * xOut[j];
 xOut[i] = s / Abuf[i * stride + i];
 }
 return true;
}

function solveLinear(A, b) {
 const n = A.length;
 const Abuf = new Float64Array(n * (n + 1));
 for (let i = 0; i < n; i++) {
 for (let j = 0; j < n; j++) Abuf[i * (n + 1) + j] = A[i][j];
 Abuf[i * (n + 1) + n] = b[i];
 }
 const x = new Float64Array(n);
 if (!solveLinearFlat(Abuf, n, x)) return null;
 return Array.from(x);
}
