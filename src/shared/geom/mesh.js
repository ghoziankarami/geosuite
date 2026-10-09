/* Shared Core geological-domain foundation. No inferred surfaces or assay mutation. */
(function(root){
  'use strict';
  function inspectMesh(mesh, limits={}){
    const v=mesh?.v,f=mesh?.f;
    if(!Array.isArray(v)||!Array.isArray(f)||v.length<4||f.length<4)throw new Error('DOMAIN_MESH_MISSING');
    if(v.length>(limits.maxVertices||100000)||f.length>(limits.maxFaces||200000))throw new Error('DOMAIN_MESH_BUDGET');
    if(v.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw new Error('DOMAIN_COORDINATE_INVALID');
    const origin=v[0],edges=new Map();let degenerateFaces=0,signedVolume=0;
    const subtract=p=>p.map((x,i)=>x-origin[i]);
    for(const face of f){
      if(!Array.isArray(face)||face.length!==3||face.some(i=>!Number.isInteger(i)||i<0||i>=v.length))throw new Error('DOMAIN_FACE_INVALID');
      const [a,b,c]=face.map(i=>subtract(v[i]));
      const ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]);
      const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
      if(cross.every(x=>x===0))degenerateFaces++;
      signedVolume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      for(let i=0;i<3;i++){
        const x=face[i],y=face[(i+1)%3],key=Math.min(x,y)+':'+Math.max(x,y);
        const edge=edges.get(key)||{count:0,balance:0};edge.count++;edge.balance+=x<y?1:-1;edges.set(key,edge);
      }
    }
    let boundaryEdges=0,nonManifoldEdges=0,inconsistentEdges=0;
    edges.forEach(e=>{if(e.count===1)boundaryEdges++;if(e.count>2)nonManifoldEdges++;if(e.count===2&&e.balance!==0)inconsistentEdges++;});
    const closed=!boundaryEdges&&!nonManifoldEdges&&!inconsistentEdges&&!degenerateFaces;
    return {vertices:v.length,faces:f.length,boundaryEdges,nonManifoldEdges,inconsistentEdges,degenerateFaces,closed,signedVolume,volume:closed&&signedVolume>0?signedVolume:null,
      scope:'Topology and signed volume only; self-intersections, geological interpretation and topographic clipping require separate validation.'};
  }
  root.OrebitDomainGeometry=Object.freeze({inspectMesh});
})(typeof window==='undefined'?globalThis:window);
