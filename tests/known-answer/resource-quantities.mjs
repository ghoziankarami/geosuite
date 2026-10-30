// Independent numerical oracle for clipped-resource quantities and all six grade units.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const base=existsSync(fileURLToPath(new URL('../../../package.json',import.meta.url)))?'../../../':'../../';
const ctx=vm.createContext({});
for(const file of ['src/shared/geostat/grade-units.js','src/shared/geostat/resource-quantities.js'])
 vm.runInContext(readFileSync(fileURLToPath(new URL(`${base}${file}`,import.meta.url)),'utf8'),ctx);
const q=ctx.OrebitResourceQuantities.aggregate;let checks=0;
const close=(a,b,label)=>{assert.ok(Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(b)),`${label}: ${a} != ${b}`);checks++;};
// One 1,000 m³ cell: 2,000 t, with independently specified equivalent grades.
for(const [unit,grade,expected] of [['%',1,20],['g/t',10000,20],['ppm',10000,20],['ppb',1e7,20],['kg/m³',20,20],['g/m³',20000,20]]){
 const result=q({records:[{blockIndex:0,domainCode:'A',filledVolume:1000}],grades:[grade],densities:[2],selectedIndexes:[0],unit,volumePerBlock:1000});
 close(result.supported.tonnes,2000,`${unit} rock mass`);close(result.estimated.metalTonnes,expected,`${unit} contained metal`);close(result.selected.volume,1000,`${unit} selected volume`);
}
const half=q({records:[{blockIndex:0,domainCode:'A',filledVolume:500}],grades:[1],densities:[2],selectedIndexes:[0],unit:'%',volumePerBlock:1000});
close(half.supported.tonnes,1000,'half-cell tonnes');close(half.estimated.metalTonnes,10,'half-cell metal');
const split=q({records:[{blockIndex:0,domainCode:'A',filledVolume:500},{blockIndex:1,domainCode:'B',filledVolume:500}],grades:[1,1],densities:[2,3],selectedIndexes:[0,1],unit:'%',volumePerBlock:1000});
close(split.supported.tonnes,2500,'split-domain density-weighted tonnes');close(split.domains.A.tonnes,1000,'domain A tonnes');close(split.domains.B.tonnes,1500,'domain B tonnes');
const missing=q({records:[{blockIndex:0,domainCode:'A',filledVolume:500}],grades:[NaN],densities:[2],selectedIndexes:[],unit:'g/t',volumePerBlock:1000});
close(missing.supported.tonnes,1000,'supported includes unestimated mass');close(missing.unestimated.tonnes,1000,'unestimated mass');assert.equal(missing.estimated.blocks,0);checks++;
assert.throws(()=>q({records:[{blockIndex:0,domainCode:'A',filledVolume:700},{blockIndex:0,domainCode:'B',filledVolume:400}],grades:[1],densities:[2],selectedIndexes:[0],unit:'%',volumePerBlock:1000}),/RESOURCE_QUANTITY_SUPPORT_OVERLAP/);checks++;
for(const domainCode of ['__proto__','constructor','toString','hasOwnProperty',"SAP 'quoted'"]){
 const result=q({records:[{blockIndex:0,domainCode,filledVolume:500}],grades:[1],densities:[2],selectedIndexes:[0],unit:'%',volumePerBlock:1000});
 assert.ok(Object.hasOwn(result.domains,domainCode),`literal domain ${domainCode} owns its rollup`);checks++;
 close(result.domains[domainCode].tonnes,1000,`${domainCode} domain tonnes`);
 close(result.domains[domainCode].meanGrade,1,`${domainCode} domain grade`);
 close(result.domains[domainCode].metalTonnes,10,`${domainCode} contained metal`);
}
console.log(`resource physical quantity oracle: ${checks} checks passed`);
