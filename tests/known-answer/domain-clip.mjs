// Domain S9: exact filled volume per block against a prism solid, checked against closed forms.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=fs.existsSync(path.join(here,'../../../src'))?path.resolve(here,'../../..'):path.resolve(here,'../..');
const ctx=vm.createContext({setTimeout});
for(const name of ['primitives','mesh','solid','contacts','between','convex-clip','clip','loft']) vm.runInContext(fs.readFileSync(path.join(root,`src/shared/geom/${name}.js`),'utf8'),ctx);
const B=ctx.OrebitDomainBetween,C=ctx.OrebitDomainClip;
let checks=0;
const ok=(cond,msg)=>{assert.ok(cond,msg);checks++;};
const close=(a,b,msg,tol=1e-9)=>ok(Math.abs(a-b)<=tol,`${msg}: ${a} != ${b}`);
const sum=a=>a.reduce((s,x)=>s+x,0);

// A prism over the square [0,10]^2 from two triangles; top/base given per corner.
const square=(top,base)=>{const c=[[0,0],[10,0],[10,10],[0,10]];
  return {v:[...c.map(([x,y])=>[x,y,top(x,y)]),...c.map(([x,y])=>[x,y,base(x,y)])],f:[[0,1,2],[0,2,3],[4,6,5],[4,7,6]]};};
const cube=square(()=>10,()=>0);

// Cube [0,10]^3 on 1 m blocks: every one of 1,000 blocks is exactly full.
const g1=C.fractions(cube,{origin:[0,0,0],size:[1,1,1],count:[10,10,10]});
ok([...g1.filled].every(v=>Math.abs(v-1)<1e-12),'all 1,000 unit blocks of the cube are full');
close(g1.total,1000,'cube total');
close(g1.outside,0,'nothing lies outside the grid');

// Shifted half a block: faces cut blocks into halves, edges quarters, corners eighths.
const g2=C.fractions(cube,{origin:[-0.5,-0.5,-0.5],size:[1,1,1],count:[11,11,11]});
const at=(g,i,j,k,n=11)=>g.filled[i+n*(j+n*k)];
close(at(g2,5,5,5),1,'interior block full');
close(at(g2,0,5,5),0.5,'face block half full');
close(at(g2,0,0,5),0.25,'edge block quarter full');
close(at(g2,0,0,0),0.125,'corner block eighth full');
close(g2.total,1000,'shifted grid still sums to the cube');
ok(new Set([...g2.filled].map(v=>Math.round(v*1000)/1000)).size===4,'only full, half, quarter and eighth fractions occur');

// Inclined top z = 5 + 0.5x over base 0; block [0,10]^2 x [5,10] holds the wedge: integral of 0.5x = 250 m3.
const wedge=square((x)=>5+0.5*x,()=>0);
const g3=C.fractions(wedge,{origin:[0,0,0],size:[10,10,5],count:[1,1,2]});
close(g3.filled[0],500,'lower block [0,5] is full');
close(g3.filled[1],250,'upper block holds the analytic wedge 250 m3');
close(g3.solid,750,'solid volume 10 x 10 x mean thickness 7.5');

// Top z = 12 - x/2 crosses the block face z = 10 at x = 4; base z = x/2 - 3 crosses z = 0 at x = 6.
// Lower block [0,5]: 10 x (50 - integral_6^10 (x/2-3)) = 10 x 46 = 460. Upper [5,10]: 10 x (20 + integral_4^10 (7-x/2)) = 410.
// The solid is 10 x integral (15 - x) = 1,000, so 130 m3 lies above and below the two blocks.
const ramp=square((x)=>12-x/2,(x)=>x/2-3);
const g7=C.fractions(ramp,{origin:[0,0,0],size:[10,10,5],count:[1,1,2]});
close(g7.filled[0],460,'top and base crossing block faces: lower block analytic',1e-9);
close(g7.filled[1],410,'upper block analytic',1e-9);
close(g7.outside,130,'solid beyond the two blocks is reported',1e-9);

// Diagonal cut: a block straddling the triangle's hypotenuse on a single triangle prism.
const tri={v:[[0,0,1],[2,0,1],[0,2,1],[0,0,0],[2,0,0],[0,2,0]],f:[[0,1,2],[3,5,4],[0,3,4],[0,4,1],[1,4,5],[1,5,2],[2,5,3],[2,3,0]]};
const g4=C.fractions(tri,{origin:[0,0,0],size:[2,2,1],count:[1,1,1]});
close(g4.filled[0],2,'block over the right triangle holds its 2 m3');
const g5=C.fractions(tri,{origin:[1,0,0],size:[1,1,1],count:[1,1,1]});
close(g5.filled[0],0.5,'block [1,2]x[0,1] meets half the triangle');

// Grid smaller than the solid reports what lies outside rather than dropping it silently.
const g6=C.fractions(cube,{origin:[0,0,0],size:[5,5,5],count:[1,1,1]});
close(g6.total,125,'one 5 m block inside the cube');
close(g6.outside,875,'the other 875 m3 are reported outside the grid');

// Mass and metal: SG 2.7 on the half-shifted grid gives 2,700 t; 1.5 % Ni gives 40.5 t Ni.
const mass=sum([...g2.filled].map(v=>v*2.7));
close(mass,2700,'mass = sum filled volume x density',1e-9);
close(mass*0.015,40.5,'metal = mass x grade (%)',1e-9);

// An S7 saddle solid on its own TIN: grid totals equal the build volume, at two block sizes.
const picks=(topZ,baseZ)=>{const top=[],base=[];for(let i=0;i<5;i++)for(let j=0;j<5;j++){const x=i*50,y=j*50,h=`H${i}${j}`;
  top.push({hole:h,status:'contact',point:[x,y,topZ(x,y)]});base.push({hole:h,status:'contact',point:[x,y,baseZ(x,y)]});}return [top,base];};
const saddle=B.buildBetween(...picks((x)=>100+0.05*x,(x,y)=>90-0.0005*(x-100)*(y-100)));
for(const s of [[12.5,12.5,2.5],[7,9,1.3]]){
  const cnt=[Math.ceil(210/s[0]),Math.ceil(210/s[1]),Math.ceil(40/s[2])];
  const g=C.fractions(saddle.mesh,{origin:[-5,-5,75],size:s,count:cnt});
  close(g.total,saddle.volume,`saddle blocks ${s.join('x')} sum to the S7 volume`,1e-6);
  ok([...g.filled].every(v=>v>=-1e-12&&v<=s[0]*s[1]*s[2]+1e-9),`no block over-filled at ${s.join('x')}`);
}

// Not a prism, a bad grid, and cancellation are refused, never guessed.
assert.throws(()=>C.fractions({v:[[0,0,0],[1,0,0],[0,1,0]],f:[[0,1,2]]},{origin:[0,0,0],size:[1,1,1],count:[1,1,1]}),/DOMAIN_CLIP_NOT_PRISM/);checks++;
assert.throws(()=>C.fractions(cube,{origin:[0,0,0],size:[0,1,1],count:[1,1,1]}),/DOMAIN_CLIP_GRID_INVALID/);checks++;
ok(C.fractions(cube,{origin:[0,0,0],size:[1,1,1],count:[10,10,10]},{cancelled:()=>true})===null,'a cancelled job returns nothing partial');
const pending=[];
const asyncRun=C.fractionsAsync(saddle.mesh,{origin:[-5,-5,75],size:[7,9,1.3],count:[30,24,31]},{sliceMs:-1}).then(g=>close(g.total,saddle.volume,'time-sliced run gives the same total',1e-6));
let stop=false;const cancelledRun=C.fractionsAsync(saddle.mesh,{origin:[-5,-5,75],size:[7,9,1.3],count:[30,24,31]},{sliceMs:-1,schedule:f=>{stop=true;setTimeout(f,0);},cancelled:()=>stop}).then(g=>ok(g===null,'a run cancelled between slices resolves to nothing'));
await Promise.all([asyncRun,cancelledRun]);
// General closed solids: independent simplex integration for every cell, including partial cells.
const tetra={v:[[0,0,0],[4,0,0],[0,3,0],[0,0,2]],f:[[0,2,1],[0,1,3],[0,3,2],[1,2,3]]};
const simplexVolume=(lo,hi,axis)=>{
  const a=lo.map((v,k)=>Math.max(0,v/axis[k])),b=hi.map((v,k)=>Math.min(1,v/axis[k]));
  if(b.some((v,k)=>v<=a[k]))return 0;
  let value=0;
  for(let mask=0;mask<8;mask++){
    const n=[0,1,2].filter(k=>mask&(1<<k)).length;
    const residual=1-a.reduce((x,y)=>x+y,0)-[0,1,2].reduce((x,k)=>x+((mask&(1<<k))?b[k]-a[k]:0),0);
    value+=(n%2?-1:1)*Math.max(0,residual)**3;
  }
  return axis.reduce((x,y)=>x*y,1)*value/6;
};
const grid={origin:[-0.25,-0.2,-0.3],size:[0.7,0.6,0.5],count:[7,6,6]};
const general=C.fractions(tetra,grid);
for(let k=0;k<6;k++)for(let j=0;j<6;j++)for(let i=0;i<7;i++){
  const lo=grid.origin.map((v,n)=>v+[i,j,k][n]*grid.size[n]),hi=lo.map((v,n)=>v+grid.size[n]);
  close(general.filled[i+7*(j+6*k)],simplexVolume(lo,hi,[4,3,2]),`independent tetrahedral cell ${i},${j},${k}`,1e-10);
}
close(general.total,4,'all tetrahedral partial blocks reconcile to 4 m3');
const projected={v:tetra.v.map(p=>p.map((v,k)=>v+[700000,9800000,100][k])),f:tetra.f};
const translated=C.fractions(projected,{...grid,origin:grid.origin.map((v,k)=>v+[700000,9800000,100][k])});
close(translated.total,4,'projected UTM coordinates preserve tetrahedral volume',1e-7);
for(let i=0;i<general.filled.length;i++)close(translated.filled[i],general.filled[i],`translation preserves cell ${i}`,1e-8);
const oracle=JSON.parse(fs.readFileSync(path.join(here,'fixtures/convex-clipping-oracle.json'),'utf8'));
for(const [i,c] of oracle.cases.entries()) close(C.fractions(c.mesh,c.grid).total,c.expected,`independent SciPy/Qhull tetra/box case ${i}`,1e-8);
const L=ctx.OrebitDomainLoft;
const plane={origin:[0,0,0],u:[1,0,0],v:[0,1,0],normal:[0,0,1]};
const ring=[[0,0],[2,0],[2,1],[1,1],[1,2],[0,2]];
const concave=L.loft({plane,endRule:'zero',sections:[{station:0,ring},{station:3,ring}]});
ok(concave.status==='solid','non-convex L section gives a valid closed shell');
const lg={origin:[-0.2,-0.3,-0.25],size:[0.7,0.6,0.5],count:[4,5,7]},lc=C.fractions(concave.mesh,lg);
const overlap=(a,b,c,d)=>Math.max(0,Math.min(b,d)-Math.max(a,c));
for(let k=0;k<7;k++)for(let j=0;j<5;j++)for(let i=0;i<4;i++){
  const x=lg.origin[0]+i*lg.size[0],y=lg.origin[1]+j*lg.size[1],z=lg.origin[2]+k*lg.size[2];
  const want=(overlap(x,x+0.7,0,2)*overlap(y,y+0.6,0,1)+overlap(x,x+0.7,0,1)*overlap(y,y+0.6,1,2))*overlap(z,z+0.5,0,3);
  close(lc.filled[i+4*(j+5*k)],want,`non-convex signed shell cell ${i},${j},${k}`,1e-8);
}
close(lc.total,9,'concave L volume independently equals (2+1)*3 m3');
for(const rule of ['zero','half','pinch']){
 const s=[[-2,-2],[2,-2],[2,2],[-2,2]],mesh=L.loft({plane,endRule:rule,sections:[{station:0,ring:s},{station:4,ring:s}]}).mesh;
 const r=C.fractions(mesh,{origin:[-3,-3,-3],size:[1.3,1.1,0.9],count:[6,6,12]});
 close(r.total,rule==='zero'?64:rule==='half'?128:256/3,`closed form ${rule} loft volume`,1e-7);
 ok([...r.filled].every(v=>v>=0&&v<=r.blockVolume+1e-9),`${rule} loft cells are bounded without centre sampling`);
}
assert.throws(()=>C.fractions(tetra,{origin:[0,0,0],size:[1,1,1],count:[1000,1000,1000]}),/DOMAIN_CLIP_GRID_BUDGET/);checks++;
let slices=0;
const sliced=await C.fractionsAsync(tetra,grid,{sliceMs:-1,schedule:f=>{slices++;setTimeout(f,0);}});
close(sliced.total,general.total,'general shell time slices preserve exact results');
ok(slices>1,'a general shell yields inside its cell loop, not only between triangles');
let stopGeneral=false;
const stopped=await C.fractionsAsync(tetra,grid,{sliceMs:-1,schedule:f=>{stopGeneral=true;setTimeout(f,0);},cancelled:()=>stopGeneral});
ok(stopped===null,'cancelled general geometry returns no partial result');
// Pairwise overlap uses the same exact signed chain, never intersecting bounding boxes as a verdict.
const CC=ctx.OrebitConvexClip;
const closedBox=(x0,x1,y0,y1,z0,z1)=>({v:[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],f:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]]});
const ab=closedBox(0,2,0,2,0,2);
// Concave rings produce oblique faces. Self-intersection must not
// invent caps at coplanar vertices, including at real projected coordinates.
for(const rule of ['zero','half','pinch'])for(const origin of [[0,0,0],[700000,9800000,0]]){
 const frame=ctx.OrebitGeometryPrimitives.sectionPlane(origin,90);
 const body=L.loft({plane:frame,endRule:rule,sections:[
   {station:0,ring:[[-40,-80],[40,-80],[40,-96],[0,-93],[-40,-96]]},
   {station:50,ring:[[-40,-80],[40,-80],[40,-96],[0,-93],[-40,-96]]}]});
 close(CC.overlap(body.mesh,body.mesh).volume,body.volume,`oblique ${rule} loft self-overlap at ${origin}`,1e-6);
 for(const [i,t] of CC.shell(body.mesh,body.mesh.v[0]).cells.entries())
   close(CC.intersection(t,t.planes),t.volume,`coplanar tetrahedron ${rule} ${origin} ${i}`,1e-8);
}
close(CC.overlap(ab,closedBox(1,3,0,2,0,2)).volume,4,'overlap of half-shifted cubes is 4 m3');
close(CC.overlap(ab,closedBox(2,3,0,2,0,2)).volume,0,'touching faces have no volumetric overlap');
close(CC.overlap(ab,closedBox(3,4,0,2,0,2)).volume,0,'separated cubes have no overlap');
close(CC.overlap(ab,closedBox(.5,1.5,.5,1.5,.5,1.5)).volume,1,'contained cube overlap equals its own volume');
close(CC.overlap(tetra,ab).volume,C.fractions(tetra,{origin:[0,0,0],size:[2,2,2],count:[1,1,1]}).total,'tetra/solid intersection agrees with independent simplex volume');
close(CC.overlap(concave.mesh,closedBox(.5,1.5,.5,1.5,0,3)).volume,2.25,'concave L overlap is the analytic union of two rectangles');
close((await CC.overlapAsync(ab,closedBox(1,3,0,2,0,2),{sliceMs:-1})).volume,4,'time-sliced overlap agrees exactly');
ok(CC.overlap(ab,ab,{cancelled:()=>true})===null,'overlap cancellation supplies no partial verdict');
assert.throws(()=>CC.overlap(ab,ab,{maxPairs:1}),/DOMAIN_OVERLAP_BUDGET/);checks++;
// Sloping adjacent layers have overlapping axis-aligned boxes for many signed
// tetrahedra, but their shared planar contact has exactly zero overlap volume.
// A face separation proof must avoid spending the clipping budget on them.
const layer=(top,base)=>{
 const upper=[],lower=[];
 for(let i=0;i<10;i++)for(let j=0;j<10;j++){
  const x=i*10,y=j*10,hole=`S${i}-${j}`;
  upper.push({hole,status:'contact',point:[700000+x,9800000+y,top+x/2+y/4]});
  lower.push({hole,status:'contact',point:[700000+x,9800000+y,base+x/2+y/4]});
 }
 return B.buildBetween(upper,lower).mesh;
};
const upperLayer=layer(110,100),lowerLayer=layer(100,90);
const adjacent=CC.overlap(upperLayer,lowerLayer,{maxPairs:1000});
close(adjacent.volume,0,'sloping native-contact layers share a surface without volumetric overlap',1e-7);
ok(adjacent.pairs<=1000,'provably separated tetrahedra do not consume the unchanged exact-clipping budget');
close(CC.overlap(upperLayer,layer(105,95)).volume,90*90*5,'sloping five-metre overlap is still measured, never skipped',1e-5);
console.log(`domain clip S9: ${checks} known answers passed`);
