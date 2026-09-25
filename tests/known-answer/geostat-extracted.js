// =============================================================================
// GeoSuite — Geostat functions extracted from PRODUCTION vault HTML (SSOT)
// Source: ~/orebit-ops/obsidian-system/vault/Obsidian/1. Projects/GeoSuite/
// Each function is copy-pasted verbatim with source file + line noted.
// If you edit the vault HTML, re-extract and update this file.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// 1. IDW (Inverse Distance Weighting) — power=2 default
// Source: 03-Resource/Resource.html :6590-6599
// ─────────────────────────────────────────────────────────────────────────────
function inverseDistance(neighbors, samples, p = 2) {
  if (neighbors.length === 0) return null;
  let num = 0, den = 0;
  for (const nb of neighbors) {
    const w = nb.eu === 0 ? 1e9 : 1 / Math.pow(nb.eu, p);
    num += w * samples[nb.idx].v;
    den += w;
  }
  return den > 0 ? num / den : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Nearest Neighbor
// Source: 03-Resource/Resource.html :6600-6603
// ─────────────────────────────────────────────────────────────────────────────
function nearestNeighbor(neighbors, samples) {
  if (neighbors.length === 0) return null;
  return samples[neighbors[0].idx].v;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Experimental Semivariogram (omni-directional, horizontal only)
// Source: 03-Resource/Resource.html :5219-5343 (computeVariogram, non-vert branch)
// Note: The real function is async and reads from DOM. The pure math core is
// extracted here exactly as written (lines 5300-5330).
// ─────────────────────────────────────────────────────────────────────────────
function computeExperimentalVariogram(samples, lag, nLag, maxH) {
  // samples: [{x,y,z,v}, ...]
  const bins = Array.from({ length: nLag }, () => ({ sum: 0, n: 0 }));
  const m = samples.length;
  let pairsTotal = 0;

  for (let i = 0; i < m; i++) {
    for (let j = i + 1; j < m; j++) {
      const dx = samples[j].x - samples[i].x;
      const dy = samples[j].y - samples[i].y;
      const h = Math.hypot(dx, dy);
      if (h === 0 || h > maxH) continue;
      const bin = Math.floor(h / lag);
      if (bin >= nLag) continue;
      const diff = samples[j].v - samples[i].v;
      bins[bin].sum += diff * diff;
      bins[bin].n += 1;
      pairsTotal++;
    }
  }

  const lags = [], gammas = [], pairs = [];
  for (let b = 0; b < nLag; b++) {
    if (bins[b].n >= 5) {                       // min-pairs threshold = 5 (line 5325)
      lags.push((b + 0.5) * lag);               // bin center
      gammas.push(bins[b].sum / (2 * bins[b].n)); // γ(h) = Σ(diff²)/(2n)
      pairs.push(bins[b].n);
    }
  }
  return { lags, gammas, pairs, pairsTotal };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Minimum-Curvature Desurvey (Sawaryn & Thorogood 2003, SPE 84246)
// Source: 01-Core/Core.html :7956-7997 (traceFromSurveys)
// Note: The real function reads collar.x/y/z and surveys array with dip/azimuth.
// It uses incFromVert() closure from computeDesurvey (line 7885-7887).
// We inline the 'negative_down' convention (dip=-90 vertical) used by default.
// ─────────────────────────────────────────────────────────────────────────────
function traceFromSurveys(collar, surveys, incFromVert) {
  // Minimum Curvature method (Sawaryn & Thorogood, 2003 SPE 84246)
  // Z increases up; we subtract TVD (true vertical depth = projection of MD onto vertical axis).
  const trace = [];
  let X = Number(collar.x) || 0;
  let Y = Number(collar.y) || 0;
  let Z = Number(collar.z) || 0;
  trace.push({ depth: 0, x: X, y: Y, z: Z });

  for (let i = 0; i < surveys.length - 1; i++) {
    const s1 = surveys[i], s2 = surveys[i+1];
    const md1 = s1.depth, md2 = s2.depth;
    if (md2 <= md1) continue;
    const dMD = md2 - md1;
    const inc1 = incFromVert(s1.dip);
    const inc2 = incFromVert(s2.dip);
    const az1 = Math.PI / 180 * s1.azimuth;
    const az2 = Math.PI / 180 * s2.azimuth;
    const cosBeta = Math.cos(inc2 - inc1) - Math.sin(inc1) * Math.sin(inc2) * (1 - Math.cos(az2 - az1));
    const beta = Math.acos(Math.max(-1, Math.min(1, cosBeta)));
    const RF = (Math.abs(beta) < 1e-6) ? 1 : (2 / beta) * Math.tan(beta / 2);
    const dN = dMD / 2 * (Math.sin(inc1) * Math.cos(az1) + Math.sin(inc2) * Math.cos(az2)) * RF;
    const dE = dMD / 2 * (Math.sin(inc1) * Math.sin(az1) + Math.sin(inc2) * Math.sin(az2)) * RF;
    const dTVD = dMD / 2 * (Math.cos(inc1) + Math.cos(inc2)) * RF;
    X += dE; Y += dN; Z -= dTVD;
    trace.push({ depth: md2, x: X, y: Y, z: Z });
  }
  // Extend final segment to total_depth if collar.depth > last survey depth
  const totalDepth = Number(collar.depth);
  const lastSurvey = surveys[surveys.length - 1];
  if (totalDepth && totalDepth > lastSurvey.depth + 0.01) {
    const dMD = totalDepth - lastSurvey.depth;
    const inc = incFromVert(lastSurvey.dip);
    const az = Math.PI / 180 * lastSurvey.azimuth;
    const dN = dMD * Math.sin(inc) * Math.cos(az);
    const dE = dMD * Math.sin(inc) * Math.sin(az);
    const dTVD = dMD * Math.cos(inc);
    X += dE; Y += dN; Z -= dTVD;
    trace.push({ depth: totalDepth, x: X, y: Y, z: Z });
  }
  return trace;
}

// Helper: dip convention converter exactly as in Core.html :7885-7887
// 'negative_down' means dip=-90 is vertical (default when median dip < 0).
// incFromVert: vertical down → 0 rad, horizontal → π/2 rad.
function incFromVert_negativeDown(dip) {
  return Math.PI / 180 * (90 + dip);  // dip=-90 → 0 (vertical), dip=0 → π/2 (horizontal)
}
function incFromVert_positiveDown(dip) {
  return Math.PI / 180 * (90 - dip);  // dip=90 → 0 (vertical), dip=0 → π/2 (horizontal)
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Length-Weighted Compositing
// Source: 01-Core/Core.html :8257-8343 (computeComposites)
// Note: The real function reads STATE.merged and uses DOM. The pure math core
// for a single composite bin is extracted here (lines 8289-8337).
// ─────────────────────────────────────────────────────────────────────────────
function lengthWeightedComposite(rows, start, end, gradeCols) {
  // rows: [{from_m, to_m, midx, midy, midz, lithology, <gradeCols...>}, ...]
  let totalWeight = 0;
  const gradeSums = {};
  const gradeWeights = {};
  gradeCols.forEach(c => { gradeSums[c] = 0; gradeWeights[c] = 0; });
  let bestLith = null, bestOverlap = 0;
  let midxSum = 0, midySum = 0, midzSum = 0, xyzWeight = 0;

  rows.forEach(r => {
    const rf = Number(r.from_m), rt = Number(r.to_m);
    const overlapStart = Math.max(start, rf);
    const overlapEnd = Math.min(end, rt);
    const overlap = overlapEnd - overlapStart;
    if (overlap <= 0) return;

    totalWeight += overlap;
    gradeCols.forEach(c => {
      const v = Number(r[c]);
      if (isFinite(v)) { gradeSums[c] += v * overlap; gradeWeights[c] += overlap; }
    });

    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestLith = r.lithology || null;
    }

    if (r.midx != null && r.midy != null && r.midz != null) {
      midxSum += r.midx * overlap;
      midySum += r.midy * overlap;
      midzSum += r.midz * overlap;
      xyzWeight += overlap;
    }
  });

  if (totalWeight <= 0) return null;

  const compRow = {
    from_m: start,
    to_m: end,
    midx: xyzWeight > 0 ? midxSum / xyzWeight : null,
    midy: xyzWeight > 0 ? midySum / xyzWeight : null,
    midz: xyzWeight > 0 ? midzSum / xyzWeight : null,
    lithology: bestLith,
  };
  let minRecovery = 1;
  gradeCols.forEach(c => {
    const w = gradeWeights[c];
    compRow[c] = w > 0 ? gradeSums[c] / w : null;
    const rec = totalWeight > 0 ? w / totalWeight : 0;
    if (compRow[c] != null && rec < minRecovery) minRecovery = rec;
  });
  compRow.recovery_pct = Math.round(minRecovery * 1000) / 10;
  return compRow;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Ordinary Kriging (for completeness — the actual production OK)
// Source: 03-Resource/Resource.html :6545-6589
// Requires: gammaAniso, solveLinearFlat (also extracted below)
// ─────────────────────────────────────────────────────────────────────────────
function ordinaryKriging(neighbors, x, y, z, samples, model, anis, buffers) {
  const n = neighbors.length;
  if (n === 0) return null;
  const dim = n + 1;
  let Abuf, xBuf, bRhs;
  if (buffers) {
    Abuf = buffers.A; xBuf = buffers.x; bRhs = buffers.b;
  } else {
    Abuf = new Float64Array(dim * (dim + 1));
    xBuf = new Float64Array(dim);
    bRhs = new Float64Array(dim);
  }
  const stride = dim + 1;
  for (let i = 0; i < n; i++) {
    const si = samples[neighbors[i].idx];
    Abuf[i * stride + i] = 1e-9;
    Abuf[i * stride + n] = 1;
    for (let j = i + 1; j < n; j++) {
      const sj = samples[neighbors[j].idx];
      const g = gammaAniso(si.x - sj.x, si.y - sj.y, si.z - sj.z, model, anis);
      Abuf[i * stride + j] = g;
      Abuf[j * stride + i] = g;
    }
    const bg = gammaAniso(si.x - x, si.y - y, si.z - z, model, anis);
    bRhs[i] = bg;
    Abuf[i * stride + dim] = bg;
  }
  for (let j = 0; j < n; j++) Abuf[n * stride + j] = 1;
  Abuf[n * stride + n] = 0;
  bRhs[n] = 1;
  Abuf[n * stride + dim] = 1;
  if (!solveLinearFlat(Abuf, dim, xBuf)) return null;
  let est = 0;
  for (let i = 0; i < n; i++) est += xBuf[i] * samples[neighbors[i].idx].v;
  let variance = xBuf[n];
  for (let i = 0; i < n; i++) variance += xBuf[i] * bRhs[i];
  const weights = new Array(n);
  for (let i = 0; i < n; i++) weights[i] = xBuf[i];
  return { value: est, variance: Math.max(0, variance), weights };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Variogram model evaluator (spherical/exponential/gaussian)
// Source: 03-Resource/Resource.html :5450-5479
// ─────────────────────────────────────────────────────────────────────────────
function variogramModelEval(h, model) {
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

// ─────────────────────────────────────────────────────────────────────────────
// 8. gammaUnit — normalized variogram shape (h normalized to range=1)
// Source: 03-Resource/Resource.html :6298-6305
// ─────────────────────────────────────────────────────────────────────────────
function gammaUnit(h, type) {
  if (h <= 0) return 0;
  if (type === 'spherical') return h >= 1 ? 1 : (1.5 * h - 0.5 * h * h * h);
  if (type === 'exponential') return 1 - Math.exp(-3 * h);
  if (type === 'gaussian') return 1 - Math.exp(-3 * h * h);
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. gammaUnitOfStruct — same as gammaUnit but for nested structures
// Source: 03-Resource/Resource.html :6119-6127
// ─────────────────────────────────────────────────────────────────────────────
function gammaUnitOfStruct(h, type) {
  if (h <= 0) return 0;
  if (type === 'spherical') return h >= 1 ? 1 : (1.5 * h - 0.5 * h * h * h);
  if (type === 'exponential') return 1 - Math.exp(-3 * h);
  if (type === 'gaussian') return 1 - Math.exp(-3 * h * h);
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. rotateAniso + gammaAniso + ellipsoidDist (kriging helpers)
// Source: 03-Resource/Resource.html :6306-6352
// ─────────────────────────────────────────────────────────────────────────────
function rotateAniso(dx, dy, dz, azDeg, dipDeg) {
  const az = azDeg * Math.PI / 180;
  const dip = dipDeg * Math.PI / 180;
  const cosA = Math.cos(az), sinA = Math.sin(az);
  const xMaj = sinA * dx + cosA * dy;
  const ySemi = cosA * dx - sinA * dy;
  const cosD = Math.cos(dip), sinD = Math.sin(dip);
  const xMaj2 = cosD * xMaj + sinD * dz;
  const zMin = -sinD * xMaj + cosD * dz;
  return { maj: xMaj2, semi: ySemi, min: zMin };
}

function gammaAniso(dx, dy, dz, model, anis) {
  if (model.struct1) {
    const azDeg = (model.azDeg !== undefined ? model.azDeg : anis.azDeg) || 0;
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
  const r = rotateAniso(dx, dy, dz, anis.azDeg, anis.dipDeg);
  const h = Math.sqrt((r.maj / anis.rMaj) ** 2 + (r.semi / anis.rSemi) ** 2 + (r.min / anis.rMin) ** 2);
  return model.nugget + (model.sill - model.nugget) * gammaUnit(h, model.type);
}

function ellipsoidDist(dx, dy, dz, anis) {
  const r = rotateAniso(dx, dy, dz, anis.azDeg, anis.dipDeg);
  return Math.sqrt((r.maj / anis.rMaj) ** 2 + (r.semi / anis.rSemi) ** 2 + (r.min / anis.rMin) ** 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. solveLinearFlat — Gaussian elimination for kriging matrix
// Source: 03-Resource/Resource.html :6498-6532
// ─────────────────────────────────────────────────────────────────────────────
function solveLinearFlat(Abuf, dim, xOut) {
  const stride = dim + 1;
  for (let i = 0; i < dim; i++) {
    let mx = Math.abs(Abuf[i * stride + i]); let pivot = i;
    for (let k = i + 1; k < dim; k++) {
      const v = Math.abs(Abuf[k * stride + i]);
      if (v > mx) { mx = v; pivot = k; }
    }
    if (pivot !== i) {
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
  // Back-substitution
  for (let i = dim - 1; i >= 0; i--) {
    let s = Abuf[i * stride + dim];
    for (let j = i + 1; j < dim; j++) s -= Abuf[i * stride + j] * xOut[j];
    xOut[i] = s / Abuf[i * stride + i];
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. solveLinear — wrapper that allocates and calls solveLinearFlat
// Source: 03-Resource/Resource.html :6533-6544
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// 13. getSamples — build sample list with co-located jitter (used by IDW/NN/OK)
// Source: 03-Resource/Resource.html :6606-6627
// ─────────────────────────────────────────────────────────────────────────────
function getSamples(rows, eli, xi, yi, zi, hi) {
  const out = [];
  const seen = new Map();
  for (const r of rows) {
    const v = asNum(r[eli]);
    const x = asNum(r[xi]), y = asNum(r[yi]), z = asNum(r[zi]);
    if (v === null || x === null || y === null || z === null) continue;
    const key = `${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    const jx = x + count * 0.001;
    const jy = y + count * 0.001;
    const jz = z + count * 0.001;
    out.push({ x: jx, y: jy, z: jz, v, rid: r[hi] });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. asNum — strict numeric parser used by getSamples
// Source: 03-Resource/Resource.html :3883-3887
// ─────────────────────────────────────────────────────────────────────────────
function asNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 15. neighborsAround — spatial hash + ellipsoid search (simplified for tests)
// Source: 03-Resource/Resource.html :6373-6493
// This is the full production neighbor search with octant logic.
// ─────────────────────────────────────────────────────────────────────────────
function _cellHash(cx, cy, cz) {
  return (((cx | 0) * 73856093) ^ ((cy | 0) * 19349663) ^ ((cz | 0) * 83492791)) | 0;
}

function buildSampleIndex(samples, cellSize) {
  const grid = new Map();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const cx = Math.floor(s.x / cellSize);
    const cy = Math.floor(s.y / cellSize);
    const cz = Math.floor(s.z / cellSize);
    const k = _cellHash(cx, cy, cz);
    let bucket = grid.get(k);
    if (!bucket) { bucket = []; grid.set(k, bucket); }
    bucket.push(i);
  }
  return { grid, cellSize };
}

function neighborsAround(idx, x, y, z, samples, search) {
  const maxR = Math.max(search.rMaj, search.rSemi, search.rMin);
  const cs = idx.cellSize;
  const ncx = Math.floor(x / cs), ncy = Math.floor(y / cs), ncz = Math.floor(z / cs);
  const span = Math.ceil(maxR / cs);
  const maxN = search.maxNeighbors;
  const useOctant = search.useOctant === true;
  const perOctantMax = useOctant ? Math.max(2, Math.ceil(maxN / 2)) : maxN;

  const topIdx = new Int32Array(maxN + 1);
  const topNd = new Float64Array(maxN + 1);
  const topEu = new Float64Array(maxN + 1);
  let cnt = 0;

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
            const oct = (ddx >= 0 ? 1 : 0) | (ddy >= 0 ? 2 : 0) | (ddz >= 0 ? 4 : 0);
            const oc = octCnt[oct];
            if (oc < perOctantMax) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Node.js test runner
// ─────────────────────────────────────────────────────────────────────────────
export {
  inverseDistance,
  nearestNeighbor,
  computeExperimentalVariogram,
  traceFromSurveys,
  incFromVert_negativeDown,
  incFromVert_positiveDown,
  lengthWeightedComposite,
  ordinaryKriging,
  variogramModelEval,
  gammaUnit,
  gammaUnitOfStruct,
  rotateAniso,
  gammaAniso,
  ellipsoidDist,
  solveLinearFlat,
  solveLinear,
  getSamples,
  asNum,
  _cellHash,
  buildSampleIndex,
  neighborsAround,
};
