import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geom/mesh.js'),'utf8'),ctx);
const inspect=ctx.OrebitDomainGeometry.inspectMesh;
const v=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const mesh={v,f},before=JSON.stringify(mesh);
assert.ok(inspect(mesh).closed);assert.ok(Math.abs(inspect(mesh).volume-1000)<1e-9);
const translated={v:v.map(p=>[p[0]+392000,p[1]+9558000,p[2]+251]),f};assert.ok(Math.abs(inspect(translated).volume-1000)<1e-9);
const open=inspect({v,f:f.slice(1)});assert.equal(open.closed,false);assert.equal(open.boundaryEdges,3);assert.equal(open.volume,null);
const reversed=inspect({v,f:f.map(p=>[p[0],p[2],p[1]])});assert.ok(reversed.closed);assert.ok(reversed.signedVolume<0);assert.equal(reversed.volume,null);
const badOrientation=inspect({v,f:[f[0].slice().reverse(),...f.slice(1)]});assert.equal(badOrientation.closed,false);assert.equal(badOrientation.inconsistentEdges,3);
const nonManifold=inspect({v,f:[...f,f[0]]});assert.equal(nonManifold.nonManifoldEdges,3);assert.equal(nonManifold.volume,null);
const tetra={v:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],f:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]};assert.ok(Math.abs(inspect(tetra).volume-1/6)<1e-12);
assert.throws(()=>inspect({v:[...v.slice(0,7),[NaN,0,0]],f}),/COORDINATE/);
assert.throws(()=>inspect({v,f:[[0,1,99],...f.slice(1)]}),/FACE_INVALID/);
assert.throws(()=>inspect(mesh,{maxFaces:10}),/BUDGET/);
assert.equal(JSON.stringify(mesh),before);
console.log('Domain mesh known answers: cube/UTM/tetrahedron, open/non-manifold/winding errors and workload limits passed; geological validity is not inferred.');
// The S0 state contract is independent of DOM and does not certify topology as geology.
ctx.crypto=(await import('node:crypto')).webcrypto;ctx.TextEncoder=TextEncoder;
vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geom/domain-state.js'),'utf8'),ctx);
const stateApi=ctx.OrebitDomainState;
const source={crs:'EPSG:32751',tables:{assay:[{hole_id:'N1',from_m:0,to_m:1,ni_pct:0},{hole_id:'N2',from_m:0,to_m:1,ni_pct:null}]}};
const sourceHash=await stateApi.hash(source);
const reordered={tables:source.tables,crs:source.crs};assert.equal(await stateApi.hash(reordered),sourceHash);
assert.equal(sourceHash.length,64);
assert.notEqual(await stateApi.hash({...source,crs:'local'}),sourceHash);
const empty=stateApi.create();assert.equal(stateApi.readiness(empty,sourceHash).status,'none');
const domain=stateApi.create();domain.source={sha256:sourceHash};domain.crs={kind:'local',units:'m',renderOrigin:[0,0,0],epsg:null};
domain.domains=[{code:'SAP',density:2.7,build:{inputsHash:sourceHash,mesh,validation:{topology:true}}}];
assert.equal(stateApi.readiness(domain,sourceHash).status,'invalid');assert.equal(stateApi.readiness(domain,sourceHash).volume,null);
for(const key of stateApi.requiredChecks) domain.domains[0].build.validation[key]=true;
assert.ok(Math.abs(stateApi.readiness(domain,sourceHash).volume-1000)<1e-9);
assert.equal(stateApi.readiness(domain,'different').status,'stale');
const restored=stateApi.restore(domain,'different');assert.equal(restored.domains[0].build.stale,true);assert.equal(stateApi.readiness(restored,'different').volume,null);
assert.equal(domain.domains[0].build.stale,undefined,'restore never mutates the saved interpretation');
assert.throws(()=>stateApi.check({...domain,schemaVersion:99}),/STATE_INVALID/);
assert.throws(()=>stateApi.check({...domain,domains:[...domain.domains,...domain.domains]}),/CODE_INVALID/);
assert.throws(()=>stateApi.check({...domain,domains:[{code:'X',density:0}]}),/DENSITY_INVALID/);
assert.throws(()=>stateApi.check({...domain,domains:[{code:'X',density:null,build:{mesh:{v:[],f:[]}}}]}),/MESH_MISSING/);
console.log('Domain S0 contract: canonical SHA256, legacy empty state, stale restoration, independent density and all geological validation gates passed.');
vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geo/drillhole-display.js'),'utf8'),ctx);
const points=Array.from({length:20000},(_,i)=>({x:i,y:0,z:-i,rid:'H'+Math.floor(i/100),md:i%100}));
const original=JSON.stringify(points),display=ctx.drillholeDisplay(points,1000);
assert.ok(display.displayed<=1000);assert.equal(display.total,20000);assert.equal(JSON.stringify(points),original);
assert.equal(display.x.filter(x=>x===null).length,display.displayedHoles);
const unknownDisplay=ctx.drillholeDisplay([{x:1,y:0,z:2},{x:2,y:0,z:1}],10);
assert.equal(unknownDisplay.x[1],null);assert.equal(unknownDisplay.x[3],null);
const curved=ctx.drillholeDisplay([{x:1,y:0,z:0,rid:'H',md:10},{x:2,y:0,z:1,rid:'H',md:20},{x:3,y:0,z:-1,rid:'H',md:0}],10);
assert.deepEqual(Array.from(curved.x),[3,1,2,null]);
console.log('Drillhole display: bounded batching, measured-depth ordering, no cross-hole connection and raw preservation passed.');

// S1 uses the actual shared desurvey owner, not a copied geostat snapshot.
vm.runInContext(fs.readFileSync(path.join(root,'src/shared/geostat/desurvey.js'),'utf8'),ctx);
const curvature=ctx.OrebitMinimumCurvature, inc=d=>(90+d)*Math.PI/180;
const stations=[{depth:0,dip:-90,azimuth:90},{depth:100,dip:0,azimuth:90}];
const collar={x:500000,y:9000000,z:300,depth:100}, rawSurvey=JSON.stringify(stations);
const curvedTrace=ctx.traceFromSurveys(collar,stations,inc), arc=curvature.prepare(curvedTrace,stations,inc),radius=100/(Math.PI/2);
for(let md=0;md<=100;md++){
 const p=arc.atMD(md),angle=md/100*Math.PI/2;
 assert.ok(Math.hypot(p.x-(500000+radius*(1-Math.cos(angle))),p.y-9000000,p.z-(300-radius*Math.sin(angle)))<1e-8,'actual curved MD '+md);
}
const positiveStations=stations.map(row=>({...row,dip:-row.dip})),positiveInc=d=>(90-d)*Math.PI/180;
const positiveArc=curvature.prepare(ctx.traceFromSurveys(collar,positiveStations,positiveInc),positiveStations,positiveInc);
assert.ok(Math.hypot(...['x','y','z'].map(k=>positiveArc.atMD(50)[k]-arc.atMD(50)[k]))<1e-9,'positive-down survey convention preserves the same physical trajectory');
assert.equal(JSON.stringify(stations),rawSurvey,'raw measurements stay untouched');
assert.throws(()=>curvature.displacement([2,0,0],[0,1,0],100,.5),/SEGMENT_INVALID/);
assert.equal(arc.atMD(-1),null);assert.equal(arc.atMD(null),null);assert.equal(arc.atMD(NaN),null);
assert.ok(Math.abs(arc.atMD(120).x-(500000+radius+20))<1e-8);
assert.equal(ctx.traceFromSurveys({x:null,y:1,z:2},stations,inc).length,0,'missing collar is not origin');
assert.equal(ctx.traceFromSurveys(collar,[],inc).length,0);
assert.equal(curvature.issues(stations.map(x=>({...x,hole_id:'H'})),inc).length,0);
assert.equal(curvature.issues([{hole_id:'H',depth:0,dip:-90,azimuth:0},{hole_id:'H',depth:10,dip:90,azimuth:0}],inc)[0].code,'OPPOSITE_DIRECTIONS');
assert.equal(curvature.issues([{hole_id:'H',depth:0,dip:-90,azimuth:0},{hole_id:'H',depth:0,dip:0,azimuth:0}],inc)[0].code,'CONFLICTING_STATION');
assert.equal(curvature.issues([{hole_id:'H',depth:0,dip:null,azimuth:0}],inc)[0].code,'INVALID_MEASUREMENT');
let worstIntegration=0;
for(let j=1;j<=50;j++){
 const a=curvature.direction({depth:0,dip:-89+j*.7,azimuth:j*3},inc),b=curvature.direction({depth:100,dip:-60+j*.3,azimuth:30+j*2},inc),beta=Math.acos(a.reduce((n,x,i)=>n+x*b[i],0)),fraction=j/51,N=1000;
 const sum=[0,0,0];for(let k=0;k<=N;k++){const t=fraction*k/N,w=k===0||k===N?1:k%2?4:2;for(let i=0;i<3;i++)sum[i]+=w*(Math.sin((1-t)*beta)*a[i]+Math.sin(t*beta)*b[i])/Math.sin(beta);}
 const expected=sum.map(x=>x*fraction/N*100/3),got=curvature.displacement(a,b,100,fraction);worstIntegration=Math.max(worstIntegration,Math.hypot(...got.map((x,i)=>x-expected[i])));
}
assert.ok(worstIntegration<1e-7);
console.log('S1 actual desurvey owner: 101 analytical arc points, 50 independent integrations, invalid/ambiguous survey rejection and raw preservation passed; worst integration error m:',worstIntegration);
