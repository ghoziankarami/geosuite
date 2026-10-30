/* Exact convex half-space intersection and signed tetrahedral decomposition.
   A closed oriented shell is a signed sum of tetrahedra, including non-convex
   shells. Intersection preserves that sum; no centre test or voxel estimate. */
(function(root) {
  'use strict';
  const sub = (a, b) => a.map((x, i) => x - b[i]);
  const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
  const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const determinant = (a, b, c, d) => dot(sub(b,a), cross(sub(c,a), sub(d,a))) / 6;
  const indices = [[0,2,1], [0,1,3], [0,3,2], [1,2,3]];
  function tetrahedron(vertices, sign = 1) {
    const p = vertices.map(v => v.slice());
    let volume = determinant(...p);
    if (volume < 0) { [p[2],p[3]] = [p[3],p[2]]; volume = -volume; }
    const faces = indices.map(ids => ids.map(i => p[i]));
    const planes = faces.map(face => {
      const n = cross(sub(face[1],face[0]), sub(face[2],face[0]));
      const length = Math.hypot(...n), unit = n.map(v => v / length);
      return {n:unit, d:dot(unit,face[0])};
    });
    return {p, faces, planes, sign, volume,
      min:[0,1,2].map(k => Math.min(...p.map(v => v[k]))),
      max:[0,1,2].map(k => Math.max(...p.map(v => v[k])))};
  }
  function shell(mesh, shift = [0,0,0]) {
    if (!root.OrebitDomainSolid) throw Error('DOMAIN_GEOMETRY_DEPENDENCY');
    const prepared = root.OrebitDomainSolid.prepareSolid(mesh);
    const v = mesh.v.map(p => sub(p,shift)), anchor = v[0], cells = [];
    for (const face of mesh.f) {
      const p = [anchor,...face.map(i => v[i])], volume = determinant(...p);
      if (volume !== 0) cells.push(tetrahedron(p, volume < 0 ? -1 : 1));
    }
    return {cells, volume:prepared.volume};
  }
  // Retain n·p <= d. Original face winding and the new outward cap agree.
  function cut(faces, plane, tolerance) {
    const out = [], cap = [];
    const addCap = p => { if (!cap.some(q => Math.hypot(...sub(p,q)) <= tolerance)) cap.push(p); };
    for (const face of faces) {
      const polygon = [];
      for (let i = 0; i < face.length; i++) {
        const a = face[i], b = face[(i+1)%face.length];
        // Coplanar vertices can land on opposite sides through dot-product
        // roundoff. Treat the established length tolerance as the boundary;
        // otherwise clipping a tetrahedron by its own face invents a cap.
        const distance = p => { const d=dot(plane.n,p)-plane.d;return Math.abs(d)<=tolerance?0:d; };
        const da = distance(a), db = distance(b);
        if (da <= 0) polygon.push(a);
        if ((da <= 0) !== (db <= 0)) {
          const t = da/(da-db), p = a.map((x,k) => x+t*(b[k]-x));
          polygon.push(p); addCap(p);
        }
      }
      if (polygon.length >= 3) out.push(polygon);
    }
    if (cap.length >= 3) {
      const centre = [0,1,2].map(k => cap.reduce((sum,p) => sum+p[k],0)/cap.length);
      const ref = Math.abs(plane.n[0]) < 0.9 ? [1,0,0] : [0,1,0];
      const perpendicular = cross(plane.n,ref), length = Math.hypot(...perpendicular);
      const u = perpendicular.map(x => x/length), v = cross(plane.n,u);
      const angle = p => Math.atan2(dot(sub(p,centre),v),dot(sub(p,centre),u));
      cap.sort((a,b) => angle(a)-angle(b)); out.push(cap);
    }
    return out;
  }
  function volume(faces) {
    if (!faces.length) return 0;
    const anchor = faces[0][0]; let result = 0, correction = 0;
    for (const face of faces) for (let i=1; i<face.length-1; i++) {
      const value = determinant(anchor,face[0],face[i],face[i+1])-correction;
      const next = result+value; correction=(next-result)-value; result=next;
    }
    return Math.abs(result);
  }
  function intersectionFaces(tetra, planes, tolerance = 1e-10) {
    let faces = tetra.faces;
    for (const plane of planes) { faces = cut(faces,plane,tolerance); if (!faces.length) break; }
    return faces;
  }
  function intersection(tetra, planes, tolerance = 1e-10) {
    return volume(intersectionFaces(tetra,planes,tolerance));
  }
  function box(tetra, lo, hi, tolerance = 1e-10*Math.max(...hi.map((v,k)=>v-lo[k]))) {
    if ([0,1,2].some(k => tetra.max[k] <= lo[k] || tetra.min[k] >= hi[k])) return 0;
    if (tetra.p.every(p => p.every((v,k) => v >= lo[k] && v <= hi[k]))) return tetra.volume;
    // Face support extrema avoid polygon allocation for interior or separated cells.
    let contained = true;
    for (const plane of tetra.planes) {
      const lower = plane.n.reduce((sum,n,k) => sum+n*(n>=0?lo[k]:hi[k]),0)-plane.d;
      if (lower > 0) return 0;
      const upper = plane.n.reduce((sum,n,k) => sum+n*(n>=0?hi[k]:lo[k]),0)-plane.d;
      if (upper > 0) contained = false;
    }
    if (contained) return (hi[0]-lo[0])*(hi[1]-lo[1])*(hi[2]-lo[2]);
    const planes = [];
    for (let k=0;k<3;k++) {
      const n=[0,0,0]; n[k]=1; planes.push({n,d:hi[k]});
      planes.push({n:n.map(v=>-v),d:-lo[k]});
    }
    return intersection(tetra,planes,tolerance);
  }
  function* overlapRun(a, b, options) {
    const first=shell(a,a.v[0]),second=shell(b,a.v[0]);
    const limit=options.maxPairs??1000000;
    if(!Number.isInteger(limit)||limit<1||limit>1000000)throw Error('DOMAIN_OVERLAP_OPTIONS');
    const outside=(cell,planes)=>planes.some(plane=>{
      let strictlyOutside=false;
      for(const p of cell.p){
        const distance=plane.n[0]*p[0]+plane.n[1]*p[1]+plane.n[2]*p[2]-plane.d;
        if(distance < -1e-10)return false;
        if(distance > 1e-10)strictlyOutside=true;
      }
      // If every vertex lies in the tolerance band, retain the original
      // clipping path rather than dropping a possibly very thin tetrahedron.
      return strictlyOutside;
    });
    let result=0,correction=0,pairs=0,visited=0;
    for(const x of first.cells) for(const y of second.cells) {
      if((++visited%128)===0)yield pairs;
      if([0,1,2].some(k=>x.max[k]<=y.min[k]||x.min[k]>=y.max[k]))continue;
      // AABB overlap is common for the long signed tetrahedra of sloping
      // layers. A separating face proves zero intersection before allocating
      // clipped polygons. Use the exact same boundary tolerance as intersection;
      // coplanar contact has zero volume, never an inferred positive overlap.
      if(outside(x,y.planes)||outside(y,x.planes))continue;
      if(++pairs>limit)throw Error('DOMAIN_OVERLAP_BUDGET');
      const term=x.sign*y.sign*intersection(x,y.planes),adjusted=term-correction,next=result+adjusted;
      correction=(next-result)-adjusted;result=next;
    }
    const bound=Math.min(first.volume,second.volume),tolerance=Math.max(first.volume,second.volume)*1e-8;
    if(result<-tolerance||result>bound+tolerance){const error=Error('DOMAIN_OVERLAP_RECONCILIATION');Object.assign(error,{volume:result,bound,tolerance});throw error;}
    return {volume:Math.max(0,Math.min(bound,result)),pairs,method:'signed-tetrahedral-intersection'};
  }
  function overlap(a,b,options={}) {
    const iterator=overlapRun(a,b,options);
    for(;;){if(options.cancelled?.())return null;const r=iterator.next();if(r.done)return r.value;}
  }
  function overlapAsync(a,b,options={}) {
    const iterator=overlapRun(a,b,options),schedule=options.schedule||(f=>setTimeout(f,0));
    return new Promise((resolve,reject)=>{
      const step=()=>{
        try{
          const start=Date.now();
          for(;;){
            if(options.cancelled?.())return resolve(null);
            const r=iterator.next();if(r.done)return resolve(r.value);
            if(Date.now()-start>(options.sliceMs??12))return schedule(step);
          }
        }catch(error){reject(error);}
      };
      step();
    });
  }
  root.OrebitConvexClip=Object.freeze({shell,tetrahedron,intersection,intersectionFaces,box,volume,overlap,overlapAsync});
})(typeof window==='undefined'?globalThis:window);
