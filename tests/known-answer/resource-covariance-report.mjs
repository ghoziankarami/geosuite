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

// Display bounds and legend classes exercise the shipped pure module.
const viewCode=fs.readFileSync(path.join(root,'src/shared/geo/block-view.js'),'utf8');
const view={};vm.createContext(view);vm.runInContext(viewCode,view);
const array=x=>Array.from(x);
assert.deepEqual(JSON.parse(JSON.stringify(view.blockGradeRange('',0))),{min:null,max:0});
assert.equal(view.blockGradeIncluded(0,view.blockGradeRange(0,0)),true);
assert.equal(view.blockGradeIncluded(NaN,view.blockGradeRange('','')),false);
assert.equal(view.blockGradeIncluded(3,view.blockGradeRange(1,2)),false);
for(const bounds of [[2,1],['NaN',2],[1,'Infinity']])assert.throws(()=>view.blockGradeRange(...bounds),/range/);
const grades=[0,0,0,1,2,3,9,100];
const quantile=view.blockGradeScale(grades,{method:'quantile'},'%');
assert.equal(quantile.breaks.length,3);[.8,2.2,6.6].forEach((v,i)=>assert.ok(Math.abs(quantile.breaks[i]-v)<1e-12));
assert.equal(quantile.map(0),0);assert.equal(quantile.map(100),3);
const equal=view.blockGradeScale([2,2,2],{},'g/t');assert.equal(equal.colors.length,1);assert.equal(equal.map(2),0);
const custom=view.blockGradeScale(grades,{method:'custom',breaks:'0, 1, 10',palette:'cividis'},'ppm');
assert.deepEqual(grades.map(custom.map),[0,0,0,1,2,2,2,3]);assert.ok(custom.labels.every(l=>l.includes('ppm')));
for(const breaks of ['', '1,1', '2,1','NaN','1,Infinity',Array.from({length:13},(_,i)=>i).join(',')])assert.throws(()=>view.blockGradeScale(grades,{method:'custom',breaks}),/breaks/);
const linear=view.blockGradeScale(grades,{method:'linear'},'kg/m³');assert.equal(linear.cmin,0);assert.equal(linear.cmax,100);assert.equal(linear.map(9),9);
assert.equal(view.blockGradeNumber(.0000001),'1e-7');
assert.deepEqual(grades,[0,0,0,1,2,3,9,100],'Rendering never rewrites the numerical grade array');
const noUpper={};vm.createContext(noUpper);vm.runInContext(viewCode.replace('value <= range.max','true'),noUpper);
assert.notEqual(noUpper.blockGradeIncluded(3,noUpper.blockGradeRange(1,2)),false,'Mutation: removing upper bound is detected');
console.log('PASS: inclusive ranges, finite input gates, tied/skewed quantiles, custom/linear/unit legends and upper-bound mutation');
