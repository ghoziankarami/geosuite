/* Fail-closed model/search validation shared by estimation and cross-validation. */
(function(root){
 'use strict';
 const types=new Set(['spherical','exponential','gaussian']);
 function validate(model,search,sampleCount){
  const errors=[];
  if(!model||typeof model!=='object')errors.push('MODEL_REQUIRED');
  else if(!Number.isFinite(model.nugget)||model.nugget<0)errors.push('MODEL_NUGGET_INVALID');
  else if(model.struct1){
   const structures=[model.struct1,...(model.struct2?[model.struct2]:[])];
   if(structures.some(s=>!s||!types.has(s.type)||!Number.isFinite(s.psill)||s.psill<0||![s.rangeMaj,s.rangeMin,s.rangeVert].every(v=>Number.isFinite(v)&&v>0)))errors.push('MODEL_STRUCTURE_INVALID');
  }else if(!types.has(model.type)||!Number.isFinite(model.sill)||model.sill<model.nugget||!Number.isFinite(model.range)||model.range<=0)errors.push('MODEL_STRUCTURE_INVALID');
  if(!search||typeof search!=='object'||![search.rMaj,search.rSemi,search.rMin].every(v=>Number.isFinite(v)&&v>0)||
    ![search.azDeg,search.dipDeg].every(Number.isFinite)||Math.abs(search.dipDeg)>90||
    !Number.isInteger(search.minNeighbors)||!Number.isInteger(search.maxNeighbors)||search.minNeighbors<2||search.maxNeighbors<search.minNeighbors||search.maxNeighbors>50||
    !Number.isInteger(search.maxPerHole||0)||(search.maxPerHole||0)<0||(search.maxPerHole||0)>50)errors.push('SEARCH_INVALID');
  if(search?.secondPass&&(!(Number.isFinite(search.secondPassFactor)&&search.secondPassFactor>=1&&search.secondPassFactor<=5)||
    !Number.isInteger(search.secondPassMin)||search.secondPassMin<2||search.secondPassMin>search.maxNeighbors))errors.push('SECOND_PASS_INVALID');
  const required=search?.secondPass?Math.min(search.minNeighbors,search.secondPassMin):search?.minNeighbors;
  if(!Number.isInteger(sampleCount)||sampleCount<required)errors.push('SAMPLES_INSUFFICIENT');
  return Object.freeze({valid:errors.length===0,errors:Object.freeze(errors),requiredSamples:required||null});
 }
 function coverage({grades,supportedCount,totalCount}){
  const finite=Array.from(grades||[]).reduce((n,v)=>n+(Number.isFinite(v)?1:0),0);
  const denominator=Number.isInteger(supportedCount)?supportedCount:totalCount;
  return Object.freeze({totalBlocks:totalCount,supportedBlocks:denominator,estimatedBlocks:finite,
    unestimatedSupportedBlocks:Math.max(0,denominator-finite),coverage:denominator?finite/denominator:null});
 }
 root.OrebitResourceEstimateContract=Object.freeze({validate,coverage});
})(typeof window==='undefined'?globalThis:window);
