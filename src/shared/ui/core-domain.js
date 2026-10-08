/* Core owns Domain state. Source/endpoint readiness stays outside navigation until integrated solid gates pass. */
(function () {
  'use strict';
  let interpretation = OrebitDomainState.create();
  let epoch = 0;
  function source() {
    return {tables:Object.fromEntries(['collar','survey','assay','geology'].map(k=>[k,STATE[k]])),
      geometryAlgorithm:window.OrebitMinimumCurvature?.version||'unavailable', crs:STATE.crs, lengthUnit:'m', gradeUnits:STATE.units || {}, coordinateMode:window._coreUseProvidedXYZ?'supplied-midpoints':'measured-survey'};
  }
  async function capture() {
    const version=epoch, text=JSON.stringify(source());
    const sha256=await OrebitDomainState.hash(JSON.parse(text));
    if(version!==epoch || text!==JSON.stringify(source())) throw new Error('DOMAIN_SOURCE_CHANGED');
    return {sha256,rows:STATE.assay.length,holes:STATE.collar.length};
  }
  function reset() {epoch++;interpretation=OrebitDomainState.create();}
  function invalidate(reason) {epoch++;if(interpretation.domains.length) OrebitDomainState.invalidate(interpretation,reason);}
  function exportState() {return JSON.parse(JSON.stringify(interpretation));}
  async function restore(state) {
    const token=epoch;
    const current=await capture();
    if(token!==epoch) throw new Error('DOMAIN_SOURCE_CHANGED');
    interpretation=OrebitDomainState.restore(state,current.sha256);
    return exportState();
  }
  function intervalGeometry(table='assay') {
    if(!['assay','geology'].includes(table))throw new Error('DOMAIN_INTERVAL_SOURCE_INVALID');
    if(window._coreUseProvidedXYZ) return {algorithm:OrebitMinimumCurvature.version,coordinateMode:'supplied-midpoints',status:'endpoints-unavailable',intervals:[]};
    if(!STATE.desurvey)computeDesurvey();
    const intervals=STATE[table].map((row,index)=>{
      const hole=STATE.desurvey.holes[row.hole_id],from=Number(row.from_m),to=Number(row.to_m);
      const valid=row.from_m!=null&&row.to_m!=null&&String(row.from_m).trim()!==''&&String(row.to_m).trim()!==''&&Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to>from;
      const start=valid?hole?.curve?.atMD(from):null,end=valid?hole?.curve?.atMD(to):null;
      const assumptions=(hole?.assumptions||[]).filter(code=>code!=='LAST_DIRECTION_EXTENSION'||to>hole.surveys[hole.surveys.length-1].depth);
      return {sourceIndex:index,hole_id:row.hole_id,from_m:row.from_m,to_m:row.to_m,start:start??null,end:end??null,status:!start||!end?'invalid':assumptions.length?'assumed':'measured',assumptions};
    });
    return {algorithm:OrebitMinimumCurvature.version,coordinateMode:'measured-survey',sourceTable:table,crs:STATE.crs||null,status:intervals.some(r=>r.status==='invalid')?'invalid':intervals.some(r=>r.status==='assumed')?'assumed':'measured',intervals};
  }
  window.OrebitCoreDomain = {capture,reset,invalidate,exportState,restore,intervalGeometry,
    readiness:async()=>OrebitDomainState.readiness(interpretation,(await capture()).sha256)};
})();
