// Domain S7 primitive A: solids between two contact surfaces with closed-form volumes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['primitives','mesh','solid','contacts','between']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const B=ctx.OrebitDomainBetween,G=ctx.OrebitDomainGeometry;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};
const close=(a,b,msg,tol=1e-6)=>ok(Math.abs(a-b)<=tol,`${msg}: ${a} != ${b}`);

// 5 x 5 vertical holes on a 200 x 200 m square (50 m apart); top and base given as functions of x, y.
function picks(topZ,baseZ,extra=[]){
  const top=[],base=[];
  for(let i=0;i<5;i++)for(let j=0;j<5;j++){
    const x=i*50,y=j*50,h=`H${i}${j}`;
    top.push({hole:h,status:'contact',point:[x,y,topZ(x,y)],depth:0});
    base.push({hole:h,status:'contact',point:[x,y,baseZ(x,y)],depth:0});
  }
  for(const [t,b] of extra){top.push(t);base.push(b);}
  return [top,base];
}
const collars=new Map();for(let i=0;i<5;i++)for(let j=0;j<5;j++)collars.set(`H${i}${j}`,110);

// Flat: z 100 over z 90 on the 200 x 200 m hull = 400,000 m3; SG 2.70 = 1,080,000 t.
const flat=B.buildBetween(...picks(()=>100,()=>90),{topography:collars});
ok(flat.status==='solid','two flat surfaces build one closed solid');
close(flat.volume,400000,'flat prism volume');
close(flat.meshVolume,400000,'closed-mesh signed volume agrees');
close(flat.volume*2.7,1080000,'tonnage at SG 2.70');
const report=G.inspectMesh(flat.mesh);
ok(report.closed&&report.boundaryEdges===0&&report.inconsistentEdges===0&&report.degenerateFaces===0,'mesh is closed and consistently oriented');
ok(flat.maxEdge===125&&flat.maxEdgeSource==='default','default longest edge 2.5 x 50 m is recorded');
ok(flat.validation.topology&&flat.validation.selfIntersection&&flat.validation.topography===true&&flat.validation.honouring&&flat.validation.geologistReview===false,'validation passes except the geologist review it cannot give');
ok(flat.validation.overlap===null,'overlap is not claimed for a single domain');

// Inclined: top z = 100 + 0.1x over z 90 -> thickness 10 + 0.1x -> 200 * (10*200 + 0.05*200^2) = 800,000 m3.
const tilt=B.buildBetween(...picks((x)=>100+0.1*x,()=>90));
ok(tilt.status==='solid'&&tilt.topography==='declared-unavailable','inclined solid builds with topography declared unavailable');
close(tilt.volume,800000,'inclined prism closed form');
close(tilt.meshVolume,800000,'inclined mesh volume');
ok(tilt.validation.topography===null,'unavailable topography is not reported as passed');

// Saddle base: z = 90 - 0.0005 (x-100)(y-100) is piecewise-linear only at the holes, so the closed form is per triangle:
// the build must equal the summed prisms of its own TIN, which the mesh volume checks independently.
const saddle=B.buildBetween(...picks(()=>100,(x,y)=>90-0.0005*(x-100)*(y-100)));
close(saddle.volume,saddle.meshVolume,'per-triangle prism sum equals the closed mesh volume');

// Top above topography is reported, not clipped.
const high=new Map(collars);high.set('H22',99);
const breach=B.buildBetween(...picks(()=>100,()=>90),{topography:high});
ok(breach.aboveTopography.join()==='H22'&&breach.validation.topography===false,'a top above its collar is listed and fails the topography check');

// Inversion and pinch stop the build and name the holes.
const inv=B.buildBetween(...picks(()=>100,(x,y)=>x===100&&y===100?105:90));
ok(inv.status==='inverted'&&inv.inverted.join()==='H22'&&!inv.mesh,'base above top is reported per hole and no solid is built');
const pin=B.buildBetween(...picks(()=>100,(x,y)=>x===0&&y===0?100:90));
ok(pin.status==='pinched'&&pin.pinched.join()==='H00','zero thickness is reported as a pinch');

// Holes without both contacts are excluded with the side and reason.
const [t2,b2]=picks(()=>100,()=>90,[
  [{hole:'OPEN',status:'contact',point:[25,25,100]},{hole:'OPEN',status:'open',reason:'domain-reaches-end-of-hole'}],
  [{hole:'UNK',status:'uncertain',reason:'unlogged-before-contact'},{hole:'UNK',status:'contact',point:[75,25,90]}]]);
const mixed=B.buildBetween(t2,b2);
const why=Object.fromEntries(mixed.excluded.map(e=>[e.hole,e.reason]));
ok(why.OPEN==='base-domain-reaches-end-of-hole'&&why.UNK==='top-unlogged-before-contact','excluded holes carry side and reason');
close(mixed.volume,400000,'excluded holes do not change the supported volume');

// Inclined hole: base contact offset in XY from its top is honoured only within tolerance.
const [t3,b3]=picks(()=>100,()=>90);
b3[12]={...b3[12],point:[110,100,80]};
const lean=B.buildBetween(t3,b3);
ok(lean.baseDeviation>0.01&&lean.validation.honouring===false,'a base contact the solid does not pass through fails honouring');

ok(B.buildBetween(...picks(()=>100,()=>90).map(p=>p.slice(0,2))).status==='no-surface','fewer than 3 contacts build nothing');
// Even with sufficient valid contact points, a reported separated body is
// an interpretation blocker rather than silently discarded interpolation data.
const [ambiguousTop,ambiguousBase]=picks(()=>100,()=>90);
ambiguousTop[0]={hole:ambiguousTop[0].hole,status:'uncertain',reason:'repeated-domain-intervals',spans:[{from:2,to:4},{from:7,to:10}]};
const unsupported=B.buildBetween(ambiguousTop,ambiguousBase);
ok(unsupported.status==='ambiguous'&&!unsupported.mesh&&!unsupported.volume,'separate lenses do not produce a rock/waste envelope');
ok(unsupported.excluded.length===1&&unsupported.excluded[0].spans[1].from===7,'the build retains exact unsupported-hole evidence');
// Independently named horizons may have different TIN diagonals and footprints.
const horizon=(x0,y0,x1,y1,z,flip=false)=>({v:[[x0,y0,z(x0,y0)],[x1,y0,z(x1,y0)],[x1,y1,z(x1,y1)],[x0,y1,z(x0,y1)]],triangles:flip?[[0,1,3],[1,2,3]]:[[0,1,2],[0,2,3]]});
for(const origin of [[0,0],[700000,9800000]])for(const flip of [false,true]){
 const [x,y]=origin,top=horizon(x,y,x+100,y+100,()=>100),bottom=horizon(x,y,x+100,y+100,()=>90,flip),terrain=horizon(x,y,x+100,y+100,()=>110);
 const pair=B.buildSurfacePair(top,bottom,{terrain});
 ok(pair.status==='solid','independent TIN overlay forms a manifold shell: '+pair.shellError);
 close(pair.volume,100000,'independent paired-surface prism integral');close(pair.meshVolume,100000,'independent paired-surface signed-mesh volume');close(pair.commonArea,10000,'supported area excludes no data on matched footprint');
 ok(pair.validation.topography&&pair.validation.honouring&&!pair.validation.geologistReview,'paired geometry never fabricates review');
 ok(B.buildSurfacePair(bottom,top).status==='inverted','swapped assignment is rejected instead of silently repaired');
 const half=B.buildSurfacePair(top,horizon(x+50,y,x+150,y+100,()=>90,!flip),{terrain});
 ok(half.status==='solid','different footprints form a solid only on actual overlap');close(half.volume,50000,'partial footprint analytic volume');close(half.commonArea,5000,'partial footprint analytic area');
 const slope=B.buildSurfacePair(top,horizon(x,y,x+100,y+100,(a,b)=>90+.04*(a-x)+.02*(b-y),flip));
 ok(slope.status==='solid','sloping independent horizon is valid');close(slope.volume,70000,'affine thickness integrated exactly across TIN overlay');
 const crossed=B.buildSurfacePair(top,horizon(x,y,x+100,y+100,a=>95+.1*(a-x),flip));ok(crossed.status==='inverted'&&!crossed.mesh,'partially crossed surfaces cannot create accepted geometry');
 ok(B.buildSurfacePair(top,top).status==='pinched','coincident horizons are rejected');
 ok(B.buildSurfacePair(top,horizon(x+200,y,x+300,y+100,()=>90)).status==='no-triangles','disjoint footprints produce no extrapolated body');
 const above=B.buildSurfacePair(top,bottom,{terrain:horizon(x,y,x+100,y+100,()=>99)});ok(!above.validation.topography,'solid above terrain cannot pass topography');
 const absent=B.buildSurfacePair(top,bottom,{terrain:horizon(x,y,x+50,y+100,()=>110)});ok(!absent.validation.topography,'missing terrain coverage cannot pass topography');
 let budget=false;try{B.buildSurfacePair(top,bottom,{maxPairs:1});}catch(e){budget=e.message==='DOMAIN_SURFACE_PAIR_BUDGET';}ok(budget,'paired-surface operation fails at its finite budget');
}


// A terrain valley inside a coarse upper face must not pass a vertex-only check.
const valley={v:[[0,0,110],[100,0,110],[100,100,110],[0,100,110],[50,50,99]],triangles:[[0,1,4],[1,2,4],[2,3,4],[3,0,4]]};
const valleyCase=B.buildSurfacePair(horizon(0,0,100,100,()=>100),horizon(0,0,100,100,()=>90),{terrain:valley});
ok(valleyCase.validation.topography===false,'interior terrain valley is detected by exact TIN overlay');
const holeTin=z=>{const v=[],triangles=[];for(let j=0;j<4;j++)for(let i=0;i<4;i++)v.push([10*i,10*j,z]);
 for(let j=0;j<3;j++)for(let i=0;i<3;i++){if(i===1&&j===1)continue;const a=j*4+i;triangles.push([a,a+1,a+5],[a,a+5,a+4]);}return {v,triangles};};
const ringBody=B.buildSurfacePair(holeTin(100),holeTin(90));
// Two supported patches meet at one point: report its location, never weld
// across unmeasured coverage or call that non-manifold shell accepted.
const touchingHorizon=z=>({v:[[0,0,z],[1,0,z],[1,1,z],[0,1,z],[2,1,z],[2,2,z],[1,2,z]],triangles:[[0,1,2],[0,2,3],[2,4,5],[2,5,6]]});
const touchingBody=B.buildSurfacePair(touchingHorizon(100),touchingHorizon(90));
ok(touchingBody.status==='invalid'&&!touchingBody.validation.topology,'point-touch support remains blocked by topology gate');
ok(touchingBody.supportJunctions.length===1&&touchingBody.supportJunctions[0].point[0]===1&&touchingBody.supportJunctions[0].point[1]===1&&touchingBody.supportJunctions[0].boundaryEdges===4,'touching coverage reports exact actionable XY and boundary degree');
close(touchingBody.volume,20,'diagnostic does not alter supported affine volume');
ok(ringBody.status==='solid','shared footprint with an unsupported central gap forms closed inner walls');
close(ringBody.commonArea,800,'unsupported central gap is excluded from area');close(ringBody.volume,8000,'no material or data is invented inside the gap');close(ringBody.meshVolume,8000,'closed inner walls retain the independent ring-prism volume');
// Two supported patches touching only at a corner do not form one manifold shell.
const touching=z=>({v:[[0,0,z],[10,0,z],[10,10,z],[0,10,z],[20,10,z],[20,20,z],[10,20,z]],triangles:[[0,1,2],[0,2,3],[2,4,5],[2,5,6]]});
const fragmented=B.buildSurfacePair(touching(100),touching(90));
ok(fragmented.status==='invalid'&&fragmented.shellError==='DOMAIN_SOLID_TOPOLOGY','point-touching support is refused rather than bridged or auto-approved');
ok(fragmented.meshDiagnostics.nonManifoldEdges===1,'diagnostic identifies the non-manifold vertical edge');
ok(fragmented.validation.topology===false&&fragmented.validation.selfIntersection===null,'unreached intersection check stays untested rather than falsely failed');
close(fragmented.commonArea,200,'both measured patches retained without gap filling');close(fragmented.volume,2000,'candidate volume is diagnostic only, not accepted material');
console.log(`domain between S7: ${checks} known answers passed`);
