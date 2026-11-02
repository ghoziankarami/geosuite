/* Physical quantity rollups over clipped block support. */
(function(root){
 'use strict';
 function aggregate({records,grades,densities,selectedIndexes=[],unit,volumePerBlock}){
  const fail=code=>{const error=Error(code);error.code=code;throw error;};
  if(!Array.isArray(records)||!(Array.isArray(grades)||ArrayBuffer.isView(grades))||!(Array.isArray(densities)||ArrayBuffer.isView(densities))||!(Number.isFinite(volumePerBlock)&&volumePerBlock>0))fail('RESOURCE_QUANTITY_INPUT_INVALID');
  const normalized=root.OrebitGradeUnits.normalize(unit);if(!normalized)fail('GRADE_UNIT_UNSUPPORTED');
  const byBlock=new Map();
  for(const row of records){
   if(!Number.isInteger(row.blockIndex)||row.blockIndex<0||!Number.isFinite(row.filledVolume)||row.filledVolume<=0||row.filledVolume>volumePerBlock*(1+1e-8))fail('RESOURCE_QUANTITY_SUPPORT_INVALID');
   const item=byBlock.get(row.blockIndex)||{volume:0,domains:new Set()};
   if(item.domains.has(row.domainCode))fail('RESOURCE_QUANTITY_DUPLICATE_DOMAIN');
   item.domains.add(row.domainCode);item.volume+=row.filledVolume;
   if(item.volume>volumePerBlock*(1+1e-8))fail('RESOURCE_QUANTITY_SUPPORT_OVERLAP');
   byBlock.set(row.blockIndex,item);
  }
  const selected=new Set(selectedIndexes),out={supported:blank(),estimated:blank(),selected:blank(),unestimated:blank(),domains:Object.create(null)};
  const add=(target,index,volume,grade,density)=>{
   target.blocks++;target.volume+=volume;target.tonnes+=volume*density;
   if(Number.isFinite(grade)){const weight=root.OrebitGradeUnits.isVolumetric(normalized)?volume:volume*density;target.gradeWeight+=weight*grade;target.gradeDenominator+=weight;target.metalTonnes+=root.OrebitGradeUnits.containedTonnes(volume*density,volume,grade,normalized);}
  };
  for(const [index,support] of byBlock){
   const density=densities[index],grade=grades[index];if(!(Number.isFinite(density)&&density>0))fail('RESOURCE_QUANTITY_DENSITY_INVALID');
   const volume=Math.min(support.volume,volumePerBlock),g=Number.isFinite(grade)?grade:null;
   add(out.supported,index,volume,g,density);
   if(g===null)add(out.unestimated,index,volume,null,density);else add(out.estimated,index,volume,g,density);
   if(selected.has(index)&&g!==null)add(out.selected,index,volume,g,density);
  }
  for(const record of records){const index=record.blockIndex,domain=out.domains[record.domainCode]||(out.domains[record.domainCode]=blank());
   const density=densities[index],grade=Number.isFinite(grades[index])?grades[index]:null;
   add(domain,index,record.filledVolume,grade,density);
  }
  for(const value of [...Object.values(out).filter(v=>v&&typeof v==='object'&&'blocks'in v),...Object.values(out.domains)]){
   value.meanGrade=value.gradeDenominator?value.gradeWeight/value.gradeDenominator:null;
   if(value.meanGrade===null)value.metalTonnes=null;
   delete value.gradeWeight;delete value.gradeDenominator;
   value.mt=value.tonnes/1e6;value.volMm3=value.volume/1e6;
  }
  return out;
 }
 function blank(){return{blocks:0,volume:0,tonnes:0,gradeWeight:0,gradeDenominator:0,metalTonnes:0};}
 root.OrebitResourceQuantities=Object.freeze({aggregate});
})(typeof window==='undefined'?globalThis:window);
