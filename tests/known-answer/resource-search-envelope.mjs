// Exercise the shipped shared engine, never a copied implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
let root = here;
while (!fs.existsSync(path.join(root, 'src/shared/geostat/resource-estimation.js'))) {
  const parent = path.dirname(root); if (parent === root) throw Error('Repository not found'); root = parent;
}
const code = fs.readFileSync(path.join(root, 'src/shared/geostat/resource-estimation.js'), 'utf8');
function engine(source=code) { const ctx={window:{}}; vm.createContext(ctx); vm.runInContext(source,ctx); return ctx; }
function index(ctx,samples,cellSize=10) {
  const grid=new Map(); samples.forEach((s,i)=>{
    const key=ctx._cellHash(Math.floor(s.x/cellSize),Math.floor(s.y/cellSize),Math.floor(s.z/cellSize));
    if (!grid.has(key)) grid.set(key,[]); grid.get(key).push(i);
  }); return {grid,cellSize};
}
const search={rMaj:100,rSemi:100,rMin:100,azDeg:0,dipDeg:0,maxNeighbors:4,useOctant:false};
const samples=[1,2,3,4,5,6].map((x,i)=>({x,y:0,z:0,v:x,rid:i<4?'A':i===4?'B':'C'}));
function capAnswer(ctx) { return Array.from(ctx.neighborsAround(index(ctx,samples),0,0,0,samples,{...search,maxPerHole:2}),n=>n.idx); }
function envelopeAnswer(ctx) {
  return Array.from(ctx.sparseEnvelopeBlocks([{x:1.5,y:1.5,z:1.5}], [0,0,0],[1,1,1],[3,3,3],1,100),b=>[b.cx,b.cy,b.cz]);
}
const ctx=engine();
const tiedGrades=[{v:2},{v:8},{v:12}];
const tiedNeighbors=[{idx:1,ndist:.1},{idx:0,ndist:.1+2e-14},{idx:2,ndist:.2}];
assert.equal(ctx.nearestNeighbor(tiedNeighbors,tiedGrades),2,'equal-distance NN uses source index despite roundoff');
assert.equal(ctx.nearestNeighbor(tiedNeighbors.slice().reverse().sort((a,b)=>a.ndist-b.ndist),tiedGrades),2);
assert.equal(ctx.nearestNeighbor([{idx:1,ndist:.1},{idx:0,ndist:.100001}],tiedGrades),8,'a genuinely nearer sample retains priority');
assert.equal(ctx.nearestNeighbor([{idx:1,eu:1},{idx:0,eu:1}],tiedGrades),8,'legacy neighbours without normalized distance retain their order');
assert.equal(ctx.nearestNeighbor([],tiedGrades),null);
const unstableNN=engine(code.replace('return samples[selected.idx].v;', 'return samples[neighbors[0].idx].v;'));
assert.notEqual(unstableNN.nearestNeighbor(tiedNeighbors,tiedGrades),2,'removed stable NN tie fix is detected');
assert.deepEqual(Array.from(ctx.neighborsAround(index(ctx,samples),0,0,0,samples,search),n=>n.idx),[0,1,2,3]);
assert.deepEqual(Array.from(ctx.neighborsAround(index(ctx,samples),0,0,0,samples,{...search,maxPerHole:0}),n=>n.idx),[0,1,2,3]);
assert.deepEqual(capAnswer(ctx),[0,1,4,5], 'cap is applied before top-k, retaining other holes');
assert.deepEqual(Array.from(ctx.neighborsAround(index(ctx,samples),0,0,0,samples,{...search,maxPerHole:2,excludeIndex:0}),n=>n.idx),[1,2,4,5], 'LOO exclusion precedes the drillhole cap');
const unknown=samples.map(s=>({...s,rid:null}));
assert.equal(ctx.neighborsAround(index(ctx,unknown),0,0,0,unknown,{...search,maxPerHole:1}).length,4);
const oct=ctx.neighborsAround(index(ctx,samples),0,0,0,samples,{...search,useOctant:true,maxPerHole:2});
assert.equal(oct.length,2,'existing minimum per-octant allowance still applies alongside the drillhole cap');
assert.deepEqual(envelopeAnswer(ctx),[[1.5,1.5,.5],[1.5,.5,1.5],[.5,1.5,1.5],[1.5,1.5,1.5],[2.5,1.5,1.5],[1.5,2.5,1.5],[1.5,1.5,2.5]]);
const overlap=[{x:1.5,y:1.5,z:1.5},{x:1.5,y:1.5,z:1.5}];
assert.equal(ctx.sparseEnvelopeBlocks(overlap,[0,0,0],[1,1,1],[3,3,3],1,100).length,7,'overlap counts volume once');
const clusters=[{x:.5,y:.5,z:.5},{x:9.5,y:.5,z:.5}];
assert.deepEqual(Array.from(ctx.sparseEnvelopeBlocks(clusters,[0,0,0],[1,1,1],[10,1,1],.1,100),b=>b.cx),[.5,9.5],'no blocks across an uninformed gap');
assert.equal(ctx.sparseEnvelopeBlocks([{x:0,y:0,z:0}],[0,0,0],[10,10,10],[1,1,1],1,100).length,0);
assert.throws(()=>ctx.sparseEnvelopeBlocks(overlap,[0,0,0],[1,1,1],[3,3,3],1,6),/memory limit/);
assert.throws(()=>ctx.sparseEnvelopeBlocks(overlap,[0,0,0],[1,1,1],[3,3,3],0,100),/Invalid/);
assert.throws(()=>ctx.sparseEnvelopeBlocks([{x:NaN,y:0,z:0}],[0,0,0],[1,1,1],[3,3,3],1,100),/finite/);
// Different grid origins, anisotropic cells and edge samples: independent exhaustive oracle.
for (const origin of [[0,0,0],[-1,2,-3],[724500,9583000,1800]]) {
  const size=[2,3,4],dims=[4,3,2],radius=3;
  const ss=[{x:origin[0]+2,y:origin[1]+3,z:origin[2]+4},{x:origin[0]-1,y:origin[1],z:origin[2]}];
  const expected=[];
  for(let k=0;k<dims[2];k++)for(let j=0;j<dims[1];j++)for(let i=0;i<dims[0];i++){
    const p=[origin[0]+(i+.5)*size[0],origin[1]+(j+.5)*size[1],origin[2]+(k+.5)*size[2]];
    if(ss.some(s=>(p[0]-s.x)**2+(p[1]-s.y)**2+(p[2]-s.z)**2<=radius**2))expected.push(p);
  }
  assert.deepEqual(Array.from(ctx.sparseEnvelopeBlocks(ss,origin,size,dims,radius,100),b=>[b.cx,b.cy,b.cz]),expected);
}
// Mutation controls prove the assertions catch removal of either feature.
const noCap=engine(code.replace('const holeCap = Math.max(0, Math.floor(search.maxPerHole || 0));','const holeCap = 0;'));
assert.notDeepEqual(capAnswer(noCap),[0,1,4,5]);
const noSphere=engine(code.replace('if ((cx-s.x)**2+(cy-s.y)**2+(cz-s.z)**2 > radius*radius) continue;',''));
assert.notEqual(envelopeAnswer(noSphere).length,7);
// Hand-solved ordinary kriging: symmetric weights 1/2, value 3;
// variance = 2*gamma(5) - gamma(10)/2, with the legacy search anisotropy.
const symmetric=[{x:0,y:0,z:0,v:2},{x:10,y:0,z:0,v:4}];
const kriging=ctx.ordinaryKriging([{idx:0,eu:5},{idx:1,eu:5}],5,0,0,symmetric,
  {type:'spherical',nugget:.1,sill:1,range:30},{...search,rMaj:8,rSemi:8,rMin:8});
assert.ok(Math.abs(kriging.value-3)<1e-7);
assert.ok(Math.abs(kriging.variance-1.1677734375)<1e-7);
console.log('PASS: legacy search, hole caps/octants, sparse geometry/volume/limits; both mutation controls detected');
