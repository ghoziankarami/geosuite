/* P6.02: fail-closed DXF 3DFACE TIN reader. No CRS transform is inferred. */
(function(root){
  'use strict';
  function unitCode(text){
    const lines=String(text||'').split(/\r?\n/),pairs=[];
    for(let i=0;i+1<lines.length;i+=2)pairs.push([lines[i].trim(),lines[i+1].trim()]);
    for(let i=0;i+1<pairs.length;i++)if(pairs[i][0]==='9'&&pairs[i][1]==='$INSUNITS'&&pairs[i+1][0]==='70'){
      const n=Number(pairs[i+1][1]);return Number.isInteger(n)?n:null;
    }
    return null;
  }
  const orient=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const area=poly=>{if(poly.length<3)return 0;const o=poly[0];let s=0;for(let i=0;i<poly.length;i++){const a=[poly[i][0]-o[0],poly[i][1]-o[1]],q=poly[(i+1)%poly.length],b=[q[0]-o[0],q[1]-o[1]];s+=a[0]*b[1]-b[0]*a[1];}return s/2;};
  function hull(points){
    const p=[...new Map(points.map(q=>[q[0]+':'+q[1],[q[0],q[1]]])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    if(p.length<3)throw Error('SURFACE_IMPORT_COVERAGE_EXTENT_INVALID');
    const half=items=>{const out=[];for(const q of items){while(out.length>1&&orient(out.at(-2),out.at(-1),q)<=0)out.pop();out.push(q);}return out;};
    const out=half(p).slice(0,-1).concat(half(p.slice().reverse()).slice(0,-1));
    if(out.length<3||area(out)<=0)throw Error('SURFACE_IMPORT_COVERAGE_EXTENT_INVALID');return out;
  }
  function clip(subject, boundary, eps){
    let out=subject.map(p=>p.slice());
    for(let i=0;i<boundary.length&&out.length;i++){
      const a=boundary[i],b=boundary[(i+1)%boundary.length],input=out;out=[];
      const side=p=>orient(a,b,p),inside=p=>side(p)>=-eps;
      const cross=(p,q,sp,sq)=>{const d=sp-sq;if(Math.abs(d)<=Number.EPSILON)return q.slice();const t=Math.max(0,Math.min(1,sp/d));return [p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])];};
      let prev=input.at(-1),sp=side(prev);
      for(const cur of input){const sc=side(cur),ip=inside(prev),ic=inside(cur);if(ic){if(!ip)out.push(cross(prev,cur,sp,sc));out.push(cur);}else if(ip)out.push(cross(prev,cur,sp,sc));prev=cur;sp=sc;}
    }
    return out;
  }
  const bounds=poly=>[Math.min(...poly.map(p=>p[0])),Math.min(...poly.map(p=>p[1])),Math.max(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[1]))];
  function assessCoverage(tin,targetMesh,options={}){
    if(!tin||!Array.isArray(tin.v)||!Array.isArray(tin.triangles)||!targetMesh||!Array.isArray(targetMesh.v)||targetMesh.v.length<4||targetMesh.v.length>100000||targetMesh.v.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v))))throw Error('SURFACE_IMPORT_COVERAGE_INPUT_INVALID');
    const footprint=hull(targetMesh.v),targetArea=area(footprint),span=Math.max(...footprint.map(p=>p[0]))-Math.min(...footprint.map(p=>p[0]));
    const scale=Math.max(span,Math.max(...footprint.map(p=>p[1]))-Math.min(...footprint.map(p=>p[1])),1),eps=1e-10*scale*scale,tol=1e-9*Math.max(targetArea,1);
    const prepared=root.OrebitGeometryPrimitives.prepareTIN(tin),parts=[];
    for(const tri of preparedTriangles(tin)){
      const p=clip(tri,footprint,eps),a=Math.abs(area(p));if(a>tol*1e-6)parts.push({poly:p,box:bounds(p),area:a});
    }
    let comparisons=0,covered=0,comp=0;const maxPairs=options.maxPairs??1000000;
    for(let i=0;i<parts.length;i++){
      const part=parts[i],y=part.area-comp,next=covered+y;comp=(next-covered)-y;covered=next;
      for(let j=0;j<i;j++){
        const other=parts[j];if(part.box[0]>=other.box[2]||other.box[0]>=part.box[2]||part.box[1]>=other.box[3]||other.box[1]>=part.box[3])continue;
        if(++comparisons>maxPairs)throw Error('SURFACE_IMPORT_COVERAGE_PAIR_BUDGET');
        const overlap=clip(part.poly,other.poly,eps);if(Math.abs(area(overlap))>tol*1e-6)return {status:'overlap',fullSurfaceCoverage:false,coveredArea:covered,targetArea,reason:'OVERLAPPING_TERRAIN_FACES',method:'convex-hull-XY-union-area'};
      }
    }
    const fullSurfaceCoverage=Math.abs(covered-targetArea)<=tol;
    return {status:fullSurfaceCoverage?'covered':'partial',fullSurfaceCoverage,coveredArea:Math.min(covered,targetArea),targetArea,
      reason:fullSurfaceCoverage?null:'TERRAIN_DOES_NOT_COVER_CONVEX_SOLID_FOOTPRINT',method:'convex-hull-XY-union-area',conservative:true,triangleComparisons:comparisons};
  }
  function preparedTriangles(tin){return tin.triangles.map(indices=>indices.map(i=>tin.v[i].slice()));}
  function readDXF3DFaceTIN(text,options={}){
    if(!root.OrebitDomainDXF||!root.OrebitGeometryPrimitives)throw Error('SURFACE_IMPORT_DEPENDENCY');
    const sourceCRS=String(options.sourceCRS||'').trim(),targetCRS=String(options.targetCRS||'').trim();
    if(!sourceCRS||!targetCRS)throw Error('SURFACE_IMPORT_CRS_REQUIRED');
    if(sourceCRS!==targetCRS)throw Error('SURFACE_IMPORT_CRS_MISMATCH');
    if(unitCode(text)!==6)throw Error('SURFACE_IMPORT_METRES_REQUIRED');
    if(!/^[a-f0-9]{64}$/i.test(String(options.sourceHash||'')))throw Error('SURFACE_IMPORT_SOURCE_HASH_REQUIRED');
    const parsed=root.OrebitDomainDXF.readSolids(text),names=Object.keys(parsed.layers);
    const unsupported=Object.entries(parsed.unsupported||{}).filter(([,count])=>count>0);
    if(unsupported.length)throw Error('SURFACE_IMPORT_UNSUPPORTED_ENTITIES:'+unsupported.map(([name,count])=>name+'='+count).join(','));
    const layer=options.layer==null?(names.length===1?names[0]:null):String(options.layer);
    if(!layer||!parsed.layers[layer])throw Error(names.length>1?'SURFACE_IMPORT_LAYER_REQUIRED':'SURFACE_IMPORT_3DFACE_REQUIRED');
    const mesh=parsed.layers[layer];
    if(mesh.v.length<3||mesh.v.length>2000||mesh.f.length<1||mesh.f.length>4000)throw Error('SURFACE_IMPORT_GEOMETRY_BUDGET');
    const xy=new Map();
    for(const p of mesh.v){
      if(!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))throw Error('SURFACE_IMPORT_COORDINATE_INVALID');
      const key=p[0]+':'+p[1],z=xy.get(key);
      if(z!=null&&z!==p[2])throw Error('SURFACE_IMPORT_MULTIVALUED_TERRAIN');
      xy.set(key,p[2]);
    }
    const triangles=[];
    for(const f of mesh.f){
      if(!Array.isArray(f)||f.length!==3||f.some(i=>!Number.isInteger(i)||i<0||i>=mesh.v.length))throw Error('SURFACE_IMPORT_FACE_INVALID');
      const area=orient(mesh.v[f[0]],mesh.v[f[1]],mesh.v[f[2]]);
      if(!Number.isFinite(area)||Math.abs(area)<=1e-12)throw Error('SURFACE_IMPORT_VERTICAL_OR_DEGENERATE_FACE');
      triangles.push(area>0?f.slice():[f[0],f[2],f[1]]);
    }
    const tin={v:mesh.v.map(p=>p.slice()),triangles};
    root.OrebitGeometryPrimitives.prepareTIN(tin);
    return {kind:'imported-dxf-3dface-tin',...tin,layer,units:'m',crs:targetCRS,
      provenance:{fileName:String(options.fileName||''),format:'DXF R12 3DFACE',entity:'3DFACE',layer,
        sourceHash:String(options.sourceHash).toLowerCase(),sourceCRS,targetCRS,sourceUnits:'m',transform:'identity'},
      coverage:{status:'not-assessed',fullSurfaceCoverage:false,reason:'TARGET_EXTENT_REQUIRED'}};
  }
  function probeCoverage(tin,points){
    if(!tin||!Array.isArray(points)||!points.length)throw Error('SURFACE_IMPORT_COVERAGE_POINTS_REQUIRED');
    const index=root.OrebitGeometryPrimitives.prepareTIN(tin),outside=[];
    points.forEach((p,i)=>{if(!Array.isArray(p)||p.length<2||!p.slice(0,2).every(Number.isFinite))throw Error('SURFACE_IMPORT_COVERAGE_POINT_INVALID');if(!index.sample(p[0],p[1]))outside.push(i);});
    return {status:outside.length?'partial':'probe-covered',outsidePointIndexes:outside,
      fullSurfaceCoverage:false,method:'explicit-point-probe-not-area-proof'};
  }
  root.OrebitSurfaceImport=Object.freeze({unitCode,readDXF3DFaceTIN,probeCoverage,assessCoverage});
})(typeof window==='undefined'?globalThis:window);
