// Domain S5/S6: section loft between parallel sections, end rules and refusals, with closed-form volumes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['primitives','mesh','solid','loft']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const L=ctx.OrebitDomainLoft,P=ctx.OrebitGeometryPrimitives;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};
const close=(a,b,msg,tol=1e-6)=>ok(Math.abs(a-b)<=tol*Math.max(1,Math.abs(b)),`${msg}: ${a} != ${b}`);
const refuses=(fn,code,msg)=>{try{fn();}catch(e){ok(e.message===code,`${msg}: ${e.message}`);return;}ok(false,`${msg}: not refused`);};
const square=(s,c=[0,0])=>[[c[0]-s/2,c[1]-s/2],[c[0]+s/2,c[1]-s/2],[c[0]+s/2,c[1]+s/2],[c[0]-s/2,c[1]+s/2]];
const plane=P.sectionPlane([0,0,0],0,90);
const run=(sections,endRule,pl=plane)=>L.loft({plane:pl,sections,endRule});

// PLAN known answers: two 10 x 10 squares 10 m apart.
const two=[{station:0,ring:square(10)},{station:10,ring:square(10)}];
const zero=run(two,'zero'),half=run(two,'half'),pinch=run(two,'pinch');
for(const r of [zero,half,pinch]) ok(r.status==='solid' && r.validation.topology && r.validation.selfIntersection,`${r.endRule} loft is a closed valid single shell`);
close(zero.volume,1000,'zero end rule stops at the end sections');
close(half.volume,2000,'half end rule extends half the spacing beyond each end');
close(pinch.volume,4000/3,'pinch end rule closes to a point half the spacing beyond each end');
ok(zero.extension.before===0 && half.extension.before===5 && pinch.extension.after===5,'end extensions are recorded');
ok(zero.validation.geologistReview===false,'geologist review is never implied');

// Frustum: 10 x 10 to 20 x 20, 10 m apart = h/3 (A1 + A2 + sqrt(A1 A2)).
close(run([{station:0,ring:square(10)},{station:10,ring:square(20)}],'zero').volume,10/3*(100+400+200),'square frustum volume');
// Sheared prism: same square shifted 5 m along the section; Cavalieri keeps 1,000 m3.
close(run([{station:0,ring:square(10)},{station:10,ring:square(10,[5,0])}],'zero').volume,1000,'sheared loft keeps the prism volume');
// Different vertex counts: the second square digitised with edge midpoints. Every vertex is kept, shape unchanged.
const eight=[[-5,-5],[0,-5],[5,-5],[5,0],[5,5],[0,5],[-5,5],[-5,0]];
const mixed=run([{station:0,ring:square(10)},{station:10,ring:eight}],'zero');
close(mixed.volume,1000,'extra digitised vertices do not change the volume');
ok(mixed.pointsPerRing===8 && mixed.status==='solid','rings are matched on merged vertices without cutting corners');
const shifted=eight.slice(3).concat(eight.slice(0,3));
for(const rule of ['zero','pinch']) close(run([{station:0,ring:square(10)},{station:10,ring:shifted}],rule).volume,rule==='zero'?1000:4000/3,`${rule}: where digitising starts does not twist the loft`);
// Clockwise input is accepted and oriented.
close(run([{station:0,ring:square(10).reverse()},{station:10,ring:square(10)}],'zero').volume,1000,'clockwise rings are reoriented');
// Three sections, unsorted input: 10, 20, 10 squares = two frustums.
close(run([{station:20,ring:square(10)},{station:0,ring:square(10)},{station:10,ring:square(20)}],'zero').volume,2*10/3*700,'three sections give two frustums in station order');
// Uneven spacing with the half rule: stations 0, 10, 30 extend 5 and 10.
close(run([{station:0,ring:square(10)},{station:10,ring:square(10)},{station:30,ring:square(10)}],'half').volume,100*45,'half rule uses the spacing at each end');
// Non-convex L-shaped ring: area 75 x 10 m.
const ell=[[0,0],[10,0],[10,5],[5,5],[5,10],[0,10]];
const lr=run([{station:0,ring:ell},{station:10,ring:ell}],'zero');
close(lr.volume,750,'non-convex rings are capped without overlap');
ok(lr.status==='solid','non-convex loft is a valid single shell');
// Square to triangle: closed, valid, and between the smaller and larger prisms.
const tri=[[-5,-5],[5,-5],[0,5]];
const st=run([{station:0,ring:square(10)},{station:10,ring:tri}],'zero');
ok(st.status==='solid' && st.volume>500 && st.volume<1000,`square to triangle is valid and bounded: ${st.volume}`);
// Inclined parallel sections (dip 60) far from the origin, azimuth 30: volumes are unchanged.
const far=P.sectionPlane([700000,9800000,150],30,60);
close(run(two,'zero',far).volume,1000,'inclined sections in project coordinates keep the zero volume',1e-7);
close(run(two,'pinch',far).volume,4000/3,'inclined sections in project coordinates keep the pinch volume',1e-7);
// The rings sit on their sections: every vertex projects back onto its station.
const back=run(two,'zero',far).mesh.v.map(q=>P.project(far,q)[2]);
ok(back.every(d=>Math.abs(d)<1e-6 || Math.abs(d-10)<1e-6),'every vertex lies on its section plane');

// Refusals.
refuses(()=>run([{station:0,ring:square(10)},{station:10,ring:square(10),normal:[1,1,0]}],'zero'),'DOMAIN_LOFT_NOT_PARALLEL','non-parallel sections are refused');
refuses(()=>run([{station:0,ring:square(10)},{station:10,rings:[square(4,[-3,0]),square(4,[3,0])]}],'zero'),'DOMAIN_LOFT_BRANCHING','two polygons on one section are refused');
refuses(()=>run([{station:0,ring:square(10)},{station:0,ring:square(8)}],'zero'),'DOMAIN_LOFT_STATION_DUPLICATE','two rings at one station are refused');
refuses(()=>run([{station:0,ring:square(10)}],'zero'),'DOMAIN_LOFT_SECTIONS','one section is not a loft');
refuses(()=>run(two,'extend'),'DOMAIN_LOFT_END_RULE','an unknown end rule is refused');
refuses(()=>run([{station:0,ring:[[0,0],[10,10],[10,0],[0,10]]},{station:10,ring:square(10)}],'zero'),'DOMAIN_POLYGON_SELF_INTERSECTION','a self-intersecting ring is refused');
ok(run([{station:0,ring:square(10),normal:[2,0,0]},{station:10,ring:square(10)}],'zero').status==='solid','a parallel normal of either sign is accepted');

console.log(`domain loft S5/S6: ${checks} checks passed`);
