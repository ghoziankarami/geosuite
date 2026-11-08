#!/usr/bin/env node
// VAR-3D-1 principal-axis 3D variography: the shipped engine's rake rotation,
// principal-axis frame and three-axis experimental binning are checked against
// an independent dot-product/ellipsoid oracle and a hand-enumerated pair loop.
// The oracle does NOT call rotateAniso(); it builds the ellipsoid from the
// returned orthonormal frame, so a sign or axis-mapping slip in the engine
// still fails. Python oracle parity is covered by the native browser suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let root = path.dirname(fileURLToPath(import.meta.url));
while (!fs.existsSync(path.join(root, 'src/shared/geostat/resource-estimation.js'))) root = path.dirname(root);
const source = fs.readFileSync(path.join(root, 'src/shared/geostat/resource-estimation.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);
const c = context;
let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks++; };

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const spherical = h => h <= 0 ? 0 : h >= 1 ? 1 : 1.5 * h - 0.5 * h ** 3;

// The frame must be orthonormal and right-handed for every orientation, and a
// rake of zero must reproduce the engine's existing az/dip rows exactly.
for (const azDeg of [0, 37, 90, 143.5, 217, 359]) {
  for (const dipDeg of [-90, -30, 0, 12.5, 45, 90]) {
    for (const rakeDeg of [0, 15, -47.25, 180]) {
      const p = c.principalAxes(azDeg, dipDeg, rakeDeg);
      for (const a of [p.major, p.intermediate, p.minor]) ok(Math.abs(norm(a) - 1) < 1e-12, `unit axis ${azDeg}/${dipDeg}/${rakeDeg}`);
      ok(Math.abs(dot(p.major, p.intermediate)) < 1e-12, 'major ⟂ intermediate');
      ok(Math.abs(dot(p.major, p.minor)) < 1e-12, 'major ⟂ minor');
      ok(Math.abs(dot(p.intermediate, p.minor)) < 1e-12, 'intermediate ⟂ minor');
      ok(Math.abs(Math.abs(dot(cross(p.major, p.intermediate), p.minor)) - 1) < 1e-12, 'orthonormal frame');
      if (!rakeDeg) {
        const r1 = c.rotateAniso(1, 0, 0, azDeg, dipDeg, 0);
        const r2 = c.rotateAniso(0, 1, 0, azDeg, dipDeg, 0);
        const r3 = c.rotateAniso(0, 0, 1, azDeg, dipDeg, 0);
        // Rows of the rotation are the world coordinates of each axis.
        ok(Math.abs(dot(p.major, [1, 0, 0]) - r1.maj) < 1e-12, 'major row x');
        ok(Math.abs(dot(p.major, [0, 1, 0]) - r2.maj) < 1e-12, 'major row y');
        ok(Math.abs(dot(p.major, [0, 0, 1]) - r3.maj) < 1e-12, 'major row z');
        ok(Math.abs(dot(p.intermediate, [1, 0, 0]) - r1.semi) < 1e-12, 'intermediate row x');
        ok(Math.abs(dot(p.minor, [0, 0, 1]) - r3.min) < 1e-12, 'minor row z');
      }
    }
  }
}

// A nested anisotropic model must use rangeMaj/rangeMin/rangeVert along the
// three principal axes, and must agree with the independent ellipsoid oracle
// (dot products + spherical unit) rather than with rotateAniso() internals.
const model = { type: 'spherical', nugget: 0.1, sill: 1, range: 40,
  azDeg: 37, dipDeg: 25, rakeDeg: 40,
  struct1: { type: 'spherical', psill: 0.9, rangeMaj: 40, rangeMin: 20, rangeVert: 10 } };
const orientation = { azDeg: 37, dipDeg: 25, rakeDeg: 40 };
const frame = c.principalAxes(37, 25, 40);
const oracle = (dx, dy, dz) => {
  const d = [dx, dy, dz];
  const h = Math.sqrt((dot(d, frame.major) / 40) ** 2 + (dot(d, frame.intermediate) / 20) ** 2 + (dot(d, frame.minor) / 10) ** 2);
  return model.nugget + model.struct1.psill * spherical(h);
};
for (const [dx, dy, dz] of [[40, 0, 0], [0, 20, 0], [0, 0, 10], [13, -7, 3], [-31, 22, -9], [0, 0, 0]]) {
  ok(Math.abs(c.gammaAniso(dx, dy, dz, model, orientation) - oracle(dx, dy, dz)) < 1e-12, `ellipsoid oracle ${dx},${dy},${dz}`);
}
// Each principal direction at its own range reaches the sill.
const pointAt = (axis, range) => [axis[0] * range, axis[1] * range, axis[2] * range];
for (const [axis, range] of [[frame.major, 40], [frame.intermediate, 20], [frame.minor, 10]]) {
  const [dx, dy, dz] = pointAt(axis, range);
  ok(Math.abs(c.gammaAniso(dx, dy, dz, model, orientation) - 1) < 1e-12, 'range reaches sill');
}
// Rake must matter: the same physical offset is not interchangeable between
// the unraked and raked intermediate planes unless rake is a multiple of 90°.
const unraked = c.gammaAniso(0, 20, 0, { ...model, rakeDeg: 0 }, { ...orientation, rakeDeg: 0 });
ok(Math.abs(unraked - c.gammaAniso(0, 20, 0, model, orientation)) > 1e-6, 'rake changes the cross-section');

// Hand-enumerated experimental oracle along one axis.
function pairOracle(samples, axis, lagWidth, lagCount, toleranceDeg, maxDistance) {
  const n = norm(axis), u = axis.map(v => v / n), cosTol = Math.cos(toleranceDeg * Math.PI / 180);
  const bins = Array.from({ length: lagCount }, () => ({ n: 0, sum: 0 }));
  let totalPairs = 0;
  for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
    const a = samples[i], b = samples[j];
    const d = [b.x - a.x, b.y - a.y, b.z - a.z], h = norm(d);
    if (h === 0 || h > maxDistance) continue;
    if (Math.abs(dot(d, u)) / h + 1e-12 < cosTol) continue;
    const k = Math.floor(h / lagWidth);
    if (k >= lagCount) continue;
    bins[k].n++; bins[k].sum += (b.v - a.v) ** 2; totalPairs++;
  }
  const out = { lags: [], gammas: [], pairs: [], totalPairs };
  bins.forEach((bin, k) => { if (bin.n >= 5) { out.lags.push((k + 0.5) * lagWidth); out.pairs.push(bin.n); out.gammas.push(bin.sum / (2 * bin.n)); } });
  return out;
}

// Three lines along the principal axes, with independent grade ramps, so a
// swapped axis or a wrong angular filter cannot pass by coincidence.
const samples = [];
for (let i = 0; i < 12; i++) samples.push({ x: frame.major[0] * i * 20, y: frame.major[1] * i * 20, z: frame.major[2] * i * 20, v: 1 + 0.3 * i });
for (let i = 0; i < 12; i++) samples.push({ x: frame.intermediate[0] * i * 20, y: frame.intermediate[1] * i * 20, z: frame.intermediate[2] * i * 20, v: 5 + 0.1 * i });
for (let i = 0; i < 12; i++) samples.push({ x: frame.minor[0] * i * 20, y: frame.minor[1] * i * 20, z: frame.minor[2] * i * 20, v: 9 + 0.05 * i });
const params = { lagWidth: 20, lagCount: 5, angularToleranceDeg: 10, maxDistance: 100 };
const three = c.experimental3Axis(samples, orientation, params);
ok(three.descriptor.mode === 'principal3d' && three.descriptor.rakeDeg === 40 && three.descriptor.metric === 'euclidean-3d', 'descriptor records principal-axis 3D orientation');
for (const key of ['major', 'intermediate', 'minor']) {
  const expected = pairOracle(samples, three.axes[key], 20, 5, 10, 100);
  const got = three.curves[key];
  ok(JSON.stringify(got) === JSON.stringify(expected), `${key} curve matches the independent pair oracle`);
  ok(got.totalPairs > 0, `${key} covers real pairs`);
}
ok(three.curves.major.gammas[0] > three.curves.intermediate.gammas[0], 'axis-specific grade ramps produce distinct curves');
ok(JSON.stringify(c.experimentalAlongAxis(samples, three.axes.major, params)) === JSON.stringify(three.curves.major), 'single-axis and 3-axis APIs agree');

// Invalid drafts must throw rather than silently binning with a bad axis.
for (const bad of [{ ...params, lagWidth: 0 }, { ...params, lagCount: 0 }, { ...params, angularToleranceDeg: 91 }, { ...params, maxDistance: -1 }]) {
  assert.throws(() => c.experimentalAlongAxis(samples, [0, 0, 0], bad)); checks++;
}
assert.throws(() => c.experimentalAlongAxis(samples, [0, 0, 0], params)); checks++;

console.log(`VARIOGRAM 3-AXIS: ${checks} independent checks passed`);
