/* Domain S7, primitive A: the closed solid between a top and a base contact surface.
   Vertices sit at the top contacts; the base is sampled under them from its own bounded TIN.
   Pinches, inversions, missing support and topography breaches are reported, never repaired. */
(function(root) {
  'use strict';
  const TOL = 1e-6;

  // top/base: picks from OrebitDomainContacts.pickContacts. topography: Map hole -> collar z, or null when declared unavailable.
  function buildBetween(top, base, options = {}) {
    const g = root.OrebitGeometryPrimitives, contacts = root.OrebitDomainContacts;
    const topSurface = contacts.contactSurface(top, options.maxEdge == null ? {} : {maxEdge:options.maxEdge});
    const baseSurface = contacts.contactSurface(base, {maxEdge:topSurface.maxEdge ?? options.maxEdge});
    const excluded = [], baseOf = new Map(base.map(p => [p.hole, p]));
    if(topSurface.status==='ambiguous'||baseSurface.status==='ambiguous')
      return {status:'ambiguous',top:topSurface.status,base:baseSurface.status,
        excluded:[...new Map([...(topSurface.affected||[]),...(baseSurface.affected||[])].map(p=>[p.hole,p])).values()]};
    if (topSurface.status !== 'surface' || baseSurface.status !== 'surface')
      return {status:'no-surface', top:topSurface.status, base:baseSurface.status, excluded};
    const sampleBase = g.prepareTIN(baseSurface.tin).sample;
    const kept = [], inverted = [], pinched = [], aboveTopo = [];
    for (const p of top) {
      if (p.status !== 'contact') { excluded.push({hole:p.hole, reason:'top-' + p.reason}); continue; }
      const b = baseOf.get(p.hole);
      if (b && b.status !== 'contact') { excluded.push({hole:p.hole, reason:'base-' + b.reason}); continue; }
      const s = sampleBase(p.point[0], p.point[1]);
      if (!s) { excluded.push({hole:p.hole, reason:'base-outside-support'}); continue; }
      const thickness = p.point[2] - s.z;
      if (thickness < -TOL) inverted.push(p.hole); else if (thickness <= TOL) pinched.push(p.hole);
      if (options.topography) {
        const zt = options.topography.get(p.hole);
        if (Number.isFinite(zt) && p.point[2] > zt + TOL) aboveTopo.push(p.hole);
      }
      kept.push({hole:p.hole, top:p.point, base:[p.point[0], p.point[1], s.z]});
    }
    const report = {excluded, inverted, pinched, aboveTopography:aboveTopo, maxEdge:topSurface.maxEdge, maxEdgeSource:topSurface.maxEdgeSource,
      topography:options.topography ? 'collars' : 'declared-unavailable'};
    // ponytail: a pinch or inversion stops the build; pinch-out walls need their own end rule (S5/S6).
    if (inverted.length) return {status:'inverted', ...report};
    if (pinched.length) return {status:'pinched', ...report};
    if (kept.length < 3) return {status:'insufficient', ...report};
    const tin = g.makeTIN(kept.map(k => k.top), report.maxEdge);
    if (!tin.triangles.length) return {status:'no-triangles', ...report};
    // makeTIN keeps first-seen order of unique XY, which is kept order here (no duplicates survive sampling twice).
    const n = tin.v.length, byXY = new Map(kept.map(k => [k.top[0] + ':' + k.top[1], k]));
    const order = tin.v.map(p => byXY.get(p[0] + ':' + p[1]));
    const v = [...order.map(k => k.top.slice()), ...order.map(k => k.base.slice())];
    const f = [], edgeUse = new Map();
    for (const [a, b, c] of tin.triangles) {
      f.push([a, b, c], [n + a, n + c, n + b]);
      for (const [x, y] of [[a, b], [b, c], [c, a]]) { const key = Math.min(x, y) + ':' + Math.max(x, y); edgeUse.set(key, edgeUse.has(key) ? null : [x, y]); }
    }
    // Each hull edge x->y has the surface on its left; the wall faces outward to its right.
    for (const e of edgeUse.values()) if (e) { const [x, y] = e; f.push([x, n + x, n + y], [x, n + y, y]); }
    let volume = 0;
    for (const [a, b, c] of tin.triangles) {
      const [p, q, r] = [a, b, c].map(i => v[i]);
      const area = ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
      volume += area * ([a, b, c].reduce((s, i) => s + v[i][2] - v[n + i][2], 0) / 3);
    }
    // Honouring: every top contact is a vertex; base contacts are checked against the solid's base under them.
    const baseFace = g.prepareTIN({v:v.slice(n), triangles:tin.triangles});
    let baseDeviation = 0;
    for (const b of base) if (b.status === 'contact') {
      const s = baseFace.sample(b.point[0], b.point[1]);
      if (s) baseDeviation = Math.max(baseDeviation, Math.abs(s.z - b.point[2]));
    }
    const mesh = {v, f};
    let shell = null, shellError = null;
    try { shell = root.OrebitDomainSolid.prepareSolid(mesh, {maxFaces:10000}); } catch (e) { shellError = e.message; }
    const tolerance = options.honourTolerance ?? 0.01;
    const validation = {topology:!!shell, selfIntersection:!!shell, topography:options.topography ? !aboveTopo.length : null,
      surfaceCrossings:true, overlap:null, honouring:baseDeviation <= tolerance, geologistReview:false};
    return {status:shell ? 'solid' : 'invalid', ...report, shellError, mesh, volume, meshVolume:shell ? shell.volume : null,
      holes:order.map(k => k.hole), triangles:tin.triangles.length, baseDeviation, honourTolerance:tolerance, validation};
  }

  // Exact planar overlay of two bounded, piecewise-linear horizons. Each cell
  // lies in one triangle from each TIN, so thickness is affine on that cell.
  // Neither names nor the input order are used to repair inverted horizons.
  function buildSurfacePair(top, base, options={}) {
    const g=root.OrebitGeometryPrimitives;
    g.prepareTIN(top);g.prepareTIN(base);
    const origin=top.v[0].slice(0,2),cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const triangles=tin=>tin.triangles.map(f=>{
      const p=f.map(i=>[tin.v[i][0]-origin[0],tin.v[i][1]-origin[1],tin.v[i][2]]);
      return {p,lo:[0,1].map(k=>Math.min(...p.map(q=>q[k]))),hi:[0,1].map(k=>Math.max(...p.map(q=>q[k])))};
    });
    const upper=triangles(top),lower=triangles(base),vertices=[],cells=[],lookup=new Map();
    const zAt=(t,p)=>{const [a,b,c]=t.p,d=cross(a,b,c);return (cross(p,b,c)*a[2]+cross(a,p,c)*b[2]+cross(a,b,p)*c[2])/d;};
    const eps=1e-8,areaEps=1e-10,maxPairs=options.maxPairs??1000000,maxFaces=10000;
    if(!Number.isInteger(maxPairs)||maxPairs<1||maxPairs>1000000)throw Error('DOMAIN_SURFACE_PAIR_BUDGET');
    function clip(input,triangle){
      let poly=input.map(p=>p.slice(0,2));
      for(let i=0;i<3&&poly.length;i++){
        const a=triangle[i],b=triangle[(i+1)%3],out=[];
        for(let j=0;j<poly.length;j++){
          const p=poly[j],q=poly[(j+1)%poly.length],dp=cross(a,b,p),dq=cross(a,b,q),inside=dp>=0,next=dq>=0;
          if(inside)out.push(p);
          if(inside!==next){const f=dp/(dp-dq);out.push([p[0]+f*(q[0]-p[0]),p[1]+f*(q[1]-p[1])]);}
        }
        poly=out.filter((p,j)=>j===0||Math.hypot(p[0]-out[j-1][0],p[1]-out[j-1][1])>eps);
        if(poly.length>1&&Math.hypot(poly[0][0]-poly.at(-1)[0],poly[0][1]-poly.at(-1)[1])<=eps)poly.pop();
      }
      return poly;
    }
    let pairs=0,area=0,volume=0;const inverted=[],pinched=[];
    for(const a of upper)for(const b of lower){
      if(++pairs>maxPairs)throw Error('DOMAIN_SURFACE_PAIR_BUDGET');
      if(options.cancelled?.())throw Error('DOMAIN_SURFACE_PAIR_CANCELLED');
      if([0,1].some(k=>a.hi[k]<b.lo[k]||b.hi[k]<a.lo[k]))continue;
      const poly=clip(a.p,b.p);if(poly.length<3)continue;
      const signed=poly.reduce((s,p,i)=>s+p[0]*poly[(i+1)%poly.length][1]-p[1]*poly[(i+1)%poly.length][0],0)/2;
      if(signed<=areaEps)continue;
      const indices=poly.map(p=>{
        const u=zAt(a,p),l=zAt(b,p),key=Math.round(p[0]/eps)+':'+Math.round(p[1]/eps),existing=lookup.get(key);
        const location=(p[0]+origin[0]).toFixed(3)+', '+(p[1]+origin[1]).toFixed(3);
        if(u-l < -TOL)inverted.push(location);else if(u-l<=TOL)pinched.push(location);
        if(existing!=null){const old=vertices[existing];if(Math.abs(old[2]-u)>TOL||Math.abs(old[3]-l)>TOL)throw Error('DOMAIN_SURFACE_MULTIVALUED');return existing;}
        const index=vertices.length;lookup.set(key,index);vertices.push([p[0],p[1],u,l]);return index;
      });
      for(let i=1;i<indices.length-1;i++){
        const face=[indices[0],indices[i],indices[i+1]],points=face.map(k=>vertices[k]),cellArea=cross(...points)/2;
        if(cellArea<=areaEps)continue;
        cells.push(face);area+=cellArea;volume+=cellArea*points.reduce((s,p)=>s+p[2]-p[3],0)/3;
        if(cells.length*2>maxFaces)throw Error('DOMAIN_STATE_BUDGET');
      }
    }
    const report={kind:'surface-pair',excluded:[],holes:[],inverted:[...new Set(inverted)],pinched:[...new Set(pinched)],commonArea:area,
      supportPolicy:'intersection-no-extrapolation',topography:options.terrain?'tin':'declared-unavailable',pairChecks:pairs};
    if(inverted.length)return {status:'inverted',...report};
    if(pinched.length)return {status:'pinched',...report};
    if(!cells.length)return {status:'no-triangles',...report};
    const n=vertices.length,v=[...vertices.map(p=>[p[0]+origin[0],p[1]+origin[1],p[2]]),...vertices.map(p=>[p[0]+origin[0],p[1]+origin[1],p[3]])],f=[],edges=new Map();
    for(const face of cells){const [a,b,c]=face;f.push([a,b,c],[n+a,n+c,n+b]);
      for(const [x,y] of [[a,b],[b,c],[c,a]]){const key=Math.min(x,y)+':'+Math.max(x,y);if(edges.has(key))edges.get(key).count++;else edges.set(key,{x,y,count:1});}}
    for(const {x,y,count} of edges.values())if(count===1)f.push([x,n+x,n+y],[x,n+y,y]);
    // Diagnose touching support patches without joining them or changing gates.
    const boundaryDegree=new Map();
    for(const {x,y,count}of edges.values())if(count===1)for(const id of [x,y])boundaryDegree.set(id,(boundaryDegree.get(id)||0)+1);
    report.supportJunctions=[...boundaryDegree].filter(([,degree])=>degree!==2).map(([id,degree])=>({point:v[id].slice(),boundaryEdges:degree}));
    if(f.length>maxFaces)throw Error('DOMAIN_STATE_BUDGET');
    const mesh={v,f},meshDiagnostics=root.OrebitDomainGeometry.inspectMesh(mesh,{maxFaces,maxVertices:10000});let shell=null,shellError=null;
    try{shell=root.OrebitDomainSolid.prepareSolid(mesh,{maxFaces});}catch(e){shellError=e.message;}
    // Test the entire upper horizon against terrain, including interior TIN
    // edge crossings. Vertex-only tests can miss a valley inside one face.
    let above=null;
    if(options.terrain){
      const ground=buildSurfacePair(options.terrain,{v:v.slice(0,n),triangles:cells},{maxPairs,cancelled:options.cancelled});
      above=ground.inverted.length===0&&Math.abs(ground.commonArea-area)<=Math.max(1,area)*1e-8?0:Math.max(1,ground.inverted.length);
    }
    return {status:shell?'solid':'invalid',...report,mesh,volume,meshVolume:shell?.volume??null,shellError,meshDiagnostics,triangles:cells.length,baseDeviation:0,
      terrainOutsideOrAbove:above,validation:{topology:!!shell,selfIntersection:shell?true:shellError==='DOMAIN_SOLID_SELF_INTERSECTION'?false:null,topography:options.terrain?above===0:null,
        surfaceCrossings:true,overlap:null,honouring:true,geologistReview:false}};
  }

  root.OrebitDomainBetween = Object.freeze({buildBetween,buildSurfacePair});
})(typeof window === 'undefined' ? globalThis : window);
