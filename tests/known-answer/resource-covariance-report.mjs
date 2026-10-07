import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';import {fileURLToPath} from 'node:url';
let root=path.dirname(fileURLToPath(import.meta.url));while(!fs.existsSync(path.join(root,'src/shared/geostat/resource-estimation.js')))root=path.dirname(root);
const code=fs.readFileSync(path.join(root,'src/shared/geostat/resource-estimation.js'),'utf8');
function engine(source=code){const c={window:{}};vm.createContext(c);vm.runInContext(source,c);return c;}
const c=engine();const m={type:'spherical',nugget:.1,sill:1,range:40,covarianceMode:'model-range'};const search={rMaj:15,rSemi:6,rMin:4,azDeg:90,dipDeg:0};
assert.ok(Math.abs(c.gammaAniso(20,0,0,m,search)-(.1+.9*.6875))<1e-12);
assert.equal(c.gammaAniso(40,0,0,m,search),1);assert.equal(c.gammaAniso(0,0,0,m,search),0);
assert.equal(c.gammaAniso(0,20,0,m,search),c.gammaAniso(20,0,0,m,search));assert.equal(c.gammaAniso(0,0,20,m,search),c.gammaAniso(20,0,0,m,search));
const ss=[{x:0,y:0,z:0,v:1},{x:12,y:0,z:0,v:4},{x:0,y:25,z:0,v:2}];const nb=ss.map((s,i)=>({idx:i,eu:Math.hypot(s.x-3,s.y-4)}));
const a=c.ordinaryKriging(nb,3,4,0,ss,m,search);const b=c.ordinaryKriging(nb,3,4,0,ss,m,{...search,rMaj:300,rSemi:200,rMin:80,dipDeg:45});
assert.equal(a.value,b.value);assert.equal(a.variance,b.variance);
// Independent NumPy/LAPACK 4x4 spherical semivariogram solution, including sum(weights)=1.
assert.ok(Math.abs(a.value-1.9725392670292228)<1e-7);assert.ok(Math.abs(a.variance-.3938096953249054)<1e-7);
const longer=c.ordinaryKriging(nb,3,4,0,ss,{...m,range:80},search);assert.ok(Math.abs(longer.value-a.value)>1e-3);
const legacy={...m};delete legacy.covarianceMode;assert.notEqual(c.gammaAniso(20,0,0,legacy,search),c.gammaAniso(20,0,0,m,search));
const nested={nugget:.1,azDeg:90,struct1:{type:'spherical',psill:.9,rangeMaj:40,rangeMin:20,rangeVert:10}};
assert.ok(Math.abs(c.gammaAniso(20,0,0,nested,search)-(.1+.9*.6875))<1e-12);assert.equal(c.gammaAniso(0,20,0,nested,search),1);
const r=c.summarizeBlocks([0,1],[1,3],1,[1,3]);assert.equal(r.tonnes,4);assert.equal(r.meanGrade,2.5);assert.equal(r.tonnes*r.meanGrade,10);
const v=c.summarizeBlocks([0,1],[1,3],1,[1,3],true);assert.equal(v.meanGrade,2);assert.equal(v.volume*v.meanGrade,4);
assert.equal(c.summarizeBlocks([0,1],[NaN,0],1,[1,3]).meanGrade,0);assert.equal(c.summarizeBlocks([0],[NaN],1,[1]).meanGrade,null);assert.throws(()=>c.summarizeBlocks([0],[1],1,[0]),/density/);
// Tests must detect removal of physical-range semantics and density weighting.
const noRange=engine(code.replace("if (model.covarianceMode === 'model-range')",'if (false)'));assert.notEqual(noRange.gammaAniso(20,0,0,m,search),.1+.9*.6875);
const noMassWeight=engine(code.replace('volumetric ? volumePerBlock : mass','volumePerBlock'));assert.notEqual(noMassWeight.summarizeBlocks([0,1],[1,3],1,[1,3]).meanGrade,2.5);
console.log('PASS: physical covariance range, independent kriging known answer, search invariance, density/volume weighting and both mutation controls');
