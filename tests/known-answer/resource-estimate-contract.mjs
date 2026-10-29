// Fail-closed model/search prerequisites and coverage denominator oracle.
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const ctx=vm.createContext({});
vm.runInContext(readFileSync(fileURLToPath(new URL((existsSync(fileURLToPath(new URL('../../../package.json',import.meta.url))) ? '../../../src/' : '../../src/')+'shared/geostat/resource-estimate-contract.js',import.meta.url)),'utf8'),ctx);
const owner=ctx.OrebitResourceEstimateContract;
const model={type:'spherical',nugget:.1,sill:1,range:40,covarianceMode:'model-range'};
const search={rMaj:20,rSemi:10,rMin:5,azDeg:90,dipDeg:0,minNeighbors:2,maxNeighbors:12,maxPerHole:0,secondPass:false};
const valid=owner.validate(model,search,10);assert.equal(valid.valid,true);assert.deepEqual(Array.from(valid.errors),[]);
for(const [m,s,count,error] of [
 [{...model,range:0},search,10,'MODEL_STRUCTURE_INVALID'],
 [{...model,nugget:-1},search,10,'MODEL_NUGGET_INVALID'],
 [model,{...search,rMaj:0},10,'SEARCH_INVALID'],
 [model,{...search,dipDeg:91},10,'SEARCH_INVALID'],
 [model,{...search,maxNeighbors:1},10,'SEARCH_INVALID'],
 [model,{...search,secondPass:true,secondPassMin:20},10,'SECOND_PASS_INVALID'],
 [model,search,1,'SAMPLES_INSUFFICIENT']
])assert.ok(Array.from(owner.validate(m,s,count).errors).includes(error),error);
const nested={nugget:.1,struct1:{type:'spherical',psill:.5,rangeMaj:40,rangeMin:20,rangeVert:10},struct2:{type:'gaussian',psill:.4,rangeMaj:100,rangeMin:80,rangeVert:25}};
assert.equal(owner.validate(nested,search,10).valid,true);assert.equal(owner.validate({...nested,struct1:{...nested.struct1,rangeVert:0}},search,10).valid,false);
const coverage=owner.coverage({grades:[1,NaN,3,NaN],supportedCount:3,totalCount:4});
assert.deepEqual(JSON.parse(JSON.stringify(coverage)),{totalBlocks:4,supportedBlocks:3,estimatedBlocks:2,unestimatedSupportedBlocks:1,coverage:2/3});
console.log('resource estimate validity/coverage: 12 checks passed');
