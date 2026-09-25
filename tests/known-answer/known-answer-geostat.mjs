#!/usr/bin/env node
/**
 * known-answer-geostat.mjs — Golden-value tests for GeoSuite geostatistics.
 *
 * These tests run the REAL functions extracted from production vault HTML
 * (geostat-extracted.js) against hand-computed expected values. If someone
 * changes the geostat math in the vault HTML and re-extracts, a wrong result
 * FAILS loudly here.
 *
 * Run: node known-answer-geostat.mjs
 * Exit: 0 = all pass, 1 = any failure.
 */

import * as G from './geostat-extracted.js';

let passed = 0, failed = 0;
const TOL = 1e-6;

function approx(name, actual, expected, tol = TOL) {
  const ok = actual != null && Math.abs(actual - expected) <= tol;
  if (ok) { passed++; console.log(`  ✅ ${name}: ${actual} ≈ ${expected}`); }
  else    { failed++; console.log(`  ❌ ${name}: got ${actual}, expected ${expected}`); }
  return ok;
}
function eq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ✅ ${name}: ${JSON.stringify(actual)}`); }
  else    { failed++; console.log(`  ❌ ${name}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`); }
  return ok;
}
function section(t) { console.log(`\n── ${t} ──`); }

// ─────────────────────────────────────────────────────────────────────────────
// 1. IDW (power=2)
// ─────────────────────────────────────────────────────────────────────────────
// inverseDistance(neighbors, samples, p=2) uses nb.eu = euclidean distance,
// samples[nb.idx].v = value. weight = 1/d^2.
section('IDW (power=2)');

// Samples: A at v=10, B at v=20. Query equidistant → simple average = 15.
{
  const samples = [{ v: 10 }, { v: 20 }];
  const neighbors = [
    { idx: 0, eu: 1 },   // distance 1
    { idx: 1, eu: 1 },   // distance 1
  ];
  // w = 1/1^2 = 1 each. num = 1*10 + 1*20 = 30, den = 2 → 15.
  approx('equidistant 2 samples', G.inverseDistance(neighbors, samples, 2), 15);
}

// 3 points, distances 1, 2, 4. values 8, 4, 2. Hand-compute:
// w1=1/1=1, w2=1/4=0.25, w3=1/16=0.0625
// num = 1*8 + 0.25*4 + 0.0625*2 = 8 + 1 + 0.125 = 9.125
// den = 1 + 0.25 + 0.0625 = 1.3125 → 9.125/1.3125 = 6.952380952...
{
  const samples = [{ v: 8 }, { v: 4 }, { v: 2 }];
  const neighbors = [
    { idx: 0, eu: 1 },
    { idx: 1, eu: 2 },
    { idx: 2, eu: 4 },
  ];
  approx('3 samples d=1,2,4', G.inverseDistance(neighbors, samples, 2), 9.125 / 1.3125);
}

// Empty neighbors → null
{
  eq('empty neighbors → null', G.inverseDistance([], [{ v: 1 }], 2), null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Nearest Neighbor
// ─────────────────────────────────────────────────────────────────────────────
section('Nearest Neighbor');
{
  // neighbors[0] must be the closest (sorted by eu ascending).
  const samples = [{ v: 111 }, { v: 222 }, { v: 333 }];
  const neighbors = [
    { idx: 2, eu: 0.5 },  // closest
    { idx: 0, eu: 3 },
    { idx: 1, eu: 7 },
  ];
  eq('picks neighbors[0] value', G.nearestNeighbor(neighbors, samples), 333);
  eq('empty → null', G.nearestNeighbor([], samples), null);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Experimental Variogram
// ─────────────────────────────────────────────────────────────────────────────
// computeExperimentalVariogram(samples, lag, nLag, maxH)
// γ(h) = Σ(diff²)/(2n), bin center = (b+0.5)*lag, requires n>=5 pairs.
section('Experimental Variogram');

// Build 5 samples along a line so pairs land in known bins.
// Points at x=0,1,2,3,4 (y=0), values chosen so we can predict γ.
// With lag=1, nLag=6, maxH=10:
//   distances: 1 (4 pairs), 2 (3 pairs), 3 (2 pairs), 4 (1 pair)
//   Only distance-1 bin has >=5? No → 4 pairs < 5, so NO bin qualifies.
{
  const samples = [0,1,2,3,4].map(x => ({ x, y: 0, z: 0, v: x * 2 }));
  const r = G.computeExperimentalVariogram(samples, 1, 6, 10);
  eq('under min-pairs → no lags', r.lags.length, 0);
}

// 6 collinear points spaced 1 apart → distance-1 pairs = 5 (qualifies, n>=5).
// values v = x  → diff for distance-1 pairs = 1 → diff²=1, sum=5, n=5 → γ=5/(2*5)=0.5
// h=1 → bin = floor(1/1) = 1 → bin center = (1+0.5)*1 = 1.5 (bin [1,2) labeled by center).
{
  const samples = [0,1,2,3,4,5].map(x => ({ x, y: 0, z: 0, v: x }));
  const r = G.computeExperimentalVariogram(samples, 1, 6, 10);
  eq('one qualifying bin', r.lags.length, 1);
  approx('lag bin center (h=1 → bin[1,2) center)', r.lags[0], 1.5);
  approx('γ(1) for unit slope', r.gammas[0], 0.5);
  eq('pairs count', r.pairs[0], 5);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Desurvey (Minimum Curvature)
// ─────────────────────────────────────────────────────────────────────────────
// traceFromSurveys(collar, surveys, incFromVert). collar={x,y,z,depth}.
// surveys = [{depth, dip, azimuth}, ...]. incFromVert_negativeDown: dip=-90→vertical.
section('Desurvey (Minimum Curvature)');

// Vertical hole: dip=-90 (straight down), single survey segment 0→100.
// inc = incFromVert_negativeDown(-90) = (90 + -90)° = 0 rad.
// sin(inc)=0 → dN=dE=0. cos(inc)=1 → dTVD = dMD. Z = z - 100.
{
  const collar = { x: 1000, y: 2000, z: 500, depth: 100 };
  const surveys = [
    { depth: 0,   dip: -90, azimuth: 0 },
    { depth: 100, dip: -90, azimuth: 0 },
  ];
  const trace = G.traceFromSurveys(collar, surveys, G.incFromVert_negativeDown);
  const end = trace[trace.length - 1];
  approx('vertical X unchanged', end.x, 1000);
  approx('vertical Y unchanged', end.y, 2000);
  approx('vertical Z = z - depth', end.z, 400);
}

// Horizontal hole: dip=0 (inc=π/2), azimuth=90 (East), 0→100.
// dE = dMD (East), dN=0, dTVD=0.
{
  const collar = { x: 0, y: 0, z: 0, depth: 100 };
  const surveys = [
    { depth: 0,   dip: 0, azimuth: 90 },
    { depth: 100, dip: 0, azimuth: 90 },
  ];
  const trace = G.traceFromSurveys(collar, surveys, G.incFromVert_negativeDown);
  const end = trace[trace.length - 1];
  approx('horizontal-East X += 100', end.x, 100, 1e-4);
  approx('horizontal-East Y ≈ 0', end.y, 0, 1e-4);
  approx('horizontal-East Z ≈ 0', end.z, 0, 1e-4);
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Length-Weighted Compositing
// ─────────────────────────────────────────────────────────────────────────────
// lengthWeightedComposite(rows, start, end, gradeCols)
section('Compositing (length-weighted)');

// 3 intervals [0-1]g=2, [1-3]g=5, [3-4]g=8. Composite 0-4:
// weights 1,2,1 → (2*1 + 5*2 + 8*1)/4 = (2+10+8)/4 = 20/4 = 5
{
  const rows = [
    { from_m: 0, to_m: 1, AU: 2, lithology: 'A' },
    { from_m: 1, to_m: 3, AU: 5, lithology: 'B' },
    { from_m: 3, to_m: 4, AU: 8, lithology: 'C' },
  ];
  const comp = G.lengthWeightedComposite(rows, 0, 4, ['AU']);
  approx('length-weighted grade', comp.AU, 5);
  eq('dominant lithology (longest overlap)', comp.lithology, 'B');
  eq('full recovery', comp.recovery_pct, 100);
}

// Partial grade coverage: rows [0-2] CU=4 but the [1-2] row has NO CU value.
// composite 0-2: totalWeight=2. CU present only in [0-1] → gradeWeight=1 → rec=1/2=50%.
{
  const rows = [
    { from_m: 0, to_m: 1, CU: 4, lithology: 'X' },
    { from_m: 1, to_m: 2, CU: NaN, lithology: 'X' },  // missing grade → not counted
  ];
  const comp = G.lengthWeightedComposite(rows, 0, 2, ['CU']);
  approx('partial grade (only [0-1] has CU)', comp.CU, 4);
  eq('50% recovery (CU in half the weight)', comp.recovery_pct, 50);
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n═══════════════════════════════════`);
console.log(`  PASSED: ${passed}   FAILED: ${failed}`);
console.log(`═══════════════════════════════════`);
process.exit(failed > 0 ? 1 : 0);
