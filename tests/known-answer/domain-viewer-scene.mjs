// Domain S3 viewer scene: hand-derived slab clips, VE transform and full-population counts.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['primitives','viewer-scene']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const g=ctx.OrebitGeometryPrimitives,v=ctx.OrebitDomainViewerScene;
let checks=0;
const close=(a,b,tol=1e-9)=>{checks++;assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);};
const P=(x,y,z)=>({x,y,z});
const rows=[
  {sourceIndex:0,hole_id:'V',start:P(10,3,100),end:P(10,3,90),grade:1},        // inside the slab
  {sourceIndex:1,hole_id:'FAR',start:P(10,8,100),end:P(10,8,90),grade:2},      // parallel, outside
  {sourceIndex:2,hole_id:'X',start:P(0,-10,50),end:P(0,10,50),grade:3},        // crosses the whole slab
  {sourceIndex:3,hole_id:'NEAR',start:P(0,-10,40),end:P(0,-6,40),grade:4},     // stops short of it
  {sourceIndex:4,hole_id:'BAD',start:null,end:P(0,0,0),grade:5},               // no endpoint: counted, never guessed
];
const scene=v.buildScene(rows,r=>r.grade);
assert.equal(scene.total,5);assert.equal(scene.skipped,1);assert.equal(scene.segments.length,4);checks+=3;
assert.deepEqual(JSON.parse(JSON.stringify(scene.bounds)),{x:[0,10],y:[-10,10],z:[40,100]});checks++;
// Azimuth 90: u points east, the slab normal points north, so |y| <= 5 is kept.
const plane=g.sectionPlane([0,0,0],90),cut=v.sectionSlab(scene,plane,5);
assert.equal(cut.map(c=>c.hole).join(),'V,X');checks++;
close(cut[0].p.u,10);close(cut[0].p.z,100);close(cut[0].q.z,90);close(cut[0].p.n,3);
close(cut[1].p.u,0);close(cut[1].p.n,-5);close(cut[1].q.n,5);close(cut[1].p.z,50);
assert.equal(cut[1].value,3);assert.equal(cut[1].sourceIndex,2);checks+=2;
// A 1 m slab keeps nothing from the hole 3 m away and the middle metre of the crossing one.
const thin=v.sectionSlab(scene,plane,0.5);assert.equal(thin.map(c=>c.hole).join(),'X');checks++;
close(thin[0].p.n,-0.5);close(thin[0].q.n,0.5);
for(const bad of [0,-1,NaN,Infinity]) assert.throws(()=>v.sectionSlab(scene,plane,bad),/SECTION_WIDTH_INVALID/);
// VE 1 and 2: horizontal metres per pixel are unchanged by VE, vertical ones scale by it.
const one=v.fitView({h:[0,100],v:[0,50]},200,200,1,0),two=v.fitView({h:[0,100],v:[0,50]},200,200,2,0);
close(one.scale,2);close(two.scale,2);
close(two.toScreen(0,0)[0],0);close(two.toScreen(0,0)[1],200);close(two.toScreen(100,50)[0],200);close(two.toScreen(100,50)[1],0);
const a=one.toScreen(0,0),b=one.toScreen(0,10),c=two.toScreen(0,0),d=two.toScreen(0,10);
close((c[1]-d[1])/(a[1]-b[1]),2);
// The cursor readout inverts the same transform: screen (100,100) is world (50,25) at VE 2.
close(two.toWorld(100,100)[0],50);close(two.toWorld(100,100)[1],25);close(two.toWorld(...two.toScreen(37.5,12.25))[1],12.25);
for(const bad of [0,-2,NaN]) assert.throws(()=>v.fitView({h:[0,1],v:[0,1]},200,200,bad),/VIEW_INVALID/);
// 400 holes × 89 intervals: the full synthetic population is retained by the scene.
const big=[];for(let h=0;h<400;h++)for(let i=0;i<89;i++)big.push({sourceIndex:big.length,hole_id:'H'+h,start:P(h*25,(h%20)*25,300-i),end:P(h*25,(h%20)*25,299-i)});
const bigScene=v.buildScene(big);assert.equal(bigScene.segments.length,35600);checks++;
console.log(`domain viewer scene: ${checks} known-answer checks passed`);
