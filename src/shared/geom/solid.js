/* S2 single-shell validation. Requires mesh.js and primitives.js; not geological approval. */
(function(root) {
  'use strict';
  function prepareSolid(mesh,options={}) {
    const g=root.OrebitGeometryPrimitives,topology=root.OrebitDomainGeometry;
    if (!g || !topology) throw Error('DOMAIN_GEOMETRY_DEPENDENCY');
    const maxFaces=options.maxFaces??10000,maxPairs=options.maxPairs??1000000,tolerance=options.tolerance??1e-8;
    if (!Number.isInteger(maxFaces) || maxFaces<4 || maxFaces>10000 || !Number.isInteger(maxPairs) || maxPairs<1 || maxPairs>1000000 ||
        !Number.isFinite(tolerance) || tolerance<=0 || tolerance>1e-3) throw Error('DOMAIN_SOLID_OPTIONS');
    const report=topology.inspectMesh(mesh,{maxFaces,maxVertices:10000});
    if(!report.closed || !(report.volume>0)) throw Error('DOMAIN_SOLID_TOPOLOGY');
    const origin=mesh.v[0].slice(),v=mesh.v.map(p=>g.sub(p,origin)),f=mesh.f.map(t=>t.slice());
    const eps=tolerance,triangles=f.map((ids,index)=>{
      const p=ids.map(i=>v[i]),normal=g.cross(g.sub(p[1],p[0]),g.sub(p[2],p[0])),norm=Math.hypot(...normal);
      if (!(norm>eps*eps)) throw Error('DOMAIN_SOLID_DEGENERATE');
      return {ids,index,p,n:g.mul(normal,1/norm),min:[0,1,2].map(k=>Math.min(...p.map(a=>a[k]))),max:[0,1,2].map(k=>Math.max(...p.map(a=>a[k])))};
    });
    const edgeFaces=new Map(),adj=f.map(()=>[]);
    for(const t of triangles) for(let i=0;i<3;i++) {
      const a=t.ids[i],b=t.ids[(i+1)%3],key=Math.min(a,b)+':'+Math.max(a,b),prior=edgeFaces.get(key);
      if(prior!==undefined) {adj[t.index].push(prior);adj[prior].push(t.index);} else edgeFaces.set(key,t.index);
    }
    const links=new Map();
    for(const ids of f) for(let i=0;i<3;i++) {
      const vertex=ids[i],a=ids[(i+1)%3],b=ids[(i+2)%3],link=links.get(vertex)||new Map();
      for(const [x,y] of [[a,b],[b,a]]) {const neighbours=link.get(x)||[];neighbours.push(y);link.set(x,neighbours);}
      links.set(vertex,link);
    }
    for(const link of links.values()) {
      if([...link.values()].some(neighbours=>neighbours.length!==2)) throw Error('DOMAIN_SOLID_VERTEX_MANIFOLD');
      const start=link.keys().next().value,visited=new Set([start]),pending=[start];
      for(let i=0;i<pending.length;i++) for(const j of link.get(pending[i])) if(!visited.has(j)) {visited.add(j);pending.push(j);}
      if(visited.size!==link.size) throw Error('DOMAIN_SOLID_VERTEX_MANIFOLD');
    }
    const seen=new Set([0]),queue=[0];
    for(let i=0;i<queue.length;i++) for(const j of adj[queue[i]]) if(!seen.has(j)) {seen.add(j);queue.push(j);}
    // Separate islands/cavities need the later multi-shell ownership contract.
    if(seen.size!==f.length) throw Error('DOMAIN_SOLID_MULTISHELL');
    const intersectsBox=(a,b)=>[0,1,2].every(k=>a.min[k]<=b.max[k]+eps && b.min[k]<=a.max[k]+eps);
    function tree(items) {
      const min=[0,1,2].map(k=>Math.min(...items.map(t=>t.min[k]))),max=[0,1,2].map(k=>Math.max(...items.map(t=>t.max[k])));
      if(items.length<=8) return {min,max,items};
      const spans=max.map((x,i)=>x-min[i]),axis=spans.indexOf(Math.max(...spans)),ordered=items.slice().sort((a,b)=>(a.min[axis]+a.max[axis])-(b.min[axis]+b.max[axis]) || a.index-b.index),mid=Math.floor(items.length/2);
      return {min,max,left:tree(ordered.slice(0,mid)),right:tree(ordered.slice(mid))};
    }
    const index=tree(triangles);
    const projected=(p,axis)=>p.filter((_,i)=>i!==axis);
    const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    function inTriangle(p,t) {
      const axis=t.n.map(Math.abs).indexOf(Math.max(...t.n.map(Math.abs))),q=projected(p,axis),r=t.p.map(a=>projected(a,axis));
      const area=orient(...r),bary=[orient(q,r[1],r[2])/area,orient(r[0],q,r[2])/area,orient(r[0],r[1],q)/area];
      const longest=Math.max(...[0,1,2].map(i=>Math.hypot(...g.sub(t.p[i],t.p[(i+1)%3]))));
      const slack=eps*longest/Math.abs(area);
      return bary.every(x=>x>=-slack && x<=1+slack);
    }
    function onLine(p,a,b) {
      const d=g.sub(b,a),den=g.dot(d,d);
      if(!den) return Math.hypot(...g.sub(p,a))<=eps;
      const u=g.dot(g.sub(p,a),d)/den;
      return u>=-eps/Math.sqrt(den) && u<=1+eps/Math.sqrt(den) && Math.hypot(...g.sub(p,g.add(a,g.mul(d,u))))<=eps;
    }
    function collision(a,b) {
      const common=a.ids.filter(i=>b.ids.includes(i)).map(i=>v[i]);
      if(common.length===3) return true;
      const allowed=p=>common.length===1?Math.hypot(...g.sub(p,common[0]))<=eps:common.length===2 && onLine(p,...common);
      const da=a.p.map(p=>g.dot(b.n,g.sub(p,b.p[0]))),db=b.p.map(p=>g.dot(a.n,g.sub(p,a.p[0])));
      if(da.every(x=>x>eps) || da.every(x=>x<-eps) || db.every(x=>x>eps) || db.every(x=>x<-eps)) return false;
      if(da.every(x=>Math.abs(x)<=eps) && db.every(x=>Math.abs(x)<=eps)) {
        // Coplanar overlap: include interior vertices and every edge contact,
        // allowing only the shared indexed vertex/edge of neighbouring faces.
        for(const p of a.p) if(inTriangle(p,b) && !allowed(p)) return true;
        for(const p of b.p) if(inTriangle(p,a) && !allowed(p)) return true;
        const axis=a.n.map(Math.abs).indexOf(Math.max(...a.n.map(Math.abs)));
        for(let i=0;i<3;i++) for(let j=0;j<3;j++) {
          const p=a.p[i],q=a.p[(i+1)%3],r=b.p[j],s=b.p[(j+1)%3],u=projected(g.sub(q,p),axis),w=projected(g.sub(s,r),axis),delta=projected(g.sub(r,p),axis),den=u[0]*w[1]-u[1]*w[0];
          if(den===0) continue; // Collinear overlaps already supply an endpoint above.
          const t=(delta[0]*w[1]-delta[1]*w[0])/den,h=(delta[0]*u[1]-delta[1]*u[0])/den;
          if(t>=0 && t<=1 && h>=0 && h<=1 && !allowed(g.add(p,g.mul(g.sub(q,p),t)))) return true;
        }
        return false;
      }
      for(const [from,to,dist] of [[a,b,da],[b,a,db]]) {
        for(let i=0;i<3;i++) {
          const p=from.p[i],q=from.p[(i+1)%3],d=dist[i],e=dist[(i+1)%3];
          if(Math.abs(d)<=eps && inTriangle(p,to) && !allowed(p)) return true;
          if((d<0 && e>0) || (d>0 && e<0)) {
            const hit=g.add(p,g.mul(g.sub(q,p),d/(d-e)));
            if(inTriangle(hit,to) && !allowed(hit)) return true;
          }
        }
      }
      return false;
    }
    let candidatePairs=0;
    function visit(node,t) {
      if(!intersectsBox(node,t)) return;
      if(node.items) for(const other of node.items) {
        if(other.index<=t.index || !intersectsBox(t,other)) continue;
        if(++candidatePairs>maxPairs) throw Error('DOMAIN_SOLID_PAIR_BUDGET');
        if(collision(t,other)) throw Error('DOMAIN_SOLID_SELF_INTERSECTION');
      }
      else {visit(node.left,t);visit(node.right,t);}
    }
    for(const t of triangles) visit(index,t);
    function classify(point) {
      if(!Array.isArray(point) || point.length!==3 || !point.every(Number.isFinite)) throw Error('DOMAIN_COORDINATE_INVALID');
      const p=g.sub(point,origin);
      if([0,1,2].some(k=>p[k]<index.min[k]-eps || p[k]>index.max[k]+eps)) return 'outside';
      let angle=0;
      for(const t of triangles) {
        if(Math.abs(g.dot(t.n,g.sub(p,t.p[0])))<=eps && inTriangle(p,t)) return 'boundary';
        const [a,b,c]=t.p.map(q=>g.sub(q,p)),la=Math.hypot(...a),lb=Math.hypot(...b),lc=Math.hypot(...c);
        angle+=2*Math.atan2(g.dot(a,g.cross(b,c)),la*lb*lc+g.dot(a,b)*lc+g.dot(b,c)*la+g.dot(c,a)*lb);
      }
      return Math.abs(angle)>2*Math.PI?'inside':'outside';
    }
    return Object.freeze({volume:report.volume,tolerance:eps,candidatePairs,classify,
      scope:'One closed, positively oriented, non-self-intersecting shell; boundary is explicit. Geological honouring, topography and domain overlap are separate checks.'});
  }
  root.OrebitDomainSolid=Object.freeze({prepareSolid});
})(typeof window==='undefined'?globalThis:window);
