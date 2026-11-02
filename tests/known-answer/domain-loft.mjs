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
function independentSurfaceVolume(mesh) {
  let volume=0;
  for(const face of mesh.f) {
    const [a,b,c]=face.map(i=>mesh.v[i]),ab=b.map((x,i)=>x-a[i]),ac=c.map((x,i)=>x-a[i]);
    const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    volume+=(a[0]+b[0]+c[0])*normal[0]/18+(a[1]+b[1]+c[1])*normal[1]/18+(a[2]+b[2]+c[2])*normal[2]/18;
  }
  return volume;
}

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
for(let trial=0;trial<60;trial++) {
  const sections=[0,10,40].map((station,index)=>{
    let ring=ell.map(([x,y])=>[x+station*.1,y+station*.025]);
    if((trial+index)%2===0){const i=(trial+index)%ring.length,a=ring[i],b=ring[(i+1)%ring.length];ring.splice(i+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);}
    const start=(trial*7+index*3)%ring.length;ring=ring.slice(start).concat(ring.slice(0,start));
    if((trial+index)%3===0)ring.reverse();
    return {station,ring};
  });
  const candidate=run(sections,'zero');
  ok(candidate.status==='solid',`three-section concave prism remains a valid shell under ring start/orientation/subdivision changes (case ${trial})`);
  close(candidate.volume,3000,`three-section sheared concave prism has invariant analytic volume (case ${trial})`);
}
const uSection=base=>[[0,0],[12,0],[12,-12],[9,-12],[9,-base],[3,-base],[3,-12],[0,-12]];
const changingConcavity=run([1,4,7].map((base,index)=>({station:index*10,ring:uSection(base)})),'zero');
ok(changingConcavity.status==='solid',`valid three-section U-shaped loft stays a single shell across a changing concavity reference: ${changingConcavity.shellError}`);
ok(changingConcavity.volume>0&&changingConcavity.volume<12*12*20,'three-section U-shaped loft volume stays within its independent bounding prism');
close(changingConcavity.volume,independentSurfaceVolume(changingConcavity.mesh),'three-section U-shaped loft volume matches independent surface-divergence calculation',1e-9);
// Four valid, thin sloping rings. The farthest horizontal corner changes
// between upper/lower edges, so perimeter matching genuinely folds side faces.
const slopingFour=[
 [[-226.452,-242.512],[218.176,-221.522],[217.469,-243.156],[-227.100,-264.147]],
 [[-223.742,-243.018],[212.581,-240.660],[212.885,-259.709],[-222.768,-262.066]],
 [[-236.927,-241.353],[227.687,-226.545],[228.098,-258.378],[-236.040,-273.185]],
 [[-225.957,-221.965],[229.871,-228.307],[231.774,-255.598],[-226.633,-249.256]]
].map((ring,index)=>({station:index*50,ring}));
const folded=run(slopingFour,'zero',P.sectionPlane([392137,9558026,0],160,90));
ok(folded.status==='invalid'&&folded.shellError==='DOMAIN_SOLID_SELF_INTERSECTION','four-section folded correspondence stays rejected, despite individually valid convex rings');
ok(folded.repairProposal?.correspondence==='upper-right'&&folded.repairProposal.status==='solid','a different valid correspondence is proposed explicitly rather than silently changing the rejected model');
const aligned=folded.repairProposal;
ok(aligned.validation.topology&&aligned.validation.selfIntersection&&!aligned.validation.geologistReview,'the proposal passes the unchanged shell owner without geological approval');
close(aligned.volume,independentSurfaceVolume(aligned.mesh),'proposed four-section volume agrees with independent surface divergence',1e-8);
for(const section of slopingFour)for(const point of section.ring){
 const original=P.unproject(P.sectionPlane([392137,9558026,0],160,90),[...point,section.station]);
 ok(aligned.mesh.v.some(p=>Math.hypot(...P.sub(p,original))<1e-8),'correspondence preserves every original ring vertex exactly');
}
for(const spacing of [25,100]){
 const sections=slopingFour.map((s,index)=>({station:index*spacing,ring:index%2?s.ring.slice().reverse():s.ring.slice(2).concat(s.ring.slice(0,2))}));
 const input={plane:P.sectionPlane([700000,9800000,0],37,90),sections,endRule:'zero',correspondence:'upper-right'},before=JSON.stringify(input),candidate=L.loft(input);
 ok(candidate.status==='solid',`explicit matching handles narrower/wider stations, changed ring starts/winding and rotated UTM plane: ${spacing} ${candidate.shellError} ${candidate.shellFaces}`);
 close(candidate.volume,aligned.volume*spacing/50,'station scaling preserves independent loft volume ratio',1e-8);
 ok(JSON.stringify(input)===before,'matching does not mutate the source interpretation');
}
refuses(()=>L.loft({plane,sections:two,endRule:'zero',correspondence:'guess'}),'DOMAIN_LOFT_CORRESPONDENCE','unknown correspondence cannot silently replace the legacy method');
const solidOwner=ctx.OrebitDomainSolid;
try {
  ctx.OrebitDomainSolid={prepareSolid:()=>{const e=new Error('DOMAIN_SOLID_SELF_INTERSECTION');e.faces=[3,8];throw e;}};
  const failed=run(two,'zero');
  ok(failed.status==='invalid'&&failed.shellError==='DOMAIN_SOLID_SELF_INTERSECTION'&&JSON.stringify(failed.shellFaces)==='[3,8]',
    'loft retains intersecting face indices for the UI diagnostic and remains invalid');
} finally {ctx.OrebitDomainSolid=solidOwner;}
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
