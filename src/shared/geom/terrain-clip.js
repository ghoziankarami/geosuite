/* Exact signed-tetrahedron clipping of a closed geology shell below a reviewed
   piecewise-linear terrain TIN and into regular block cells. */
(function(root){
  'use strict';
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const sub=(a,b)=>a.map((x,i)=>x-b[i]);
  const plane=(a,b,c)=>{
    const u=sub(b,a),v=sub(c,a),n=cross(u,v),d=dot(n,a),length=Math.hypot(...n);
    if(!(length>0))throw Error('TERRAIN_CLIP_TIN_DEGENERATE');
    const q=n.map(x=>x/length);return {n:q,d:d/length};
  };
  function terrainTriangles(tin,shift=[0,0,0]){
    if(!tin||!Array.isArray(tin.v)||tin.v.length<3||tin.v.length>2000||tin.v.some(p=>!Array.isArray(p)||p.length!==3||p.some(x=>!Number.isFinite(x)))||!Array.isArray(tin.triangles)||tin.triangles.length===0||tin.triangles.length>4000)throw Error('TERRAIN_CLIP_SURFACE_REQUIRED');
    return tin.triangles.map(indices=>{
      if(!Array.isArray(indices)||indices.length!==3||indices.some(i=>!Number.isInteger(i)||i<0||i>=tin.v.length))throw Error('TERRAIN_CLIP_TIN_INVALID');
      const p=indices.map(i=>Array.isArray(tin.v[i])?tin.v[i].slice():tin.v[i]);if(p.some(q=>!Array.isArray(q)||q.length!==3||q.some(x=>!Number.isFinite(x))))throw Error('TERRAIN_CLIP_TIN_INVALID');
      for(const q of p)for(let k=0;k<3;k++)q[k]-=shift[k];
      const [a,b,c]=p;
      // TIN triangles are counter-clockwise in XY; orient all three vertical
      // prism faces inward-independent by testing the centroid.
      const xy=[a,b,c].map(q=>[q[0],q[1]]),cent=[xy.reduce((s,q)=>s+q[0],0)/3,xy.reduce((s,q)=>s+q[1],0)/3];
      const sides=[];
      for(let i=0;i<3;i++){
        const u=xy[i],v=xy[(i+1)%3],dx=v[0]-u[0],dy=v[1]-u[1],n=[dy,-dx,0],d=dy*u[0]-dx*u[1];
        const sign=n[0]*cent[0]+n[1]*cent[1]-d;
        sides.push(sign<=0?{n,d}:{n:n.map(x=>-x),d:-d});
      }
      const ground=plane(a,b,c);
      // plane() gives the 3D plane through the vertices. Keep n·p <= d,
      // which is exactly z <= terrain(x,y) because vertical triangles are valid.
      if(Math.abs(ground.n[2])<1e-12)throw Error('TERRAIN_CLIP_TIN_VERTICAL');
      const top={n:[ground.n[0]/ground.n[2],ground.n[1]/ground.n[2],1],d:ground.d/ground.n[2]};
      const min=[0,1].map(k=>Math.min(...p.map(q=>q[k]))),max=[0,1].map(k=>Math.max(...p.map(q=>q[k])));
      return {planes:[...sides,top],min,max};
    });
  }
  function* run(mesh,tin,grid,options={}){
    if(!root.OrebitConvexClip)throw Error('DOMAIN_GEOMETRY_DEPENDENCY');
    const [ox,oy,oz]=grid.origin,[dx,dy,dz]=grid.size,[nx,ny,nz]=grid.count;
    if(![ox,oy,oz,dx,dy,dz].every(Number.isFinite)||![dx,dy,dz].every(x=>x>0)||![nx,ny,nz].every(x=>Number.isSafeInteger(x)&&x>0)||nx*ny*nz>2000000)throw Error('DOMAIN_CLIP_GRID_INVALID');
    const tris=terrainTriangles(tin,grid.origin),shell=root.OrebitConvexClip.shell(mesh,grid.origin),count=nx*ny*nz,out=new Float64Array(count),correction=new Float64Array(count);
    let examined=0,pairs=0,intersections=0,inside=0,surfaceSolid=0,surfaceCorrection=0;
    for(const tetra of shell.cells)for(const tri of tris){
      if((++pairs&127)===0)yield {pairs:examined,intersections};
      if(tetra.max[0]<=tri.min[0]||tetra.min[0]>=tri.max[0]||tetra.max[1]<=tri.min[1]||tetra.min[1]>=tri.max[1])continue;
      if(++examined>(options.maxPairs||1000000))throw Error('TERRAIN_CLIP_PAIR_BUDGET');
      const faces=root.OrebitConvexClip.intersectionFaces(tetra,tri.planes);
      const clipped=tetra.sign*root.OrebitConvexClip.volume(faces),surfaceAdjusted=clipped-surfaceCorrection,surfaceNext=surfaceSolid+surfaceAdjusted;
      surfaceCorrection=(surfaceNext-surfaceSolid)-surfaceAdjusted;surfaceSolid=surfaceNext;
      if(clipped===0)continue;
      // Terrain planes have already been applied. Their actual clipped bounds
      // exclude empty height ranges; each cell then applies only its own planes
      // to those same faces, in the original clipping order and tolerance.
      const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
      for(const face of faces)for(const p of face)for(let axis=0;axis<3;axis++){lo[axis]=Math.min(lo[axis],p[axis]);hi[axis]=Math.max(hi[axis],p[axis]);}
      const piece={faces,min:lo,max:hi,p:[...new Set(faces.flat())],planes:[...tetra.planes,...tri.planes],volume:Math.abs(clipped)};
      if(hi[2]<=lo[2])continue;
      const range=(a,b,o,d,n)=>[Math.max(0,Math.floor((a-o)/d)),Math.min(n-1,Math.ceil((b-o)/d)-1)];
      const [i0,i1]=range(lo[0],hi[0],0,dx,nx),[j0,j1]=range(lo[1],hi[1],0,dy,ny),[k0,k1]=range(lo[2],hi[2],0,dz,nz);
      for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const cellLo=[i*dx,j*dy,k*dz],cellHi=cellLo.map((x,n)=>x+[dx,dy,dz][n]);
        const value=tetra.sign*root.OrebitConvexClip.box(piece,cellLo,cellHi,1e-10);
        if(Math.abs(value)>0){const at=i+nx*(j+ny*k),adjusted=value-correction[at],next=out[at]+adjusted;correction[at]=(next-out[at])-adjusted;out[at]=next;intersections++;}
        if(++inside>(options.maxIntersections||2000000))throw Error('TERRAIN_CLIP_INTERSECTION_BUDGET');
        if((inside&127)===0)yield {pairs:examined,intersections};
      }
    }
    let total=0,comp=0;const block=dx*dy*dz,tolerance=block*(1e-8+64*Number.EPSILON*shell.cells.length);
    for(let i=0;i<count;i++){
      if(out[i]<-tolerance||out[i]>block+tolerance)throw Error('TERRAIN_CLIP_RECONCILIATION');
      out[i]=Math.max(0,Math.min(block,out[i]));const y=out[i]-comp,t=total+y;comp=(t-total)-y;total=t;
    }
    const reconciliationTolerance=Math.max(shell.volume,block)*1e-8;
    if(surfaceSolid < -reconciliationTolerance || surfaceSolid > shell.volume+reconciliationTolerance || total > surfaceSolid+reconciliationTolerance)throw Error('TERRAIN_CLIP_RECONCILIATION');
    return {filled:out,total,solid:Math.max(0,Math.min(shell.volume,surfaceSolid)),outside:Math.max(0,surfaceSolid-total),terrainExcluded:Math.max(0,shell.volume-surfaceSolid),sourceSolid:shell.volume,blockVolume:block,triangles:mesh.f.length,terrainTriangles:tris.length,method:'signed-tetrahedral-terrain-intersection',pairs:examined,intersections};
  }
  function fractions(mesh,tin,grid,options={}){const it=run(mesh,tin,grid,options);for(;;){if(options.cancelled?.())return null;const r=it.next();if(r.done)return r.value;}}
  function fractionsAsync(mesh,tin,grid,options={}){
    const it=run(mesh,tin,grid,options),cancelled=options.cancelled||(()=>false),budget=options.sliceMs||12,tick=options.schedule||(f=>setTimeout(f,0));
    return new Promise((resolve,reject)=>{const step=()=>{try{const start=Date.now();for(;;){if(cancelled())return resolve(null);const r=it.next();if(r.done)return resolve(r.value);options.progress?.(r.value);if(Date.now()-start>budget)return tick(step);}}catch(error){reject(error);}};step();});
  }
  root.OrebitTerrainClip=Object.freeze({fractions,fractionsAsync});
})(typeof window==='undefined'?globalThis:window);
