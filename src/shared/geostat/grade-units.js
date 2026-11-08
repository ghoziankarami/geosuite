/* Shared physical grade units. Labels/metadata never convert or overwrite raw grades. */
(function(root) {
  'use strict';
  const aliases=Object.freeze({pct:'%',percent:'%',persen:'%','wt%':'%','%':'%',gpt:'g/t',gt:'g/t','g/t':'g/t','g/ton':'g/t','g/tonne':'g/t',ppm:'ppm',ppb:'ppb',kg:'kg/m³',kgm3:'kg/m³','kg/m3':'kg/m³',gm3:'g/m³','g/m3':'g/m³'});
  const options=Object.freeze(['%','g/t','ppm','ppb','kg/m³','g/m³']);
  const divisors=Object.freeze({'%':100,'g/t':1e6,ppm:1e6,ppb:1e9,'kg/m³':1e3,'g/m³':1e6});
  function normalize(value) {
    if(typeof value!=='string') return null;
    return aliases[value.trim().toLowerCase().replace(/³/g,'3').replace(/[\s_]/g,'')]||null;
  }
  function fromHeader(value) {
    const header=String(value??'').trim().replace(/³/g,'3');
    const suffix=header.match(/_(gpt|ppm|ppb|pct|kgm3|gm3|kg)$/i);
    if(suffix) return normalize(suffix[1]);
    const notation=header.match(/[\s(\[]((?:wt\s*%)|%|ppm|ppb|g\/t|g\/ton(?:ne)?|kg\/m3|g\/m3)[)\]]?\s*$/i);
    return notation?normalize(notation[1]):null;
  }
  function schemaToken(unit) {
    const normalized=normalize(unit);
    return {'%':'pct','g/t':'gpt',ppm:'ppm',ppb:'ppb','kg/m³':'kgm3','g/m³':'gm3'}[normalized]||null;
  }
  const isVolumetric=unit=>['kg/m³','g/m³'].includes(normalize(unit));
  function metalFormula(unit) {
    const u=normalize(unit);if(!u) throw Error('GRADE_UNIT_UNSUPPORTED');
    return `metal_t = ${isVolumetric(u)?'volume_m3':'rock_t'} x grade_${schemaToken(u)} / ${divisors[u]}` +
      (isVolumetric(u)?'; rock tonnage is not determined':'');
  }
  function convertGrade(value,from,to) {
    const a=normalize(from),b=normalize(to);
    if(!a || !b || isVolumetric(a)!==isVolumetric(b)) throw Error('GRADE_UNIT_CONVERSION');
    if(!Number.isFinite(value)) return NaN;
    return value/divisors[a]*divisors[b];
  }
  function containedTonnes(rockTonnes,volumeM3,grade,unit) {
    const u=normalize(unit);if(!u) throw Error('GRADE_UNIT_UNSUPPORTED');
    if(!Number.isFinite(grade) || grade<0) return NaN;
    const support=isVolumetric(u)?volumeM3:rockTonnes;
    if(!Number.isFinite(support) || support<0) return NaN;
    return support*grade/divisors[u];
  }
  root.OrebitGradeUnits=Object.freeze({version:'physical-grade-units-v1',options,normalize,fromHeader,schemaToken,isVolumetric,metalFormula,convertGrade,containedTonnes});
})(typeof window==='undefined'?globalThis:window);
