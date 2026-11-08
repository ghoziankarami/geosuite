/* Domain S2: pure metre-based geometry. No inference, extrapolation or raw edits. */
(function(root) {
  'use strict';
  const finitePoint = (p, n) => Array.isArray(p) && p.length === n && p.every(Number.isFinite);
  const dot = (a,b) => a.reduce((s,x,i) => s+x*b[i],0);
  const sub = (a,b) => a.map((x,i) => x-b[i]);
  const add = (a,b) => a.map((x,i) => x+b[i]);
  const mul = (a,t) => a.map(x => x*t);
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  function unit(a) {
    if (!finitePoint(a,3)) throw Error('DOMAIN_VECTOR_INVALID');
    const n=Math.hypot(...a);
    if (!(n>0) || !Number.isFinite(n)) throw Error('DOMAIN_VECTOR_INVALID');
    return mul(a,1/n);
  }
  function sectionPlane(origin,azimuth,dip=90) {
    if (!finitePoint(origin,3) || !Number.isFinite(azimuth) || !Number.isFinite(dip) || dip<0 || dip>90) throw Error('DOMAIN_PLANE_INVALID');
    const az=((azimuth%360)+360)%360*Math.PI/180,d=dip*Math.PI/180;
    const u=[Math.sin(az),Math.cos(az),0],v=[Math.cos(az)*Math.cos(d),-Math.sin(az)*Math.cos(d),-Math.sin(d)];
    return Object.freeze({origin:Object.freeze(origin.slice()),u:Object.freeze(u),v:Object.freeze(v),normal:Object.freeze(unit(cross(u,v)))});
  }
  function checkPlane(p) {
    if (!p || !['origin','u','v','normal'].every(k=>finitePoint(p[k],3)) ||
        ['u','v','normal'].some(k=>Math.abs(dot(p[k],p[k])-1)>1e-10) ||
        Math.abs(dot(p.u,p.v))>1e-10 || Math.abs(dot(p.u,p.normal))>1e-10 || Math.abs(dot(p.v,p.normal))>1e-10 ||
        dot(cross(p.u,p.v),p.normal)<1-1e-10) throw Error('DOMAIN_PLANE_INVALID');
  }
  function project(plane,p) {
    checkPlane(plane); if (!finitePoint(p,3)) throw Error('DOMAIN_COORDINATE_INVALID');
    const d=sub(p,plane.origin); return [dot(d,plane.u),dot(d,plane.v),dot(d,plane.normal)];
  }
  function unproject(plane,p) {
    checkPlane(plane); if (!finitePoint(p,2) && !finitePoint(p,3)) throw Error('DOMAIN_COORDINATE_INVALID');
    return add(plane.origin,add(mul(plane.u,p[0]),add(mul(plane.v,p[1]),mul(plane.normal,p.length===2?0:p[2]))));
  }
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function polygonArea(p) {
    if (!Array.isArray(p) || p.some(v=>!finitePoint(v,2))) throw Error('DOMAIN_POLYGON_INVALID');
    let area=0; for(let i=1;i<p.length-1;i++) area+=orient(p[0],p[i],p[i+1]);
    return area/2;
  }
  function onSegment(a,b,p,tol=1e-9) {
    return Math.abs(orient(a,b,p))<=tol*Math.max(1,Math.hypot(b[0]-a[0],b[1]-a[1])) &&
      p[0]>=Math.min(a[0],b[0])-tol && p[0]<=Math.max(a[0],b[0])+tol && p[1]>=Math.min(a[1],b[1])-tol && p[1]<=Math.max(a[1],b[1])+tol;
  }
  function segmentsIntersect(a,b,c,d) {
    const ac=orient(a,b,c),ad=orient(a,b,d),ca=orient(c,d,a),cb=orient(c,d,b);
    return (ac*ad<0 && ca*cb<0) || onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
  }
  function inspectPolygon(input) {
    if (!Array.isArray(input) || input.length<3 || input.length>2000 || input.some(p=>!finitePoint(p,2))) throw Error('DOMAIN_POLYGON_INVALID');
    const p=input.map(v=>v.slice());
    if (p.length>3 && p[0][0]===p.at(-1)[0] && p[0][1]===p.at(-1)[1]) p.pop();
    for(let i=0;i<p.length;i++) {
      const a=p[i],b=p[(i+1)%p.length],c=p[(i+2)%p.length];
      if (a[0]===b[0] && a[1]===b[1]) throw Error('DOMAIN_POLYGON_DUPLICATE');
      if (onSegment(a,b,c) && !(c[0]===b[0] && c[1]===b[1])) throw Error('DOMAIN_POLYGON_SELF_INTERSECTION');
      for(let j=i+1;j<p.length;j++) {
        if (j===i+1 || (i===0 && j===p.length-1)) continue;
        if (segmentsIntersect(a,b,p[j],p[(j+1)%p.length])) throw Error('DOMAIN_POLYGON_SELF_INTERSECTION');
      }
    }
    const area=polygonArea(p);
    if (Math.abs(area)<1e-10) throw Error('DOMAIN_POLYGON_DEGENERATE');
    return {points:area>0?p:p.reverse(),area:Math.abs(area)};
  }
  function preparePolygon(input) {
    const inspected=inspectPolygon(input),ring=inspected.points;
    return Object.freeze({area:inspected.area,contains(p) {
      if (!finitePoint(p,2)) throw Error('DOMAIN_COORDINATE_INVALID');
      let inside=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const a=ring[j],b=ring[i]; if (onSegment(a,b,p)) return true;
        if ((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
      }
      return inside;
    }});
  }
  const insidePolygon=(p,input)=>preparePolygon(input).contains(p);
  function hull(points) {
    const sorted=points.map((p,i)=>i).sort((a,b)=>points[a][0]-points[b][0] || points[a][1]-points[b][1]);
    const half=ids=>{const out=[]; for(const i of ids) {while(out.length>1 && orient(points[out.at(-2)],points[out.at(-1)],points[i])<=0) out.pop(); out.push(i);} return out;};
    return [...half(sorted).slice(0,-1),...half(sorted.slice().reverse()).slice(0,-1)];
  }
  function makeTIN(input,maxEdge=Infinity) {
    if (!Array.isArray(input) || input.length<3 || input.length>2000 || input.some(p=>!finitePoint(p,3)) ||
        typeof maxEdge!=='number' || !(maxEdge>0)) throw Error('DOMAIN_TIN_INPUT');
    const unique=new Map(),v=[];
    for(const p of input) {
      const key=p[0]+':'+p[1];
      if (unique.has(key)) {if (v[unique.get(key)][2]!==p[2]) throw Error('DOMAIN_SURFACE_MULTIVALUED'); continue;}
      unique.set(key,v.length); v.push(p.slice());
    }
    const boundary=hull(v); if(boundary.length<3) throw Error('DOMAIN_TIN_COLLINEAR');
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const p of v) {minX=Math.min(minX,p[0]);minY=Math.min(minY,p[1]);maxX=Math.max(maxX,p[0]);maxY=Math.max(maxY,p[1]);}
    const ox=minX+(maxX-minX)/2,oy=minY+(maxY-minY)/2,D=Math.max(maxX-minX,maxY-minY);
    if (!Number.isFinite(D) || !(D>0)) throw Error('DOMAIN_TIN_INPUT');
    const local=v.map(p=>[(p[0]-ox)/D,(p[1]-oy)/D]),n=v.length;
    const order=local.map((p,i)=>i).sort((a,b)=>local[a][0]-local[b][0] || local[a][1]-local[b][1]);
    const expected=Math.abs(polygonArea(boundary.map(i=>local[i])));
    let full=null;
    // Finite supertriangles can omit very narrow hull cells. Retry and verify coverage;
    // never silently publish a surface with those cells missing.
    for(const extent of [20,1024,65536]) {
      const pts=[...local,[-extent,-extent],[extent,-extent],[0,extent]],tris=[[n,n+1,n+2]];
      const circle=(t,p)=>{
        // This predicate runs O(n²) times. Scalar temporaries avoid millions
        // of transient arrays without approximating or thinning the points.
        const a=pts[t[0]],b=pts[t[1]],c=pts[t[2]],ax=a[0]-p[0],ay=a[1]-p[1],bx=b[0]-p[0],by=b[1]-p[1],cx=c[0]-p[0],cy=c[1]-p[1];
        const first=(ax*ax+ay*ay)*(bx*cy-by*cx),second=-(bx*bx+by*by)*(ax*cy-ay*cx),third=(cx*cx+cy*cy)*(ax*by-ay*bx);
        const det=first+second+third,tol=8*Number.EPSILON*(Math.abs(first)+Math.abs(second)+Math.abs(third));
        return det>=-tol;
      };
      let current=tris;
      for(const i of order) {
        const edges=new Map(),keep=[]; let bad=0;
        for(const t of current) {
          if (!circle(t,pts[i])) {keep.push(t); continue;}
          bad++; for(let j=0;j<3;j++) {const a=t[j],b=t[(j+1)%3],key=Math.min(a,b)+':'+Math.max(a,b); if(edges.has(key)) edges.delete(key); else edges.set(key,[a,b]);}
        }
        if (!bad) throw Error('DOMAIN_TIN_INSERT');
        for(const [a,b] of edges.values()) {const o=orient(pts[a],pts[b],pts[i]);if(o!==0) keep.push(o>0?[a,b,i]:[b,a,i]);}
        current=keep;
      }
      const candidate=current.filter(t=>t.every(i=>i<n)),area=candidate.reduce((s,t)=>s+orient(...t.map(i=>local[i]))/2,0);
      if (candidate.length && Math.abs(area-expected)<=1e-12*Math.max(expected,1e-12)) {full=candidate;break;}
    }
    if (!full) throw Error('DOMAIN_TIN_PRECISION');
    const triangles=full.filter(t=>[0,1,2].every(j=>Math.hypot(v[t[j]][0]-v[t[(j+1)%3]][0],v[t[j]][1]-v[t[(j+1)%3]][1])<=maxEdge));
    return {v,triangles,rejected:full.length-triangles.length,maxEdge:Number.isFinite(maxEdge)?maxEdge:null};
  }
  function prepareTIN(tin) {
    if (!tin || !Array.isArray(tin.v) || tin.v.length<3 || tin.v.length>2000 || tin.v.some(p=>!finitePoint(p,3)) ||
        !Array.isArray(tin.triangles) || tin.triangles.length>4000) throw Error('DOMAIN_TIN_INPUT');
    const triangles=tin.triangles.map((t,index)=>{
      if (!Array.isArray(t) || t.length!==3 || t.some(i=>!Number.isInteger(i) || i<0 || i>=tin.v.length)) throw Error('DOMAIN_FACE_INVALID');
      const [a,b,c]=t.map(i=>tin.v[i].slice()),area=orient(a,b,c);
      if (!(area>0)) throw Error('DOMAIN_TIN_DEGENERATE');
      return {a,b,c,area,index,indices:t.slice(),min:[Math.min(a[0],b[0],c[0]),Math.min(a[1],b[1],c[1])],max:[Math.max(a[0],b[0],c[0]),Math.max(a[1],b[1],c[1])]};
    });
    function tree(items) {
      if(!items.length) return null;
      const min=[0,1].map(k=>Math.min(...items.map(t=>t.min[k]))),max=[0,1].map(k=>Math.max(...items.map(t=>t.max[k])));
      if(items.length<=8) return {min,max,items};
      const axis=max[0]-min[0]>=max[1]-min[1]?0:1,ordered=items.slice().sort((a,b)=>(a.min[axis]+a.max[axis])-(b.min[axis]+b.max[axis]) || a.index-b.index),mid=Math.floor(items.length/2);
      return {min,max,left:tree(ordered.slice(0,mid)),right:tree(ordered.slice(mid))};
    }
    const index=tree(triangles);
    return Object.freeze({sample(x,y) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw Error('DOMAIN_COORDINATE_INVALID');
      const p=[x,y]; let best=null;
      function visit(node) {
        if(!node || x<node.min[0] || x>node.max[0] || y<node.min[1] || y>node.max[1]) return;
        if(node.items) for(const t of node.items) {
          if((best && t.index>=best.index) || x<t.min[0] || x>t.max[0] || y<t.min[1] || y>t.max[1]) continue;
          const u=orient(p,t.b,t.c)/t.area,w=orient(t.a,p,t.c)/t.area,z=1-u-w;
          if(u>=-1e-12 && w>=-1e-12 && z>=-1e-12) best={z:u*t.a[2]+w*t.b[2]+z*t.c[2],triangle:t.indices.slice(),index:t.index};
        }
        else {visit(node.left);visit(node.right);}
      }
      visit(index);return best?{z:best.z,triangle:best.triangle}:null;
    }});
  }
  const sampleTIN=(tin,x,y)=>prepareTIN(tin).sample(x,y);
  const pair=(fn)=>(a,b)=>{if((!finitePoint(a,2) && !finitePoint(a,3)) || !finitePoint(b,a.length)) throw Error('DOMAIN_VECTOR_INVALID');return fn(a,b);};
  const safeMul=(a,t)=>{if((!finitePoint(a,2) && !finitePoint(a,3)) || !Number.isFinite(t)) throw Error('DOMAIN_VECTOR_INVALID');return mul(a,t);};
  const safeCross=(a,b)=>{if(!finitePoint(a,3) || !finitePoint(b,3)) throw Error('DOMAIN_VECTOR_INVALID');return cross(a,b);};
  root.OrebitGeometryPrimitives=Object.freeze({dot:pair(dot),sub:pair(sub),add:pair(add),mul:safeMul,cross:safeCross,unit,sectionPlane,project,unproject,polygonArea,inspectPolygon,preparePolygon,insidePolygon,makeTIN,prepareTIN,sampleTIN});
})(typeof window==='undefined'?globalThis:window);
