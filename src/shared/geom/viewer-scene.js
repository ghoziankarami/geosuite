/* Domain S3: display geometry for the Core viewer. It thins nothing; any display
   decimation is labelled by the caller and analysis populations stay whole. */
(function(root) {
  'use strict';
  const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  // Interval endpoints from OrebitCoreDomain.intervalGeometry(); invalid rows are counted, not guessed.
  function buildScene(intervals, valueOf) {
    const segments = [], bounds = {x:[Infinity,-Infinity], y:[Infinity,-Infinity], z:[Infinity,-Infinity]};
    let skipped = 0;
    for (const row of intervals) {
      if (!finite(row.start) || !finite(row.end)) { skipped++; continue; }
      for (const p of [row.start, row.end]) for (const k of ['x','y','z']) {
        if (p[k] < bounds[k][0]) bounds[k][0] = p[k];
        if (p[k] > bounds[k][1]) bounds[k][1] = p[k];
      }
      segments.push({a:row.start, b:row.end, hole:row.hole_id, sourceIndex:row.sourceIndex, value:valueOf ? valueOf(row) : null});
    }
    return Object.freeze({segments, skipped, total:intervals.length, bounds:segments.length ? bounds : null});
  }
  // Exact clip of each segment to a vertical slab |n| <= halfWidth around a section plane.
  // u runs along the section azimuth from the plane origin; elevation stays world z.
  function sectionSlab(scene, plane, halfWidth) {
    if (!(halfWidth > 0) || !Number.isFinite(halfWidth)) throw Error('DOMAIN_SECTION_WIDTH_INVALID');
    const g = root.OrebitGeometryPrimitives, out = [];
    for (const s of scene.segments) {
      const pa = g.project(plane, [s.a.x, s.a.y, s.a.z]), pb = g.project(plane, [s.b.x, s.b.y, s.b.z]);
      let t0 = 0, t1 = 1;
      const dn = pb[2] - pa[2];
      if (dn === 0) { if (Math.abs(pa[2]) > halfWidth) continue; }
      else {
        let lo = (-halfWidth - pa[2]) / dn, hi = (halfWidth - pa[2]) / dn;
        if (lo > hi) [lo, hi] = [hi, lo];
        t0 = Math.max(0, lo); t1 = Math.min(1, hi);
        if (t0 > t1) continue;
      }
      const at = t => ({u:pa[0] + (pb[0] - pa[0]) * t, z:s.a.z + (s.b.z - s.a.z) * t, n:pa[2] + dn * t});
      out.push({p:at(t0), q:at(t1), hole:s.hole, sourceIndex:s.sourceIndex, value:s.value});
    }
    return out;
  }
  // World → screen with an explicit vertical exaggeration. Horizontal metres per pixel stay equal.
  function fitView(range, width, height, ve, pad = 24) {
    if (!(ve > 0) || !Number.isFinite(ve) || !(width > 2 * pad) || !(height > 2 * pad)) throw Error('DOMAIN_VIEW_INVALID');
    const [h0, h1] = range.h, [v0, v1] = range.v;
    const hw = Math.max(h1 - h0, 1e-9), vw = Math.max(v1 - v0, 1e-9);
    const scale = Math.min((width - 2 * pad) / hw, (height - 2 * pad) / (vw * ve));
    const ox = (width - hw * scale) / 2 - h0 * scale, oy = (height + vw * scale * ve) / 2 + v0 * scale * ve;
    return Object.freeze({scale, ve, toScreen:(h, v) => [ox + h * scale, oy - v * scale * ve], toWorld:(x, y) => [(x - ox) / scale, (oy - y) / (scale * ve)]});
  }
  root.OrebitDomainViewerScene = Object.freeze({buildScene, sectionSlab, fitView});
})(typeof window === 'undefined' ? globalThis : window);
