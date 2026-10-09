/* S0: versioned geological interpretation. No raw-data edits or geological inference. */
(function(root) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = value => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  };
  async function hash(value) {
    if (!root.crypto?.subtle) throw new Error('DOMAIN_HASH_UNAVAILABLE');
    const bytes=new TextEncoder().encode(canonical(value));
    return Array.from(new Uint8Array(await root.crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
  }
  const REQUIRED = ['topology','selfIntersection','topography','surfaceCrossings','overlap','honouring','geologistReview'];
  function create() {
    return {schemaVersion:1, source:null, crs:{kind:'unconfirmed',epsg:null,units:'m',renderOrigin:[0,0,0]},
      codebook:[],contactRules:[],surfaces:[],sections:[],domains:[],provenance:{history:[],interpretation:'Geologist review required'}};
  }
  function check(state) {
    if (!state || state.schemaVersion!==1 || !Array.isArray(state.domains) || !Array.isArray(state.contactRules) ||
        !Array.isArray(state.surfaces) || !Array.isArray(state.sections) || !Array.isArray(state.codebook) ||
        !state.crs || state.crs.units!=='m' || !['unconfirmed','local','epsg'].includes(state.crs.kind) ||
        !Array.isArray(state.provenance?.history)) throw new Error('DOMAIN_STATE_INVALID');
    if(state.domains.length>100 || state.sections.length>1000 || state.surfaces.length>200) throw new Error('DOMAIN_STATE_BUDGET');
    const codes=new Set();
    for(const domain of state.domains){
      if(!domain || typeof domain.code!=='string' || !domain.code.trim() || codes.has(domain.code)) throw new Error('DOMAIN_CODE_INVALID');
      codes.add(domain.code);
      if(domain.density!=null && (!Number.isFinite(domain.density)||domain.density<=0)) throw new Error('DOMAIN_DENSITY_INVALID');
      if(domain.build?.mesh) root.OrebitDomainGeometry.inspectMesh(domain.build.mesh);
    }
    return state;
  }
  function invalidate(state,reason) {
    check(state);
    for(const domain of state.domains) if(domain.build) {domain.build.stale=true;domain.build.staleReason=String(reason);}
    state.provenance.history.push({at:new Date().toISOString(),action:'invalidate',detail:String(reason)});
    return state;
  }
  function restore(value,sourceHash) {
    const state=check(clone(value));
    if(state.source?.sha256!==sourceHash) invalidate(state,'Source data or coordinate context changed');
    return state;
  }
  function readiness(state,currentHash) {
    check(state);
    if(!state.domains.length) return {status:'none',volume:null};
    if(!currentHash || state.source?.sha256!==currentHash || state.domains.some(d=>d.build?.stale)) return {status:'stale',volume:null};
    if(state.crs.kind==='unconfirmed') return {status:'invalid',volume:null};
    let volume=0;
    for(const domain of state.domains){
      const b=domain.build;
      if(!b?.mesh || !b.inputsHash || REQUIRED.some(k=>b.validation?.[k]!==true)) return {status:'invalid',volume:null};
      const mesh=root.OrebitDomainGeometry.inspectMesh(b.mesh);
      if(mesh.volume===null) return {status:'invalid',volume:null};
      volume+=mesh.volume;
    }
    return {status:'validated',volume};
  }
  root.OrebitDomainState=Object.freeze({create,check,hash,invalidate,restore,readiness,requiredChecks:REQUIRED.slice()});
})(typeof window==='undefined'?globalThis:window);
