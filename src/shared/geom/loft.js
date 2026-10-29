/* Domain S5/S6: section loft. One closed ring per section, all sections on parallel planes
   (one plane definition, each section at its own station along the plane normal). Rings are
   matched by their merged arc-length parameters, so every digitised vertex is kept exactly and no
   corner is cut. The end rule (zero, half or pinch) is applied beyond the first and last sections
   and recorded. No implicit modelling: branching and non-parallel sections are refused. */
(function(root) {
  'use strict';
  const RULES = ['zero', 'half', 'pinch'];

  function loft(input) {
    const g = root.OrebitGeometryPrimitives, topology = root.OrebitDomainGeometry;
    if (!g || !topology) throw Error('DOMAIN_GEOMETRY_DEPENDENCY');
    const {plane, sections, endRule} = input || {};
    if (!RULES.includes(endRule)) throw Error('DOMAIN_LOFT_END_RULE');
    if (!Array.isArray(sections) || sections.length < 2) throw Error('DOMAIN_LOFT_SECTIONS');
    g.unproject(plane, [0, 0, 0]); // validates the plane
    const list = sections.map(s => {
      if (!s || !Number.isFinite(s.station)) throw Error('DOMAIN_LOFT_STATION');
      if (s.normal !== undefined) {
        const n = g.unit(s.normal), c = g.cross(n, plane.normal);
        if (Math.hypot(...c) > 1e-9) throw Error('DOMAIN_LOFT_NOT_PARALLEL');
      }
      if (s.rings !== undefined && (!Array.isArray(s.rings) || s.rings.length !== 1)) throw Error('DOMAIN_LOFT_BRANCHING');
      return {station:s.station, ring:align(g.inspectPolygon(s.ring || s.rings[0]).points)};
    }).sort((a, b) => a.station - b.station);
    for (let i = 1; i < list.length; i++) if (!(list[i].station - list[i - 1].station > 1e-9)) throw Error('DOMAIN_LOFT_STATION_DUPLICATE');

    // Merged parameters: every ring is evaluated at the vertices of all rings.
    const params = merge(list.map(s => s.ring.t));
    const rings = list.map(s => ({station:s.station, p:params.map(t => at(s.ring, t))}));
    const M = params.length, first = rings[0], last = rings[rings.length - 1];
    const before = endRule === 'zero' ? 0 : (rings[1].station - first.station) / 2;
    const after = endRule === 'zero' ? 0 : (last.station - rings[rings.length - 2].station) / 2;
    if (endRule === 'half') {
      rings.unshift({station:first.station - before, p:first.p});
      rings.push({station:last.station + after, p:last.p});
    }
    if (rings.length * M + 2 > 10000) throw Error('DOMAIN_LOFT_BUDGET');

    const v = [], f = [];
    for (const r of rings) for (const q of r.p) v.push(g.unproject(plane, [q[0], q[1], r.station]));
    for (let i = 0; i + 1 < rings.length; i++) for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M, c = b + M, d = a + M;
      f.push([a, b, c], [a, c, d]);
    }
    const lastBase = (rings.length - 1) * M;
    if (endRule === 'pinch') {
      const s = v.length, e = s + 1;
      v.push(g.unproject(plane, [...centroid(first.p), first.station - before]), g.unproject(plane, [...centroid(last.p), last.station + after]));
      for (let j = 0; j < M; j++) {
        f.push([j, s, (j + 1) % M]);
        f.push([lastBase + j, lastBase + (j + 1) % M, e]);
      }
    } else {
      for (const [a, b, c] of earClip(first.p)) f.push([a, c, b]);
      for (const [a, b, c] of earClip(last.p)) f.push([lastBase + a, lastBase + b, lastBase + c]);
    }

    const mesh = {v, f}, report = topology.inspectMesh(mesh, {maxFaces:20000, maxVertices:10000});
    let shell = null, shellError = null;
    try { shell = root.OrebitDomainSolid ? root.OrebitDomainSolid.prepareSolid(mesh, {maxFaces:10000}) : null; } catch (e) { shellError = e.message; }
    return {status:report.closed && report.volume > 0 && shell ? 'solid' : 'invalid', mesh, volume:report.volume, endRule,
      sections:list.length, stations:list.map(s => s.station), extension:{before, after}, pointsPerRing:M, shellError,
      validation:{topology:report.closed, selfIntersection:!!shell, geologistReview:false}};
  }

  // Counter-clockwise ring starting where the ray from its centroid along +s first meets it (inserted when it falls
  // mid-edge), so the start does not depend on how densely the ring was digitised. t = arc-length share.
  function align(input) {
    const c = centroid(input), ring = input.slice();
    let hit = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if ((a[1] - c[1]) * (b[1] - c[1]) > 0 || a[1] === b[1]) continue;
      const w = (c[1] - a[1]) / (b[1] - a[1]), x = a[0] + w * (b[0] - a[0]);
      if (x >= c[0] && (!hit || x < hit.x)) hit = {i, w, x};
    }
    let start = 0;
    if (hit && hit.w <= 1e-12) start = hit.i;
    else if (hit && hit.w >= 1 - 1e-12) start = (hit.i + 1) % ring.length;
    else if (hit) { ring.splice(hit.i + 1, 0, [hit.x, c[1]]); start = hit.i + 1; }
    const p = ring.slice(start).concat(ring.slice(0, start)), t = [0];
    let total = 0;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      total += Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
      if (i + 1 < p.length) t.push(total);
    }
    return {p, t:t.map(x => x / total)};
  }
  function merge(lists) {
    const all = lists.flat().sort((a, b) => a - b), out = [];
    for (const t of all) if (!out.length || t - out[out.length - 1] > 1e-12) out.push(t);
    return out;
  }
  function at(ring, t) {
    const {p, t:ts} = ring;
    let k = 0;
    while (k + 1 < ts.length && ts[k + 1] <= t + 1e-12) k++;
    if (Math.abs(t - ts[k]) <= 1e-12) return p[k].slice();
    const t1 = k + 1 < ts.length ? ts[k + 1] : 1, a = p[k], b = p[(k + 1) % p.length], w = (t - ts[k]) / (t1 - ts[k]);
    return [a[0] + w * (b[0] - a[0]), a[1] + w * (b[1] - a[1])];
  }
  function centroid(p) {
    let a = 0, x = 0, y = 0;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length], c = x0 * y1 - x1 * y0;
      a += c; x += (x0 + x1) * c; y += (y0 + y1) * c;
    }
    return [x / (3 * a), y / (3 * a)];
  }
  // Ear clipping of a counter-clockwise ring; collinear vertices are kept as triangle corners, never as zero-area ears.
  function earClip(p) {
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), eps = 1e-12 * span * span;
    const o = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (q, a, b, c) => o(a, b, q) >= -eps && o(b, c, q) >= -eps && o(c, a, q) >= -eps;
    const idx = p.map((_, i) => i), out = [];
    while (idx.length > 3) {
      let cut = false;
      for (let k = 0; k < idx.length && !cut; k++) {
        const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
        if (o(p[i0], p[i1], p[i2]) <= eps) continue;
        if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(p[j], p[i0], p[i1], p[i2]))) continue;
        out.push([i0, i1, i2]); idx.splice(k, 1); cut = true;
      }
      if (!cut) throw Error('DOMAIN_LOFT_CAP');
    }
    if (o(p[idx[0]], p[idx[1]], p[idx[2]]) <= eps) throw Error('DOMAIN_LOFT_CAP');
    out.push(idx.slice());
    return out;
  }

  root.OrebitDomainLoft = Object.freeze({RULES, loft});
})(typeof window === 'undefined' ? globalThis : window);
