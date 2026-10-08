// Real S2 owners, analytic geometry and independent triangulation/inside oracles.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({});
for(const name of ['mesh','primitives','solid']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const g=ctx.OrebitGeometryPrimitives,solid=ctx.OrebitDomainSolid.prepareSolid;
let checks=0;
const close=(a,b,tol=1e-9)=>{checks++;assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);};
let seed=1729;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
for(let i=0;i<200;i++) {
  const p=[392000+random()*1000,9558000+random()*1000,random()*300],plane=g.sectionPlane([392000,9558000,250],random()*360,1+random()*89);
  for(const a of ['u','v','normal']) close(g.dot(plane[a],plane[a]),1,1e-12);
  for(const [a,b] of [['u','v'],['u','normal'],['v','normal']]) close(g.dot(plane[a],plane[b]),0,1e-12);
  const q=g.unproject(plane,g.project(plane,p));close(Math.hypot(...p.map((x,k)=>x-q[k])),0,1e-9);
}
assert.throws(()=>g.unproject(g.sectionPlane([0,0,0],0),[1,2,NaN]),/COORDINATE_INVALID/);
assert.throws(()=>g.project({origin:[0,0,0],u:[2,0,0],v:[0,1,0],normal:[0,0,1]},[1,1,1]),/PLANE_INVALID/);
for(const invalid of [null,[NaN,0,0],[0,0,0,1]]) assert.throws(()=>g.sectionPlane(invalid,0),/PLANE_INVALID/);
assert.throws(()=>g.sectionPlane([0,0,0],0,-1),/PLANE_INVALID/);
const horizontal=g.sectionPlane([392000,9558000,250],0,0);
assert.equal(g.project(horizontal,[392025,9558050,250])[2],0,'horizontal section is supported');
assert.equal(JSON.stringify(g.sectionPlane([0,0,0],-10)),JSON.stringify(g.sectionPlane([0,0,0],350)),'azimuth wraps consistently');
assert.ok(g.sectionPlane([0,0,0],1e308).u.every(Number.isFinite),'large finite azimuth does not overflow radians');
assert.throws(()=>g.unit([0,0,0]),/VECTOR_INVALID/);
assert.throws(()=>g.dot([1,2],[1,2,3]),/VECTOR_INVALID/);
assert.throws(()=>g.mul([1,2,3],NaN),/VECTOR_INVALID/);
assert.throws(()=>g.cross([1,2],[1,2]),/VECTOR_INVALID/);
const ring=[[0,0],[10,0],[10,10],[0,10]],raw=JSON.stringify(ring);
close(g.inspectPolygon(ring).area,100);close(g.inspectPolygon(ring.slice().reverse()).area,100);
close(g.inspectPolygon([...ring,ring[0]]).area,100);
close(g.inspectPolygon(ring.map(p=>[392000+p[0],9558000+p[1]])).area,100);
for(const p of [[0,5],[0,0],[5,5],[10,10]]) assert.equal(g.insidePolygon(p,ring),true);
for(const p of [[-1,5],[5,11]]) assert.equal(g.insidePolygon(p,ring),false);
assert.equal(JSON.stringify(ring),raw);
const immutablePolygon=g.preparePolygon(ring);ring[0][0]=999;assert.equal(immutablePolygon.contains([0,0]),true);ring[0][0]=0;
assert.throws(()=>g.inspectPolygon([[0,0],[10,10],[0,10],[10,0]]),/SELF_INTERSECTION/);
assert.throws(()=>g.inspectPolygon([[0,0],[10,0],[5,0],[5,10],[0,10]]),/SELF_INTERSECTION/);
assert.throws(()=>g.inspectPolygon([[0,0],[1,0],[2,0]]),/SELF_INTERSECTION|DEGENERATE/);
assert.throws(()=>g.inspectPolygon([[0,0],[0,0],[1,1]]),/DUPLICATE/);
assert.throws(()=>g.insidePolygon([NaN,0],ring),/COORDINATE_INVALID/);
const points=[];
for(let x=0;x<=200;x+=50) for(let y=0;y<=200;y+=50) points.push([392000+x,9558000+y,.1*x+.2*y]);
const source=JSON.stringify(points),tin=g.makeTIN(points),sample=g.prepareTIN(tin).sample;
assert.equal(tin.triangles.length,32);
const limited=g.makeTIN(points,60);assert.equal(limited.triangles.length,0);assert.equal(limited.rejected,32);assert.equal(g.sampleTIN(limited,392025,9558025),null);
for(let i=0;i<500;i++) {const x=random()*200,y=random()*200;close(sample(392000+x,9558000+y).z,.1*x+.2*y,1e-8);}
assert.equal(sample(391999,9558050),null);assert.equal(sample(392050,9558201),null);assert.equal(JSON.stringify(points),source);
assert.throws(()=>g.makeTIN([[0,0,1],[0,0,1.000000001],[10,0,3],[0,10,4]]),/MULTIVALUED/);
assert.throws(()=>g.makeTIN([[0,0,1],[1,1,2],[2,2,3]]),/COLLINEAR/);
assert.equal(g.makeTIN([...points,points[0]]).v.length,25);
assert.throws(()=>g.makeTIN(points,NaN),/TIN_INPUT/);
assert.throws(()=>g.makeTIN(points,0),/TIN_INPUT/);
assert.throws(()=>g.makeTIN(Array.from({length:2001},(_,i)=>[i,i*i,0])),/TIN_INPUT/);
assert.throws(()=>g.sampleTIN(tin,null,0),/COORDINATE_INVALID/);
assert.throws(()=>g.prepareTIN({v:points,triangles:[[0,0,1]]}),/DEGENERATE/);
const copied=g.prepareTIN(tin);tin.v[0][2]=999;close(copied.sample(392000,9558000).z,0);tin.v[0][2]=0;
// Known hull area and Euler count; circumcentre oracle does not use the owner's determinant.
const orientation=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const signature=t=>t.triangles.map(face=>face.map(i=>t.v[i].slice(0,2).join(',')).sort().join('|')).sort().join(';');
for(let trial=0;trial<20;trial++) {
  const p=[[0,0,0],[100,0,10],[100,100,30],[0,100,20]];
  for(let i=0;i<60;i++) {const x=.01+random()*99.98,y=.01+random()*99.98;p.push([x,y,.1*x+.2*y]);}
  const t=g.makeTIN(p),prepared=g.prepareTIN(t);assert.equal(t.triangles.length,2*p.length-6);
  let area=0;
  for(const ids of t.triangles) {
    const [a,b,c]=ids.map(i=>t.v[i]),ab=[b[0]-a[0],b[1]-a[1]],ac=[c[0]-a[0],c[1]-a[1]],den=2*(ab[0]*ac[1]-ab[1]*ac[0]);
    assert.ok(den>0);area+=den/4;
    const ba=ab[0]**2+ab[1]**2,ca=ac[0]**2+ac[1]**2,cx=(ba*ac[1]-ca*ab[1])/den+a[0],cy=(ab[0]*ca-ac[0]*ba)/den+a[1],r2=(cx-a[0])**2+(cy-a[1])**2;
    for(const q of p) {checks++;assert.ok((q[0]-cx)**2+(q[1]-cy)**2>=r2-1e-6,'Delaunay empty circumcircle');}
  }
  close(area,10000,1e-8);
  assert.equal(signature(t),signature(g.makeTIN(p.slice().reverse())),'input-order-independent surface');
  for(let i=0;i<50;i++) {
    const q=[.01+random()*99.98,.01+random()*99.98];let count=0;
    for(const ids of t.triangles) {const [a,b,c]=ids.map(j=>t.v[j]);if(orientation(a,b,q)>0 && orientation(b,c,q)>0 && orientation(c,a,q)>0) count++;}
    assert.equal(count,1,'surface covers hull exactly once');close(prepared.sample(...q).z,.1*q[0]+.2*q[1],1e-8);
  }
}
const v=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[0,0,10],[10,0,10],[10,10,10],[0,10,10]];
const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const cube={v,f},before=JSON.stringify(cube),prepared=solid(cube);close(prepared.volume,1000);
for(let x=.5;x<10;x++) for(let y=.5;y<10;y++) for(let z=.5;z<10;z++) assert.equal(prepared.classify([x,y,z]),'inside');
for(const p of [[0,0,0],[10,10,10],[0,5,5],[5,5,0],[5,5,10],[5,10,5],[10,5,5]]) assert.equal(prepared.classify(p),'boundary');
for(const p of [[-1,5,5],[11,5,5],[5,-1,5],[5,5,11]]) assert.equal(prepared.classify(p),'outside');
assert.equal(JSON.stringify(cube),before);
const moved={v:v.map(p=>[392000+p[0],9558000+p[1],300+p[2]]),f},movedSolid=solid(moved);
close(movedSolid.volume,1000);assert.equal(movedSolid.classify([392005,9558005,305]),'inside');assert.equal(movedSolid.classify([392000,9558005,305]),'boundary');
moved.v[0][0]=0;assert.equal(movedSolid.classify([392005,9558005,305]),'inside','prepared data is isolated from edits');
assert.throws(()=>solid({v,f:f.slice(1)}),/TOPOLOGY/);
assert.throws(()=>solid({v,f:[...f,f[0]]}),/TOPOLOGY/);
assert.throws(()=>solid({v,f:f.map(t=>t.slice().reverse())}),/TOPOLOGY/);
assert.throws(()=>solid(cube,{maxFaces:10}),/BUDGET/);
assert.throws(()=>solid(cube,{maxPairs:1}),/PAIR_BUDGET/);
assert.throws(()=>solid(cube,{tolerance:0}),/OPTIONS/);
assert.throws(()=>prepared.classify([null,1,1]),/COORDINATE_INVALID/);
for(const z of [-5,0]) {
  const crossing={v:v.map(p=>p.slice()),f};crossing.v[6]=[5,5,z];
  assert.ok(ctx.OrebitDomainGeometry.inspectMesh(crossing).volume>0,'topology alone accepts this invalid shell');
  assert.throws(()=>solid(crossing),/SELF_INTERSECTION/,'actual crossing or coplanar contact is rejected');
}
const lring=[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]],caps=[[0,1,3],[1,2,3],[0,3,5],[3,4,5]],lf=[];
for(const t of caps) {lf.push(t.slice().reverse());lf.push(t.map(i=>i+6));}
for(let i=0;i<6;i++) {const j=(i+1)%6;lf.push([i,j,j+6],[i,j+6,i+6]);}
const concave=solid({v:[...lring.map(p=>[...p,0]),...lring.map(p=>[...p,10])],f:lf});close(concave.volume,30);
assert.equal(concave.classify([1.5,1.5,5]),'outside','bounding box is not a solid');assert.equal(concave.classify([.5,1.5,5]),'inside');
for(let i=0;i<1000;i++) {const p=[random()*2,random()*2,random()*10];assert.equal(concave.classify(p),p[0]<1 || p[1]<1?'inside':'outside','independent union-of-rectangles oracle');}
const two={v:[...v,...v.map(p=>[p[0]+20,p[1],p[2]])],f:[...f,...f.map(t=>t.map(i=>i+8))]};
assert.throws(()=>solid(two),/MULTISHELL/,'unsupported multiple shells are explicit');
const tf=[[0,2,1],[0,1,3],[0,3,2],[1,2,3]],tv=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],tetra=solid({v:tv,f:tf});close(tetra.volume,1/6,1e-12);
for(let i=0;i<1000;i++) {const p=[random(),random(),random()];assert.equal(tetra.classify(p),p.reduce((a,b)=>a+b,0)<1?'inside':'outside','independent tetrahedral inequality');}
assert.equal(tetra.classify([.25,.25,.5]),'boundary');
const pinch={v:[...tv,[-1,0,0],[0,-1,0],[0,0,-1]],f:[...tf,...tf.map(t=>t.map(i=>i?i+3:0).reverse())]};
assert.ok(ctx.OrebitDomainGeometry.inspectMesh(pinch).closed);
assert.throws(()=>solid(pinch),/VERTEX_MANIFOLD/,'edge counts alone miss a pinched vertex');
for(let i=0;i<20;i++) {
  const angle=random()*Math.PI*2,c=Math.cos(angle),s=Math.sin(angle),sx=1+random()*2,sy=1+random()*2,sz=1+random()*2;
  const transform=p=>[392000+c*p[0]*sx-s*p[1]*sy,9558000+s*p[0]*sx+c*p[1]*sy,300+p[2]*sz];
  const rotated=solid({v:v.map(transform),f});close(rotated.volume,1000*sx*sy*sz,2e-6);
  for(let j=0;j<50;j++) {const p=[random()*14-2,random()*14-2,random()*14-2];assert.equal(rotated.classify(transform(p)),p.every(x=>x>0 && x<10)?'inside':'outside','independent rotated box oracle');}
}
console.log(`Domain S2: ${checks} analytic/numerical checks plus 4,000 inside/concavity/rotation cases, TIN coverage/circumcircles, strict inputs, topology/crossings, boundary rules and snapshot isolation passed.`);
