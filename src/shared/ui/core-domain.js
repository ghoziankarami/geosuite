/* Core owns Domain state. The S0 contract stays outside navigation until solid gates pass. */
(function () {
  'use strict';
  let interpretation = OrebitDomainState.create();
  let epoch = 0;
  function source() {
    return {tables:Object.fromEntries(['collar','survey','assay','geology'].map(k=>[k,STATE[k]])),
      crs:STATE.crs, lengthUnit:'m', gradeUnits:STATE.units || {}, coordinateMode:window._coreUseProvidedXYZ?'supplied-midpoints':'measured-survey'};
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
  window.OrebitCoreDomain = {capture,reset,invalidate,exportState,restore,
    readiness:async()=>OrebitDomainState.readiness(interpretation,(await capture()).sha256)};
})();
