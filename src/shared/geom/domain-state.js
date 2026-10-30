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
  const REVIEW_LIMITS=Object.freeze({reviewer:120,reason:2000});
  function reviewIdentity(value) {
    if(!value||typeof value!=='object'||Array.isArray(value)||
       typeof value.reviewer!=='string'||!value.reviewer.trim()||value.reviewer.length>REVIEW_LIMITS.reviewer||
       /[\u0000-\u001f\u007f]/.test(value.reviewer)||typeof value.reason!=='string'||!value.reason.trim()||
       value.reason.length>REVIEW_LIMITS.reason||/\u0000/.test(value.reason))throw Error('DOMAIN_REVIEW_REQUIRED');
    return {reviewer:value.reviewer.trim(),reason:value.reason.trim()};
  }
  function create() {
    return {schemaVersion:1, source:null, crs:{kind:'unconfirmed',epsg:null,units:'m',renderOrigin:[0,0,0]},
      codebook:[],contactRules:[],surfaces:[],sections:[],domains:[],provenance:{history:[],interpretation:'Geologist review required'}};
  }
  function checkLoftSnapshot(l) {
    const finite=a=>Array.isArray(a)&&a.every(Number.isFinite);
    const key=k=>k==null||(k&&finite(k.origin)&&k.origin.length===2&&Number.isFinite(k.offset)&&Number.isFinite(k.azimuth));
    const snap=s=>s==null||(s&&typeof s==='object'&&Number.isFinite(s.depth)&&Number.isFinite(s.off)&&s.off>=0&&(s.radius==null||(Number.isFinite(s.radius)&&s.radius>=0)));
    if(!l||!Array.isArray(l.draft)||!Array.isArray(l.sections)||!Number.isFinite(l.snap)||l.snap<0||
       !['','zero','half','pinch'].includes(l.endRule)||!key(l.draftAt)||(l.domainCode!=null&&typeof l.domainCode!=='string'))throw Error('DOMAIN_WORKSPACE_INVALID');
    if(l.sections.length>1000||l.draft.length+l.sections.reduce((n,s)=>n+(s?.points?.length||0),0)>10000)throw Error('DOMAIN_STATE_BUDGET');
    for(const p of l.draft)if(!p||!Number.isFinite(p.h)||!Number.isFinite(p.rl)||!snap(p.snap))throw Error('DOMAIN_WORKSPACE_INVALID');
    if(l.draft.length&&!l.draftAt)throw Error('DOMAIN_WORKSPACE_INVALID');
    for(const s of l.sections)if(!s||!key(s)||!finite(s.normal)||s.normal.length!==3||!Array.isArray(s.points)||s.points.length<3||
       s.points.some(p=>!finite(p)||p.length!==2)||!Array.isArray(s.snaps)||s.snaps.length!==s.points.length||s.snaps.some(p=>!snap(p)))throw Error('DOMAIN_WORKSPACE_INVALID');
  }
  function checkWorkspace(w) {
    if(w==null)return;
    if(w.version!==1||!w.frame||w.frame.units!=='m'||(w.frame.crs!=null&&typeof w.frame.crs!=='string')||!w.loft||!w.view||!w.contact||!w.solid)throw Error('DOMAIN_WORKSPACE_INVALID');
    const l=w.loft,v=w.view;
    checkLoftSnapshot(l);
    if(!Array.isArray(l.undo)||!Array.isArray(l.redo)||l.undo.length>60||l.redo.length>60||!['plan','section','3d'].includes(v.mode)||
       ![v.azimuth,v.width,v.offset,v.ve].every(Number.isFinite)||v.width<=0||v.ve<=0||typeof v.veAuto!=='boolean')throw Error('DOMAIN_WORKSPACE_INVALID');
    if(JSON.stringify(w).length>32000000)throw Error('DOMAIN_STATE_BUDGET');
    if(w.method!=null&&!['contacts','loft'].includes(w.method))throw Error('DOMAIN_WORKSPACE_INVALID');
    if(w.domainDrafts!=null){
      if(!Array.isArray(w.domainDrafts)||w.domainDrafts.length>100)throw Error('DOMAIN_STATE_BUDGET');
      const targets=new Set();
      for(const d of w.domainDrafts){
        if(!d||!['contacts','loft'].includes(d.method)||typeof d.contact?.target!=='string'||
           !d.contact.target.startsWith('book:')||d.contact.target.length>105||targets.has(d.contact.target)||
           Object.prototype.hasOwnProperty.call(d,'domainDrafts'))throw Error('DOMAIN_WORKSPACE_INVALID');
        targets.add(d.contact.target);
        checkWorkspace({version:1,frame:w.frame,view:w.view,loft:d.loft,contact:d.contact,solid:d.solid,method:d.method});
      }
    }
    for(const text of [...l.undo,...l.redo]){
      if(typeof text!=='string')throw Error('DOMAIN_WORKSPACE_INVALID');
      let snapshot;try{snapshot=JSON.parse(text);}catch{throw Error('DOMAIN_WORKSPACE_INVALID');}
      checkLoftSnapshot(snapshot);
    }
    if(typeof w.contact.target!=='string'||!['first_from','last_to','grade_cross'].includes(w.contact.rule)||
       [w.contact.threshold,w.contact.maxEdge,w.solid.density].some(n=>n!=null&&!Number.isFinite(n))||
       typeof w.solid.code!=='string'||!['','collars','unavailable','imported'].includes(w.solid.topography))throw Error('DOMAIN_WORKSPACE_INVALID');
    if(w.solid.sourceMode!=null&&!['interval','pair'].includes(w.solid.sourceMode))throw Error('DOMAIN_WORKSPACE_INVALID');
    if(['upperSurface','lowerSurface'].some(k=>w.solid[k]!=null&&(typeof w.solid[k]!=='string'||w.solid[k].length>80)))throw Error('DOMAIN_WORKSPACE_INVALID');
    const terrain=w.solid.terrainSurface;
    if(w.solid.topography==='imported'&&!terrain)throw Error('DOMAIN_WORKSPACE_INVALID');
    if(terrain!=null){
      const p=terrain.provenance;
      if(terrain.kind!=='imported-dxf-3dface-tin'||terrain.units!=='m'||terrain.crs!==w.frame.crs||
         !Array.isArray(terrain.v)||terrain.v.length<3||terrain.v.length>2000||!Array.isArray(terrain.triangles)||terrain.triangles.length<1||terrain.triangles.length>4000||
         !p||typeof p.fileName!=='string'||p.fileName.length>255||typeof p.layer!=='string'||p.layer.length>31||
         !/^[a-f0-9]{64}$/i.test(p.sourceHash||'')||p.sourceCRS!==terrain.crs||p.targetCRS!==terrain.crs||p.sourceUnits!=='m'||p.transform!=='identity')throw Error('DOMAIN_WORKSPACE_INVALID');
      root.OrebitGeometryPrimitives.prepareTIN(terrain);
    }
  }
  function checkCodebook(entries){
    if(!Array.isArray(entries)||entries.length>100)throw Error('DOMAIN_CODEBOOK_INVALID');
    const codes=new Set();
    for(const d of entries){
      if(!d||typeof d.code!=='string'||!d.code.trim()||d.code.length>100||codes.has(d.code)||typeof d.label!=='string'||
         !Array.isArray(d.lithologies)||(!d.lithologies.length&&d.legacyLabelOnly!==true)||d.lithologies.length>1000||d.lithologies.some(x=>typeof x!=='string'||!x.length)||
         new Set(d.lithologies).size!==d.lithologies.length||!/^#[0-9a-f]{6}$/i.test(d.colour)||typeof d.visible!=='boolean'||
         !Number.isInteger(d.precedence)||d.precedence<0||d.precedence>100||
         [d.weathering,d.geotechnical].some(x=>typeof x!=='string'||x.length>1000)||
         (d.density!=null&&(!Number.isFinite(d.density)||d.density<=0)))throw Error('DOMAIN_CODEBOOK_INVALID');
      codes.add(d.code);
    }
  }
  function checkSurfaces(surfaces){
    if(!Array.isArray(surfaces)||surfaces.length>200)throw Error('DOMAIN_STATE_BUDGET');
    const ids=new Set();
    for(const s of surfaces){
      if(!s||s.kind!=='contact-tin'||typeof s.id!=='string'||!s.id.trim()||s.id.length>80||ids.has(s.id)||s.name!==s.id||
         /[\u0000-\u001f\u007f]/.test(s.id)||s.units!=='m'||typeof s.crs!=='string'||s.crs.length>200||
         [s.sourceHash,s.geometryHash].some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h))||
         !s.recipe||typeof s.recipe.target!=='string'||!['first_from','last_to','grade_cross'].includes(s.recipe.rule)||
         (s.recipe.maxEdge!=null&&(!Number.isFinite(s.recipe.maxEdge)||s.recipe.maxEdge<=0))||
         (s.recipe.threshold!=null&&!Number.isFinite(s.recipe.threshold))||
         !Number.isInteger(s.points)||s.points<3||s.points>2000||!Number.isInteger(s.triangles)||s.triangles<1||s.triangles>4000||
         !Number.isFinite(s.maxEdge)||s.maxEdge<=0||typeof s.createdAt!=='string'||!Number.isFinite(Date.parse(s.createdAt)))throw Error('DOMAIN_SURFACE_RECORD_INVALID');
      ids.add(s.id);
    }
    return surfaces;
  }
  function check(state) {
    if (!state || state.schemaVersion!==1 || !Array.isArray(state.domains) || !Array.isArray(state.contactRules) ||
        !Array.isArray(state.surfaces) || !Array.isArray(state.sections) || !Array.isArray(state.codebook) ||
        !state.crs || state.crs.units!=='m' || !['unconfirmed','local','epsg'].includes(state.crs.kind) ||
        !Array.isArray(state.provenance?.history)) throw new Error('DOMAIN_STATE_INVALID');
    if(state.domains.length>100 || state.sections.length>1000 || state.surfaces.length>200) throw new Error('DOMAIN_STATE_BUDGET');
    checkWorkspace(state.workspace);checkCodebook(state.codebook);checkSurfaces(state.surfaces);
    const codes=new Set();
    for(const domain of state.domains){
      if(!domain || typeof domain.code!=='string' || !domain.code.trim() || codes.has(domain.code)) throw new Error('DOMAIN_CODE_INVALID');
      codes.add(domain.code);
      if(domain.density!=null && (!Number.isFinite(domain.density)||domain.density<=0)) throw new Error('DOMAIN_DENSITY_INVALID');
      if(domain.build?.mesh) root.OrebitDomainGeometry.inspectMesh(domain.build.mesh);
      if(domain.build?.review!=null){
        const r=domain.build.review;reviewIdentity(r);
        if(typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||[r.sourceHash,r.inputsHash,r.meshHash].some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))throw Error('DOMAIN_REVIEW_INVALID');
      }
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
    const candidate=clone(value);
    if(Array.isArray(candidate?.codebook))candidate.codebook=candidate.codebook.map(d=>d&&({...d,label:d.label??d.name??d.code,colour:d.colour??d.color??'#0f766e',
      lithologies:d.lithologies??[],...(d.lithologies==null?{legacyLabelOnly:true}:{}),visible:d.visible??true,precedence:d.precedence??0,density:d.density??null,weathering:d.weathering??'',geotechnical:d.geotechnical??''}));
    const state=check(candidate);
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
      if(!b.review||!b.reviewHash||b.review.code!==domain.code||b.review.volume!==b.volume||b.review.sourceHash!==state.source?.sha256||b.review.inputsHash!==b.inputsHash||b.review.meshHash!==b.meshHash)return {status:'stale',volume:null};
      const mesh=root.OrebitDomainGeometry.inspectMesh(b.mesh);
      if(!Number.isFinite(mesh.volume)||mesh.volume<=0) return {status:'invalid',volume:null};
      volume+=mesh.volume;
    }
    return Number.isFinite(volume)?{status:'validated',volume}:{status:'invalid',volume:null};
  }
  root.OrebitDomainState=Object.freeze({create,check,checkSurfaces,checkWorkspace,checkLoftSnapshot,checkCodebook,reviewIdentity,reviewLimits:REVIEW_LIMITS,hash,invalidate,restore,readiness,requiredChecks:REQUIRED.slice()});
})(typeof window==='undefined'?globalThis:window);
