/* Domain S9: exact filled volume of each block in a regular model against a prism solid
   (the S7 between-surfaces build: top vertices 0..n-1, base vertex i+n under vertex i).
   Over one triangle top and base are linear, so the triangle ∩ block footprint is split by the
   four planes top=z0, top=z1, base=z0, base=z1; on every piece the clipped thickness is linear
   and its integral is area × value at the centroid. Centre-in-solid is never used. */
(function(root) {
  'use strict';
  const EPS = 1e-12;

  // Solid mesh -> prism triangles [{p:[[x,y],..3], top:[a,b,c], base:[a,b,c]}] with linear coefficients.
  function prisms(mesh) {
    const v = mesh && mesh.v, f = mesh && mesh.f;
    if (!Array.isArray(v) || !Array.isArray(f) || v.length % 2) throw Error('DOMAIN_CLIP_NOT_PRISM');
    const n = v.length / 2, out = [];
    for (let i = 0; i < n; i++)
      if (Math.abs(v[i][0] - v[n + i][0]) > 1e-9 || Math.abs(v[i][1] - v[n + i][1]) > 1e-9 || v[n + i][2] > v[i][2] + 1e-9)
        throw Error('DOMAIN_CLIP_NOT_PRISM');
    for (const face of f) {
      if (!face.every(i => i < n)) continue;
      const p = face.map(i => v[i]), area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
      if (Math.abs(area) < EPS) continue;
      out.push({xy:p.map(q => [q[0], q[1]]), top:plane(p, face.map(i => v[i][2])), base:plane(p, face.map(i => v[n + i][2]))});
    }
    if (!out.length) throw Error('DOMAIN_CLIP_NOT_PRISM');
    return out;
  }
  // z = a x + b y + c through three points.
  function plane(p, z) {
    const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2];
    const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const a = ((z[1] - z[0]) * (y2 - y0) - (z[2] - z[0]) * (y1 - y0)) / d;
    const b = ((x1 - x0) * (z[2] - z[0]) - (x2 - x0) * (z[1] - z[0])) / d;
    return [a, b, z[0] - a * x0 - b * y0];
  }
  const at = (l, q) => l[0] * q[0] + l[1] * q[1] + l[2];

  // Convex polygon ∩ {l(q) >= 0} (or > 0 when strict, so a split never counts a piece twice); l is [a, b, c] meaning a x + b y + c.
  function cut(poly, l, strict) {
    const inside = f => strict ? f > 0 : f >= 0;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], fp = at(l, p), fq = at(l, q);
      if (inside(fp)) out.push(p);
      if (inside(fp) !== inside(fq)) { const t = fp / (fp - fq); out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); }
    }
    return out.length >= 3 ? out : null;
  }
  function areaCentroid(poly) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length], c = x0 * y1 - x1 * y0;
      a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    return Math.abs(a) < EPS ? null : {area:Math.abs(a) / 2, c:[cx / (3 * a), cy / (3 * a)]};
  }

  // Exact ∫ over poly of max(0, min(top, z1) - max(base, z0)).
  function filled(poly, top, base, z0, z1) {
    let pieces = [poly];
    for (const [g, z] of [[top, z0], [top, z1], [base, z0], [base, z1]]) {
      const l = [g[0], g[1], g[2] - z], m = [-l[0], -l[1], -l[2]], next = [];
      for (const p of pieces) { const a = cut(p, l), b = cut(p, m, true); if (a) next.push(a); if (b) next.push(b); }
      pieces = next;
    }
    let sum = 0;
    for (const p of pieces) {
      const ac = areaCentroid(p); if (!ac) continue;
      const h = Math.min(at(top, ac.c), z1) - Math.max(at(base, ac.c), z0);
      if (h > 0) sum += ac.area * h;
    }
    return sum;
  }

  // grid: {origin:[x,y,z] of the model's minimum corner, size:[dx,dy,dz], count:[nx,ny,nz]}.
  // Yields after each triangle so a caller can time-slice; returns {filled: Float64Array (index i + nx*(j + ny*k)),
  // total, solid, outside} where outside is solid volume beyond the grid, reported rather than dropped.
  function* run(mesh, grid) {
    const [ox, oy, oz] = grid.origin, [dx, dy, dz] = grid.size, [nx, ny, nz] = grid.count;
    if (![ox, oy, oz, dx, dy, dz].every(Number.isFinite) || !(dx > 0 && dy > 0 && dz > 0) || ![nx, ny, nz].every(c => Number.isInteger(c) && c > 0))
      throw Error('DOMAIN_CLIP_GRID_INVALID');
    const cells = nx * ny * nz;
    if (!Number.isSafeInteger(cells) || cells > 2000000) throw Error('DOMAIN_CLIP_GRID_BUDGET');
    let tris;
    try { tris = prisms(mesh); }
    catch (error) {
      if (error.message !== 'DOMAIN_CLIP_NOT_PRISM') throw error;
      return yield* general(mesh, grid);
    }
    const out = new Float64Array(cells);
    const range = (lo, hi, o, d, c) => [Math.max(0, Math.floor((lo - o) / d)), Math.min(c - 1, Math.ceil((hi - o) / d) - 1)];
    let total = 0, solid = 0, visited = 0;
    for (const t of tris) {
      const xs = t.xy.map(q => q[0]), ys = t.xy.map(q => q[1]);
      const zt = Math.max(...t.xy.map(q => at(t.top, q))), zb = Math.min(...t.xy.map(q => at(t.base, q)));
      const tc = areaCentroid(t.xy); solid += tc.area * (at(t.top, tc.c) - at(t.base, tc.c));
      const [i0, i1] = range(Math.min(...xs), Math.max(...xs), ox, dx, nx), [j0, j1] = range(Math.min(...ys), Math.max(...ys), oy, dy, ny);
      const [k0, k1] = range(zb, zt, oz, dz, nz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x0 = ox + i * dx, y0 = oy + j * dy;
        let foot = t.xy;
        for (const l of [[1, 0, -x0], [-1, 0, x0 + dx], [0, 1, -y0], [0, -1, y0 + dy]]) { foot = cut(foot, l); if (!foot) break; }
        if (!foot) continue;
        for (let k = k0; k <= k1; k++) {
          const z0 = oz + k * dz, vol = filled(foot, t.top, t.base, z0, z0 + dz);
          if (vol > 0) { out[i + nx * (j + ny * k)] += vol; total += vol; }
          if ((++visited % 128) === 0) yield tris.length;
        }
      }
      yield tris.length;
    }
    return {filled:out, total, solid, outside:Math.max(0, solid - total), blockVolume:dx * dy * dz, triangles:tris.length};
  }
  // A signed tetrahedral shell also supports non-convex, capped lofts.
  // Translation by the grid origin avoids cancellation at large projected coordinates.
  function* general(mesh, grid) {
    if (!mesh?.v || !mesh?.f || mesh.v.length < 4 || mesh.f.length < 4) throw Error('DOMAIN_CLIP_NOT_PRISM');
    const owner = root.OrebitConvexClip;
    if (!owner) throw Error('DOMAIN_GEOMETRY_DEPENDENCY');
    const shell = owner.shell(mesh,grid.origin);
    const [dx,dy,dz] = grid.size, [nx,ny,nz] = grid.count, blockVolume=dx*dy*dz;
    const out = new Float64Array(nx*ny*nz), corrections = new Float64Array(out.length);
    let visited=0;
    for (const tetra of shell.cells) {
      const ranges=grid.size.map((size,k)=>[Math.max(0,Math.floor(tetra.min[k]/size)),Math.min(grid.count[k]-1,Math.ceil(tetra.max[k]/size)-1)]);
      for(let k=ranges[2][0];k<=ranges[2][1];k++) for(let j=ranges[1][0];j<=ranges[1][1];j++) for(let i=ranges[0][0];i<=ranges[0][1];i++) {
        const lo=[i*dx,j*dy,k*dz],hi=[(i+1)*dx,(j+1)*dy,(k+1)*dz];
        const value=tetra.sign*owner.box(tetra,lo,hi),index=i+nx*(j+ny*k);
        const adjusted=value-corrections[index],next=out[index]+adjusted;
        corrections[index]=(next-out[index])-adjusted;out[index]=next;
        if((++visited%128)===0)yield shell.cells.length;
      }
      yield shell.cells.length;
    }
    let total=0,correction=0;
    const tolerance=blockVolume*(1e-8+64*Number.EPSILON*shell.cells.length);
    for(let i=0;i<out.length;i++) {
      if(out[i]<-tolerance || out[i]>blockVolume+tolerance)throw Error('DOMAIN_CLIP_RECONCILIATION');
      out[i]=Math.max(0,Math.min(blockVolume,out[i]));
      const adjusted=out[i]-correction,next=total+adjusted;correction=(next-total)-adjusted;total=next;
      if((i%4096)===0)yield shell.cells.length;
    }
    if(total>shell.volume+Math.max(shell.volume,blockVolume)*1e-8)throw Error('DOMAIN_CLIP_RECONCILIATION');
    return {filled:out,total,solid:shell.volume,outside:Math.max(0,shell.volume-total),blockVolume,triangles:mesh.f.length,method:'signed-tetrahedral-intersection'};
  }
  function fractions(mesh, grid, options = {}) {
    const it = run(mesh, grid), cancelled = options.cancelled || (() => false);
    for (;;) { const r = it.next(); if (r.done) return r.value; if (cancelled()) return null; }
  }
  // Time-sliced: resolves null when cancelled() turns true between slices, so a changed model never receives stale fractions.
  function fractionsAsync(mesh, grid, options = {}) {
    const it = run(mesh, grid), cancelled = options.cancelled || (() => false), budget = options.sliceMs || 12;
    const tick = options.schedule || (f => setTimeout(f, 0));
    return new Promise((resolve, reject) => {
      const step = () => {
        try {
          const t0 = Date.now();
          for (;;) {
            if (cancelled()) return resolve(null);
            const r = it.next();
            if (r.done) return resolve(r.value);
            if (options.progress) options.progress(r.value);
            if (Date.now() - t0 > budget) return tick(step);
          }
        } catch (e) { reject(e); }
      };
      step();
    });
  }

  root.OrebitDomainClip = Object.freeze({fractions, fractionsAsync, prisms});
})(typeof window === 'undefined' ? globalThis : window);
